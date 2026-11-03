import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDemoExpense, DEMO_STORAGE_KEY } from "../../src/lib/demo";
import { defaultParticipants, localDate, type CoupleMemberId } from "../../src/lib/domain";

async function saveTicket(page: Page, merchant: string, paidById: CoupleMemberId, amount: string, date?: string) {
  await page.getByRole("button", { name: "Nuevo gasto", exact: true }).click();
  await page.getByRole("combobox", { name: "¿Quién registra el ticket?", exact: true }).selectOption(paidById);
  await page.getByLabel("Comercio", { exact: true }).fill(merchant);
  if (date) await page.getByLabel("Fecha", { exact: true }).fill(date);
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Compra compartida");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill(amount);
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Las cuentas, a la vista", exact: true })).toBeVisible();
  if (!date || date.startsWith(localDate().slice(0, 7))) await expect(page.getByRole("heading", { name: merchant, exact: true })).toBeVisible();
}

test("recuerda al registrador, mantiene nombres fijos y distingue al pagador", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "¿Quién registra el ticket?", exact: true }).selectOption("martin");
  await page.getByRole("combobox", { name: "¿Quién ha pagado la compra?", exact: true }).selectOption("adela");
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 1", exact: true })).toHaveValue("Adela");
  await expect(page.getByRole("textbox", { name: "Nombre de la persona 2", exact: true })).toHaveAttribute("readonly", "");
  await page.getByLabel("Comercio", { exact: true }).fill("Registro delegado");
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Comida");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill("60");
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.locator(".ticket-provenance")).toHaveText("Registrado por Martín · Pagó Adela");
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 30,00.*a Adela/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "¿Quién registra el ticket?", exact: true })).toHaveValue("martin");
  await expect(page.getByRole("combobox", { name: "¿Quién ha pagado la compra?", exact: true })).toHaveValue("martin");
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.locator(".ticket-provenance")).toHaveText("Registrado por Martín · Pagó Adela");
});

test("compensa compras de ambos y liquidar o deshacer no borra el gasto", async ({ page }) => {
  await page.goto("/");
  await saveTicket(page, "Compra Adela", "adela", "60");
  await saveTicket(page, "Compra Martín", "martin", "20");
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 20,00.*a Adela/);
  await expect(page.getByTestId("monthly-total")).toHaveText(/80,00/);
  await expect(page.getByTestId("monthly-shared")).toHaveText(/80,00/);
  for (const member of ["adela", "martin"]) await expect(page.getByTestId(`spent-${member}`)).toHaveText(/40,00/);
  const first = page.getByRole("checkbox", { name: "Liquidar ticket de Compra Adela", exact: true });
  page.once("dialog", (dialog) => dialog.accept());
  await first.check();
  await expect(page.getByTestId("net-debt")).toHaveText(/Adela debe 10,00.*a Martín/);
  await expect(page.getByTestId("monthly-total")).toHaveText(/80,00/);
  await expect(page.getByTestId("spent-adela")).toHaveText(/40,00/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("checkbox", { name: "Liquidar ticket de Compra Martín", exact: true }).check();
  await expect(page.getByTestId("net-debt")).toHaveText("No hay saldo neto pendiente");
  await page.reload();
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(first).toBeChecked();
  await first.uncheck();
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 30,00.*a Adela/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("historial-liquidaciones.png"), fullPage: true });
});

test("incluye productos personales, permite cancelar y exporta identidad y Bizum", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Comercio", { exact: true }).fill("Compra mixta");
  await page.getByRole("textbox", { name: "Producto 1", exact: true }).fill("Común");
  await page.getByRole("textbox", { name: "Importe del producto 1", exact: true }).fill("40");
  await page.getByRole("button", { name: "Añadir producto", exact: true }).click();
  await page.getByRole("textbox", { name: "Producto 2", exact: true }).fill("Solo Martín");
  await page.getByRole("textbox", { name: "Importe del producto 2", exact: true }).fill("10");
  await page.getByLabel("Reparto del producto 2", { exact: true }).selectOption("martin");
  await page.getByRole("button", { name: "Guardar gasto", exact: true }).click();
  await expect(page.getByTestId("monthly-shared")).toHaveText(/40,00/);
  await expect(page.getByTestId("monthly-personal")).toHaveText(/10,00/);
  await expect(page.getByTestId("spent-adela")).toHaveText(/20,00/);
  await expect(page.getByTestId("spent-martin")).toHaveText(/30,00/);
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 30,00.*a Adela/);
  const checkbox = page.getByRole("checkbox", { name: "Liquidar ticket de Compra mixta" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON", exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.format).toBe("a-medias-expenses-v2");
  expect(exported.items[0]).toMatchObject({ registeredById: "adela", paidById: "adela", settledAt: expect.any(String) });
  expect(exported.items[0].shares.map((share: { amountCents: number }) => share.amountCents)).toEqual([2000, 3000]);
});

test("el mes filtra gastos pero no oculta deudas pendientes de otros meses", async ({ page }) => {
  const previousMonth = new Date();
  previousMonth.setDate(15);
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  await page.goto("/");
  await saveTicket(page, "Compra actual", "adela", "60");
  await saveTicket(page, "Compra anterior", "martin", "20", localDate(previousMonth));
  await expect(page.getByTestId("monthly-total")).toHaveText(/60,00/);
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 20,00.*a Adela/);
  await page.getByLabel("Mes", { exact: true }).fill(localDate(previousMonth).slice(0, 7));
  await expect(page.getByTestId("monthly-total")).toHaveText(/20,00/);
  await expect(page.getByTestId("net-debt")).toHaveText(/Martín debe 20,00.*a Adela/);
});

test("los tickets antiguos conservan su total sin inventar pagador", async ({ page }) => {
  const old = createDemoExpense({ merchant: "Ticket antiguo", date: localDate(), currency: "EUR", participants: defaultParticipants(), splitMode: "equal", items: [{ id: "old", name: "Comida", amountCents: 6000, selected: true }] });
  await page.addInitScript(({ key, expense }) => { localStorage.setItem(key, JSON.stringify({ items: [expense] })); }, { key: DEMO_STORAGE_KEY, expense: old });
  await page.goto("/");
  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.getByTestId("monthly-total")).toHaveText(/60,00/);
  await expect(page.getByTestId("net-debt")).toHaveText("No hay saldo neto pendiente");
  await expect(page.getByRole("checkbox", { name: "Liquidar ticket de Ticket antiguo" })).toBeDisabled();
  await expect(page.locator(".balance-card")).toContainText("sin pagador");
});
