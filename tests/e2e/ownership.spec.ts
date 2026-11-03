import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function prepareTicket(page: Page) {
  await page.goto("/");
  await page.getByLabel("Comercio", { exact: true }).fill("Compra con productos personales");
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Compra común");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill("40");
  await page.getByRole("button", { name: "Añadir producto", exact: true }).click();
  await page.getByRole("textbox", { name: "Producto 2", exact: true }).fill("Producto personal");
  await page.getByRole("textbox", { name: "Importe del producto 2", exact: true }).fill("10");
  await page.getByRole("combobox", { name: "Reparto del producto 2", exact: true }).selectOption({ label: "Solo Adela" });
}

test("productos personales: cambia entre compartido, individual y excluido", async ({ page }) => {
  await prepareTicket(page);
  await expect(page.getByTestId("selected-total")).toHaveText(/50,00/);
  await expect(page.getByTestId("shared-total")).toHaveText(/40,00/);
  await expect(page.getByTestId("personal-total")).toHaveText(/10,00/);
  await expect(page.getByTestId("share-0")).toHaveText(/30,00/);
  await expect(page.getByTestId("share-1")).toHaveText(/20,00/);
  const owner = page.getByRole("combobox", { name: "Reparto del producto 2", exact: true });
  await owner.selectOption({ label: "Solo Martín" });
  await expect(page.getByTestId("share-0")).toHaveText(/20,00/);
  await expect(page.getByTestId("share-1")).toHaveText(/30,00/);
  await owner.selectOption({ label: "Compartido" });
  await expect(page.getByTestId("share-0")).toHaveText(/25,00/);
  await owner.selectOption({ label: "Solo Adela" });
  await page.getByRole("checkbox", { name: "Incluir producto 2", exact: true }).uncheck();
  await expect(owner).toBeDisabled();
  await expect(page.getByTestId("selected-total")).toHaveText(/40,00/);
  await expect(page.getByTestId("share-0")).toHaveText(/20,00/);
  await page.getByRole("checkbox", { name: "Incluir producto 2", exact: true }).check();
  await expect(owner.locator("option:checked")).toHaveText("Solo Adela");
  await expect(page.getByTestId("share-0")).toHaveText(/30,00/);
});

test("productos personales: los pesos afectan solo a lo compartido", async ({ page }) => {
  await prepareTicket(page);
  await page.getByRole("button", { name: "Proporcional", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Peso de la persona 1" }).fill("60");
  await page.getByRole("spinbutton", { name: "Peso de la persona 2" }).fill("40");
  await expect(page.getByTestId("share-0")).toHaveText(/34,00/);
  await expect(page.getByTestId("share-1")).toHaveText(/16,00/);
  await page.getByRole("combobox", { name: "Reparto del producto 1", exact: true }).selectOption({ label: "Solo Martín" });
  await expect(page.getByTestId("shared-total")).toHaveText(/0,00/);
  await expect(page.getByTestId("share-0")).toHaveText(/10,00/);
  await expect(page.getByTestId("share-1")).toHaveText(/40,00/);
});

test("productos personales: guarda, recarga y exporta propietarios y cuotas", async ({ page }) => {
  await prepareTicket(page);
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Historial" }).click();
  const expense = page.locator(".expense-card");
  await expect(expense.locator(".expense-shares")).toContainText(/Adela.*30,00.*Martín.*20,00/);
  await expense.getByText("Ver productos y reparto", { exact: true }).click();
  await expect(expense.locator(".saved-products")).toContainText("Solo Adela");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, "utf8"));
  expect(exported.items[0].items[1].ownerId).toBe(exported.items[0].participants[0].id);
  expect(exported.items[0].shares.map((share: { amountCents: number }) => share.amountCents)).toEqual([3000, 2000]);
});

test("productos personales: usa siempre las identidades fijas de la pareja", async ({ page }) => {
  await prepareTicket(page);
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 1", exact: true })).toHaveValue("Adela");
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 1", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 2", exact: true })).toHaveValue("Martín");
  await expect(page.getByRole("button", { name: "Añadir persona", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Reparto del producto 2", { exact: true })).toHaveValue("adela");
});

test("productos personales: evita guardar descuentos con una cuota negativa", async ({ page }) => {
  await prepareTicket(page);
  await page.getByRole("button", { name: "Añadir producto", exact: true }).click();
  await page.getByRole("textbox", { name: "Producto 3", exact: true }).fill("Descuento personal");
  await page.getByRole("textbox", { name: "Importe del producto 3", exact: true }).fill("-35");
  await page.getByRole("combobox", { name: "Reparto del producto 3", exact: true }).selectOption({ label: "Solo Adela" });
  await expect(page.locator(".summary-card")).toContainText("importe negativo");
  await expect(page.getByRole("button", { name: "Guardar gasto", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Importe del producto 3", exact: true }).fill("-2");
  await expect(page.getByTestId("share-0")).toHaveText(/28,00/);
  await expect(page.getByRole("button", { name: "Guardar gasto", exact: true })).toBeEnabled();
});

test("productos personales: el selector con nombres fijos se adapta al móvil", async ({ page }) => {
  await prepareTicket(page);
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
  await page.getByRole("combobox", { name: "Reparto del producto 2", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("productos-personales.png"), fullPage: true });
});
