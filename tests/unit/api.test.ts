import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeReceipt, apiBaseUrl, ApiError, deleteExpense, listExpenses, login, saveExpense } from "../../src/lib/api";
import { createDemoExpense } from "../../src/lib/demo";
import { sampleReceipt, type ExpenseInput } from "../../src/lib/domain";

const input: ExpenseInput = { merchant: "Mercado", date: "2026-10-19", currency: "EUR", items: [{ id: "a", name: "Pan", amountCents: 101, selected: true }], participants: [{ id: "p1", name: "Ana", weight: 1 }, { id: "p2", name: "Alex", weight: 1 }], splitMode: "equal" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://backend.example.test/");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("configuración y sesión", () => {
  it("acepta HTTPS o HTTP solo local", () => {
    expect(apiBaseUrl()).toBe("https://backend.example.test");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8080");
    expect(apiBaseUrl()).toBe("http://localhost:8080");
  });
  it.each(["", "backend", "http://backend.example.test", "https://user:password@backend.example.test", "https://backend.example.test?key=secret"])("rechaza la URL %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", url);
    expect(() => apiBaseUrl()).toThrow(ApiError);
  });
  it("envía credenciales solo al login y no usa cookies", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ accessToken: "test-token", expiresIn: 3600 }));
    expect(await login("ana@example.test", "test-password")).toEqual({ accessToken: "test-token", expiresIn: 3600 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backend.example.test/api/auth/login");
    expect(options?.credentials).toBe("omit");
    expect(options?.body).toBe(JSON.stringify({ email: "ana@example.test", password: "test-password" }));
  });
  it("exige token antes de enviar datos", () => {
    expect(() => listExpenses("")).toThrow(/Inicia sesión/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("contrato remoto", () => {
  it("sube FormData sin fijar Content-Type para que el navegador añada boundary", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(sampleReceipt()));
    const file = new File(["photo"], "ticket.jpg", { type: "image/jpeg" });
    await analyzeReceipt(file, "test-token");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backend.example.test/api/receipts/analyze");
    expect(options?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("image")).toBeInstanceOf(File);
  });
  it("rechaza fotos inválidas antes de contactar con el servidor", () => {
    expect(() => analyzeReceipt(new File(["photo"], "ticket.heic", { type: "image/heic" }), "test-token")).toThrow(/HEIC/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("manda céntimos e idempotencia al guardar, sin añadir fotos", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(createDemoExpense(input)));
    await saveExpense(input, "test-token", "operation-id");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer test-token", "Content-Type": "application/json", "Idempotency-Key": "operation-id" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(input);
  });
  it("acepta una eliminación 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteExpense("id/escaped", "test-token")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("https://backend.example.test/api/expenses/id%2Fescaped");
  });
  it("envía y conserva el propietario de un producto personal", async () => {
    const personal: ExpenseInput = { ...input, items: [{ ...input.items[0], ownerId: "p1" }] };
    fetchMock.mockResolvedValueOnce(Response.json(createDemoExpense(personal)));
    const saved = await saveExpense(personal, "test-token", "personal-id");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).items[0].ownerId).toBe("p1");
    expect(saved.items[0].ownerId).toBe("p1");
    expect(saved.shares.map((share) => share.amountCents)).toEqual([101, 0]);
  });
  it("rechaza una respuesta que pierda o cambie el propietario", async () => {
    const personal: ExpenseInput = { ...input, items: [{ ...input.items[0], ownerId: "p1" }] };
    fetchMock.mockResolvedValueOnce(Response.json(createDemoExpense(input)));
    await expect(saveExpense(personal, "test-token", "missing-owner")).rejects.toThrow(/no ha conservado los propietarios/);
    fetchMock.mockResolvedValueOnce(Response.json(createDemoExpense({ ...personal, items: [{ ...personal.items[0], ownerId: "p2" }] })));
    await expect(saveExpense(personal, "test-token", "changed-owner")).rejects.toThrow(/no ha conservado los propietarios/);
  });
  it("no muestra cuerpos de error del servidor ni reintenta operaciones", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private internal details", { status: 429 }));
    await expect(listExpenses("test-token")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("cuota") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rechaza datos incompletos y HTML de un proxy", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ total: "24.85" }));
    await expect(listExpenses("test-token")).rejects.toThrow(/contrato/);
    fetchMock.mockResolvedValueOnce(new Response("<html>Proxy</html>"));
    await expect(listExpenses("test-token")).rejects.toThrow(/JSON válido/);
  });
  it("aborta una espera larga y avisa de la incertidumbre al guardar", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_, options) => new Promise((_, reject) => { options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }));
    const result = expect(saveExpense(input, "test-token", "operation-id")).rejects.toThrow(/podría haberse guardado/);
    await vi.advanceTimersByTimeAsync(120_001);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
