import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveExpense, setExpenseSettlement } from "../../src/lib/api";
import { createDemoExpense } from "../../src/lib/demo";
import { defaultParticipants, type ExpenseInput } from "../../src/lib/domain";

const input: ExpenseInput = {
  merchant: "Compra API", date: "2026-10-20", currency: "EUR", splitMode: "equal", participants: defaultParticipants(),
  items: [{ id: "shared", name: "Común", amountCents: 4000, selected: true, ownerId: null }, { id: "own", name: "Personal", amountCents: 1000, selected: true, ownerId: "martin" }],
  registeredById: "martin", paidById: "adela"
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://spring.example.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("contrato de registro y pago", () => {
  it("envía y conserva quién registra y quién adelanta la compra", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(createDemoExpense(input)));
    const saved = await saveExpense(input, "token-test", "key-test");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ registeredById: "martin", paidById: "adela" });
    expect(saved.registeredById).toBe("martin");
    expect(saved.paidById).toBe("adela");
  });
  it("rechaza un backend antiguo que omita quién registra o paga", async () => {
    const old = createDemoExpense(input);
    delete old.paidById;
    delete old.registeredById;
    fetchMock.mockResolvedValueOnce(Response.json(old));
    await expect(saveExpense(input, "token-test", "key-test")).rejects.toThrow(/no ha conservado/);
  });
  it("rechaza un guardado nuevo devuelto como liquidado", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...createDemoExpense(input), settledAt: new Date().toISOString() }));
    await expect(saveExpense(input, "token-test", "key-test")).rejects.toThrow(/liquidado/);
  });
});

describe("contrato de liquidación", () => {
  it("envía PATCH autenticado con estado explícito y acepta el ticket completo", async () => {
    const expense = { ...createDemoExpense(input), id: "expense/one" };
    const updated = { ...expense, settledAt: new Date().toISOString() };
    fetchMock.mockResolvedValueOnce(Response.json(updated));
    expect(await setExpenseSettlement(expense, true, "token-test")).toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith("https://spring.example.test/api/expenses/expense%2Fone/settlement", expect.objectContaining({ method: "PATCH", body: '{"settled":true}', headers: { Authorization: "Bearer token-test", "Content-Type": "application/json" } }));
    expect(expense.settledAt).toBeNull();
  });
  it("desmarca con settled false, sin crear otro ticket", async () => {
    const expense = { ...createDemoExpense(input), settledAt: new Date().toISOString() };
    fetchMock.mockResolvedValueOnce(Response.json({ ...expense, settledAt: null }));
    const updated = await setExpenseSettlement(expense, false, "token-test");
    expect(updated.settledAt).toBeNull();
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"settled":false}');
  });
  it("rechaza estados ignorados o cambios inesperados de pagador", async () => {
    const expense = createDemoExpense(input);
    fetchMock.mockResolvedValueOnce(Response.json(expense));
    await expect(setExpenseSettlement(expense, true, "token-test")).rejects.toThrow(/no confirmó/);
    fetchMock.mockResolvedValueOnce(Response.json({ ...expense, paidById: "martin", settledAt: new Date().toISOString() }));
    await expect(setExpenseSettlement(expense, true, "token-test")).rejects.toThrow(/cambió/);
  });
  it("no reintenta ni modifica el ticket tras fallar", async () => {
    const expense = createDemoExpense(input);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(setExpenseSettlement(expense, true, "token-test")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expense.settledAt).toBeNull();
  });
  it("no intenta liquidar sin pagador ni token", async () => {
    const old = createDemoExpense(input);
    delete old.paidById;
    await expect(setExpenseSettlement(old, true, "token-test")).rejects.toThrow(/pagador/);
    await expect(setExpenseSettlement(createDemoExpense(input), true, "")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
