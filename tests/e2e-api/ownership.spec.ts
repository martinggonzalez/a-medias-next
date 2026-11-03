import { expect, test } from "@playwright/test";
import { createDemoExpense } from "../../src/lib/demo";
import { type Expense, type ExpenseInput } from "../../src/lib/domain";

const cors = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:3100",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
};

test("productos personales: envía ownerId y muestra el reparto guardado por la API", async ({ page }) => {
  let saved: Expense | undefined;
  await page.route("https://spring.example.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (new URL(request.url()).pathname.endsWith("/login")) return route.fulfill({ headers: cors, json: { accessToken: "test-token", expiresIn: 3600 } });
    if (request.method() === "POST") {
      const input = request.postDataJSON() as ExpenseInput;
      expect(input.items.map((item) => item.ownerId)).toEqual([null, input.participants[0].id]);
      saved = createDemoExpense(input);
      return route.fulfill({ status: 201, headers: cors, json: saved });
    }
    return route.fulfill({ headers: cors, json: { items: saved ? [saved] : [] } });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Comercio", { exact: true }).fill("Compra personal vía API");
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Compra común");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill("40");
  await page.getByRole("button", { name: "Añadir producto", exact: true }).click();
  await page.getByRole("textbox", { name: "Producto 2", exact: true }).fill("Producto personal");
  await page.getByRole("textbox", { name: "Importe del producto 2", exact: true }).fill("10");
  await page.getByRole("combobox", { name: "Reparto del producto 2", exact: true }).selectOption({ label: "Solo Adela" });
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compra personal vía API" })).toBeVisible();
  expect(saved?.shares.map((share) => share.amountCents)).toEqual([3000, 2000]);
  await page.getByText("Ver productos y reparto", { exact: true }).click();
  await expect(page.locator(".saved-products")).toContainText("Solo Adela");
});
