import { expect, test } from "@playwright/test";

test("selecciona, reparte, guarda, recarga y elimina en modo local", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
  await page.goto("/");
  await expect(page.getByText("Estás probando una demo.")).toBeVisible();
  await page.getByRole("button", { name: "Cargar ticket de ejemplo" }).click();
  await expect(page.getByTestId("selected-total")).toHaveText(/24,85/);
  await page.getByRole("checkbox", { name: "Incluir producto 4", exact: true }).uncheck();
  await expect(page.getByTestId("selected-total")).toHaveText(/20,30/);
  await expect(page.getByTestId("share-0")).toHaveText(/10,15/);
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 1", exact: true })).toHaveValue("Adela");
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 2", exact: true })).toHaveValue("Martín");
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Las cuentas, a la vista" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "La despensa" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.getByRole("heading", { name: "La despensa" })).toBeVisible();
  await page.getByText("Ver productos y reparto", { exact: true }).click();
  await expect(page.getByText("Café molido", { exact: false })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar gasto de La despensa" }).click();
  await expect(page.getByRole("heading", { name: "Todavía no hay gastos para este mes" })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("calcula pesos 60/40 y no pierde céntimos", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cargar ticket de ejemplo" }).click();
  await page.getByRole("button", { name: "Proporcional", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Peso de la persona 1" }).fill("60");
  await page.getByRole("spinbutton", { name: "Peso de la persona 2" }).fill("40");
  await expect(page.getByTestId("share-0")).toHaveText(/14,91/);
  await expect(page.getByTestId("share-1")).toHaveText(/9,94/);
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "La despensa" })).toBeVisible();
});

test("permite productos manuales, descuentos y nombres fijos", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Comercio", { exact: true }).fill("Compra manual");
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Compra compartida");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill("10,01");
  await page.getByRole("button", { name: "Añadir producto", exact: true }).click();
  await page.getByRole("textbox", { name: "Producto 2", exact: true }).fill("Descuento");
  await page.getByRole("textbox", { name: "Importe del producto 2", exact: true }).fill("-0,01");
  await expect(page.getByTestId("selected-total")).toHaveText(/10,00/);
  await expect(page.getByTestId("share-0")).toHaveText(/5,00/);
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 2", exact: true })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compra manual" })).toBeVisible();
});

test("valida la imagen y muestra vista previa sin fingir lectura IA", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Seleccionar imagen del ticket", { exact: true });
  await input.setInputFiles({ name: "foto.heic", mimeType: "image/heic", buffer: Buffer.from("heic") });
  await expect(page.getByRole("alert")).toContainText("HEIC");
  await input.setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nG0AAAAASUVORK5CYII=", "base64") });
  await expect(page.getByRole("img", { name: "Vista previa del ticket seleccionado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interpretar con IA" })).toHaveCount(0);
  await page.getByRole("button", { name: "Quitar foto", exact: true }).click();
  await expect(page.getByRole("img", { name: "Vista previa del ticket seleccionado" })).toHaveCount(0);
});

test("exporta JSON y se adapta a la pantalla sin desplazamiento horizontal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cargar ticket de ejemplo" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath("a-medias.png"), fullPage: true });
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^a-medias-gastos-.*\.json$/);
  await expect(page.getByRole("heading", { name: "La despensa" })).toBeVisible();
});
