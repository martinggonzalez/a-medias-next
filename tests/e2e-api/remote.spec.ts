import { expect, test } from "@playwright/test";
import { createDemoExpense } from "../../src/lib/demo";
import { sampleReceipt, type Expense, type ExpenseInput } from "../../src/lib/domain";

const cors = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:3100",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
};

test("login, lectura, guardado autenticado y sesión no persistida", async ({ page }) => {
  let expenses: Expense[] = [];
  let uploads = 0;
  let saves = 0;
  await page.route("https://spring.example.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path === "/api/auth/login") {
      expect(request.postDataJSON()).toEqual({ email: "ana@example.test", password: "test-password" });
      await route.fulfill({ headers: cors, json: { accessToken: "test-bearer", expiresIn: 3600 } });
      return;
    }
    expect(request.headers().authorization).toBe("Bearer test-bearer");
    if (path === "/api/receipts/analyze") {
      uploads += 1;
      expect(request.headers()["content-type"]).toContain("multipart/form-data; boundary=");
      expect(request.postDataBuffer()?.toString()).toContain('name="image"');
      await route.fulfill({ headers: cors, json: sampleReceipt() });
      return;
    }
    if (path === "/api/expenses" && request.method() === "POST") {
      saves += 1;
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      const expense = createDemoExpense(request.postDataJSON() as ExpenseInput);
      expenses = [expense, ...expenses];
      await route.fulfill({ status: 201, headers: cors, json: expense });
      return;
    }
    if (path === "/api/expenses") {
      await route.fulfill({ headers: cors, json: { items: expenses } });
      return;
    }
    await route.fulfill({ status: 404, headers: cors });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toHaveCount(0);
  await page.getByLabel("Seleccionar imagen del ticket", { exact: true }).setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nG0AAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: "Interpretar con IA", exact: false }).click();
  await expect(page.getByTestId("selected-total")).toHaveText(/24,85/);
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "La despensa" })).toBeVisible();
  expect(uploads).toBe(1);
  expect(saves).toBe(1);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toMatch(/test-bearer|test-password|La despensa/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "La despensa" })).toHaveCount(0);
});

test("si se agota la cuota, permite entrada manual y no reintenta IA", async ({ page }) => {
  let reads = 0;
  await page.route("https://spring.example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.endsWith("/login")) return route.fulfill({ headers: cors, json: { accessToken: "test-bearer", expiresIn: 3600 } });
    if (path.endsWith("/analyze")) { reads += 1; return route.fulfill({ status: 429, headers: cors }); }
    return route.fulfill({ headers: cors, json: { items: [] } });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toHaveCount(0);
  await page.getByLabel("Seleccionar imagen del ticket", { exact: true }).setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: Buffer.from("photo") });
  await page.getByRole("button", { name: "Interpretar con IA", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText("cuota de IA");
  await expect(page.getByRole("textbox", { name: "Producto 1", exact: true })).toBeEnabled();
  expect(reads).toBe(1);
});

test("retira el borrador y la foto si el backend invalida la sesión", async ({ page }) => {
  await page.route("https://spring.example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.endsWith("/login")) return route.fulfill({ headers: cors, json: { accessToken: "test-bearer", expiresIn: 3600 } });
    if (path.endsWith("/analyze")) return route.fulfill({ status: 401, headers: cors });
    return route.fulfill({ headers: cors, json: { items: [] } });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toHaveCount(0);
  await page.getByLabel("Comercio", { exact: true }).fill("Borrador privado");
  await page.getByLabel("Seleccionar imagen del ticket", { exact: true }).setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: Buffer.from("photo") });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Interpretar con IA", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toBeVisible();
  await expect(page.getByLabel("Comercio", { exact: true })).toHaveValue("");
  await expect(page.getByRole("img", { name: "Vista previa del ticket seleccionado" })).toHaveCount(0);
});
