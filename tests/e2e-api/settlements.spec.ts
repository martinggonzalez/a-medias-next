import { expect, test, type Page } from "@playwright/test";
import { createDemoExpense } from "../../src/lib/demo";
import { type Expense, type ExpenseInput } from "../../src/lib/domain";

const cors = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:3100",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
};

async function loginAndSave(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("test@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestro espacio privado" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "¿Quién registra el ticket?", exact: true }).selectOption("martin");
  await page.getByRole("combobox", { name: "¿Quién ha pagado la compra?", exact: true }).selectOption("adela");
  await page.getByLabel("Comercio", { exact: true }).fill("Compra remota");
  await page.getByLabel("Producto 1", { exact: true }).fill("Comida");
  await page.getByLabel("Importe del producto 1", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compra remota", exact: true })).toBeVisible();
}

for (const shouldFail of [false, true]) {
  test(shouldFail ? "liquidar: un rechazo no cambia deuda ni checkbox" : "liquidar: envía PATCH y restaura la confirmación de la API", async ({ page }) => {
    let saved: Expense | undefined;
    let patches = 0;
    await page.route("https://spring.example.test/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (path.endsWith("/login")) return route.fulfill({ headers: cors, json: { accessToken: "test-token", expiresIn: 3600 } });
      expect(request.headers().authorization).toBe("Bearer test-token");
      if (request.method() === "PATCH") {
        patches += 1;
        expect(path).toBe(`/api/expenses/${saved!.id}/settlement`);
        const body = request.postDataJSON() as { settled: boolean };
        expect(body).toEqual({ settled: true });
        if (shouldFail) return route.fulfill({ status: 403, headers: cors });
        saved = { ...saved!, settledAt: new Date().toISOString() };
        return route.fulfill({ headers: cors, json: saved });
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON() as ExpenseInput;
        expect(input).toMatchObject({ registeredById: "martin", paidById: "adela" });
        saved = createDemoExpense(input);
        return route.fulfill({ status: 201, headers: cors, json: saved });
      }
      return route.fulfill({ headers: cors, json: { items: saved ? [saved] : [] } });
    });
    await loginAndSave(page);
    await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 30,00.*a Adela/);
    page.once("dialog", (dialog) => dialog.accept());
    const checkbox = page.getByRole("checkbox", { name: "Liquidar ticket de Compra remota" });
    await checkbox.click();
    if (shouldFail) {
      await expect(page.getByRole("alert").filter({ hasText: "No tienes acceso" })).toBeVisible();
      await expect(checkbox).not.toBeChecked();
      await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 30,00.*a Adela/);
      expect(saved?.settledAt).toBeNull();
    } else {
      await expect(checkbox).toBeChecked();
      await expect(page.getByTestId("net-debt")).toHaveText("No hay saldo neto pendiente");
      await page.getByRole("button", { name: "Actualizar", exact: true }).click();
      await expect(checkbox).toBeChecked();
      expect(saved?.settledAt).toBeTruthy();
    }
    await expect(page.getByTestId("monthly-total")).toHaveText(/60,00/);
    await expect(page.getByTestId("spent-adela")).toHaveText(/30,00/);
    expect(patches).toBe(1);
  });
}
