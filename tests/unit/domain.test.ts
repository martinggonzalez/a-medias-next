import { describe, expect, it } from "vitest";
import { amountInput, expenseInputSchema, expenseSchema, localDate, makeExpenseInput, MAX_LINE_CENTS, money, receiptSchema, sampleReceipt, splitAmount, splitItems, toCents, validateImage, type ExpenseInput, type Participant } from "../../src/lib/domain";
import { createDemoExpense } from "../../src/lib/demo";

const people: Participant[] = [{ id: "first", name: "Ana", weight: 60 }, { id: "second", name: "Alex", weight: 40 }];
export const input: ExpenseInput = {
  merchant: "Mercado",
  date: "2026-10-19",
  currency: "EUR",
  items: [{ id: "line-1", name: "Pan", amountCents: 101, selected: true }, { id: "line-2", name: "Personal", amountCents: 500, selected: false }],
  participants: people,
  splitMode: "equal"
};

describe("importes", () => {
  it.each([["12,34", 1234], ["12.34", 1234], ["0,01", 1], [" 10,5 ", 1050], ["-0,85", -85], ["1", 100]])("convierte %s a céntimos", (value, expected) => {
    expect(toCents(value)).toBe(expected);
  });
  it.each(["", "1.234,56", "1,234.56", "2e3", "NaN", "1,005", "Infinity", "--3", "0x1", "1000001", "12,3,4"])("rechaza %s", (value) => {
    expect(toCents(value)).toBeNull();
  });
  it("respeta el límite y el formato editable", () => {
    expect(toCents("1000000")).toBe(MAX_LINE_CENTS);
    expect(amountInput(-85)).toBe("-0,85");
    expect(money(101, "EUR")).toMatch(/1,01/);
  });
  it("usa la fecha local sin convertir a UTC", () => {
    const date = new Date(2026, 9, 19, 0, 5);
    expect(localDate(date)).toBe("2026-10-19");
  });
});

describe("reparto exacto", () => {
  it("reparte céntimos sobrantes por orden estable", () => {
    expect(splitAmount(101, people, "equal").map((share) => share.amountCents)).toEqual([51, 50]);
    expect(splitAmount(1, people, "equal").map((share) => share.amountCents)).toEqual([1, 0]);
  });
  it("admite pesos que no suman cien", () => {
    expect(splitAmount(2485, people, "weighted").map((share) => share.amountCents)).toEqual([1491, 994]);
    expect(splitAmount(5, [{ ...people[0], weight: 2 }, { ...people[1], weight: 1 }], "weighted").map((share) => share.amountCents)).toEqual([3, 2]);
  });
  it("conserva todos los céntimos para 2 a 8 participantes", () => {
    for (let count = 2; count <= 8; count += 1) {
      const participants = Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Persona ${index + 1}`, weight: (index + 1) * 13 }));
      for (let total = 0; total < 1000; total += 7) {
        for (const mode of ["equal", "weighted"] as const) {
          const shares = splitAmount(total, participants, mode);
          expect(shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(total);
          expect(shares.every((share) => Number.isInteger(share.amountCents) && share.amountCents >= 0)).toBe(true);
        }
      }
    }
  });
  it("rechaza importes y pesos inválidos", () => {
    expect(() => splitAmount(-1, people, "equal")).toThrow();
    expect(() => splitAmount(1.2, people, "equal")).toThrow();
    expect(() => splitAmount(1, [people[0]], "equal")).toThrow();
    expect(() => splitAmount(1, [{ ...people[0], weight: 0 }, people[1]], "weighted")).toThrow();
  });
});

describe("productos compartidos e individuales", () => {
  const mixed: ExpenseInput = { ...input, items: [
    { id: "shared", name: "Compra común", amountCents: 6000, selected: true, ownerId: null },
    { id: "ana", name: "Personal de Ana", amountCents: 1000, selected: true, ownerId: "first" },
    { id: "alex", name: "Personal de Alex", amountCents: 3000, selected: true, ownerId: "second" }
  ] };

  it("suma cada producto personal íntegro a su propietario", () => {
    const expense = createDemoExpense(mixed);
    expect(expense.totalCents).toBe(10000);
    expect(expense.shares.map((share) => share.amountCents)).toEqual([4000, 6000]);
    expect(expense.items.map((item) => item.ownerId)).toEqual([null, "first", "second"]);
  });
  it("aplica los pesos solo al subtotal compartido", () => {
    expect(splitItems(mixed.items, people, "weighted").map((share) => share.amountCents)).toEqual([4600, 5400]);
  });
  it("permite tickets enteramente individuales y excluye lo desmarcado", () => {
    const items = mixed.items.map((item) => item.ownerId == null ? { ...item, selected: false } : item);
    expect(createDemoExpense({ ...mixed, items }).shares.map((share) => share.amountCents)).toEqual([1000, 3000]);
    expect(splitItems(items.map((item) => item.ownerId === "first" ? { ...item, selected: false } : item), people, "equal").map((share) => share.amountCents)).toEqual([0, 3000]);
  });
  it("redondea únicamente lo compartido sin dividir lo individual", () => {
    const items = mixed.items.map((item, index) => ({ ...item, amountCents: index === 0 ? 101 : index }));
    expect(splitItems(items, people, "equal").map((share) => share.amountCents)).toEqual([52, 52]);
  });
  it("descuenta las líneas personales solo a su propietario", () => {
    const items = [...mixed.items, { id: "discount", name: "Descuento de Ana", amountCents: -200, selected: true, ownerId: "first" }];
    expect(createDemoExpense({ ...mixed, items }).shares.map((share) => share.amountCents)).toEqual([3800, 6000]);
  });
  it("reparte descuentos compartidos incluso si su subtotal es negativo", () => {
    const items = mixed.items.map((item) => item.ownerId == null ? { ...item, amountCents: -1 } : item);
    expect(createDemoExpense({ ...mixed, items }).shares.map((share) => share.amountCents)).toEqual([999, 3000]);
  });
  it("rechaza descuentos que dejen una cuota individual negativa", () => {
    const items = [{ ...mixed.items[0], amountCents: 100 }, { ...mixed.items[1], amountCents: -75 }];
    expect(expenseInputSchema.safeParse({ ...mixed, items }).success).toBe(false);
    expect(() => makeExpenseInput("Mercado", input.date, "EUR", [
      { id: "shared", name: "Compra", amount: "1", selected: true },
      { id: "discount", name: "Descuento", amount: "-0,75", selected: true, ownerId: "first" }
    ], people, "equal")).toThrow(/descuentos/);
  });
  it("rechaza propietarios ajenos al reparto, incluso en líneas excluidas", () => {
    for (const selected of [true, false]) {
      const items = [...mixed.items, { ...mixed.items[1], id: "unknown", ownerId: "missing", selected }];
      expect(expenseInputSchema.safeParse({ ...mixed, items }).success).toBe(false);
      expect(() => splitItems(items, people, "equal")).toThrow(/propietario/);
    }
  });
  it("conserva la asignación al renombrar a una persona", () => {
    const renamed = people.map((person) => person.id === "first" ? { ...person, name: "Martín" } : person);
    expect(splitItems(mixed.items, renamed, "equal")[0]).toEqual({ participantId: "first", name: "Martín", amountCents: 4000 });
  });
  it("valida sin lanzar excepciones al recibir pesos o propietarios inválidos", () => {
    expect(expenseInputSchema.safeParse({ ...mixed, participants: [{ ...people[0], weight: 0 }, people[1]], splitMode: "weighted" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...mixed, items: [{ ...mixed.items[0], ownerId: "" }] }).success).toBe(false);
  });
  it("rechaza un servidor que siga repartiendo también lo personal", () => {
    const expense = createDemoExpense(mixed);
    expect(expenseSchema.safeParse({ ...expense, shares: splitAmount(expense.totalCents, people, "equal") }).success).toBe(false);
  });
  it("conserva el historial anterior sin campo ownerId", () => {
    const expense = createDemoExpense(input);
    expect(expenseSchema.safeParse(expense).success).toBe(true);
    expect(expense.shares.map((share) => share.amountCents)).toEqual([51, 50]);
  });
  it("envía propietarios en el borrador y null para los productos compartidos", () => {
    const result = makeExpenseInput("Mercado", input.date, "EUR", [
      { id: "shared", name: "Compra común", amount: "60", selected: true },
      { id: "personal", name: "Producto personal", amount: "10", selected: true, ownerId: "first" }
    ], people, "equal");
    expect(result.items.map((item) => item.ownerId)).toEqual([null, "first"]);
  });
  it("conserva todos los céntimos con productos individuales entre 2 y 8 personas", () => {
    for (let count = 2; count <= 8; count += 1) {
      const participants = Array.from({ length: count }, (_, index) => ({ id: `person-${index}`, name: `Persona ${index + 1}`, weight: index + 1 }));
      const personal = participants.map((person, index) => ({ amountCents: (index + 1) * 11, selected: true, ownerId: person.id }));
      for (let shared = 1; shared < 350; shared += 17) {
        const items = [{ amountCents: shared, selected: true, ownerId: null }, ...personal];
        for (const mode of ["equal", "weighted"] as const) {
          const shares = splitItems(items, participants, mode);
          expect(shares.reduce((total, share) => total + share.amountCents, 0)).toBe(items.reduce((total, item) => total + item.amountCents, 0));
          expect(shares.every((share, index) => Number.isInteger(share.amountCents) && share.amountCents >= personal[index].amountCents)).toBe(true);
        }
      }
    }
  });
});

describe("contrato y borrador", () => {
  it("ignora filas vacías y conserva las excluidas", () => {
    const result = makeExpenseInput(" Mercado ", "2026-10-19", "EUR", [
      { id: "a", name: "Pan", amount: "1,01", selected: true },
      { id: "b", name: "Personal", amount: "5", selected: false },
      { id: "c", name: "", amount: "", selected: true }
    ], people, "equal");
    expect(result.merchant).toBe("Mercado");
    expect(result.items).toHaveLength(2);
    expect(createDemoExpense(result).totalCents).toBe(101);
  });
  it("admite descuentos sin permitir totales seleccionados negativos", () => {
    expect(expenseInputSchema.safeParse({ ...input, items: [...input.items, { id: "discount", name: "Descuento", amountCents: -85, selected: true }] }).success).toBe(true);
    expect(expenseInputSchema.safeParse({ ...input, items: [{ ...input.items[0], amountCents: -1 }] }).success).toBe(false);
  });
  it("rechaza nombres e identificadores duplicados", () => {
    expect(expenseInputSchema.safeParse({ ...input, participants: [people[0], { ...people[1], name: " ana " }] }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...input, items: [input.items[0], input.items[0]] }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...input, participants: [people[0], { ...people[1], id: "first" }] }).success).toBe(false);
  });
  it("exige desglose para seleccionar productos, no solo total de ticket", () => {
    expect(receiptSchema.safeParse(sampleReceipt()).success).toBe(true);
    expect(receiptSchema.safeParse({ ...sampleReceipt(), items: [] }).success).toBe(false);
  });
  it("rechaza una fecha inexistente y una moneda no admitida", () => {
    expect(expenseInputSchema.safeParse({ ...input, date: "2026-02-30" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...input, currency: "JPY" }).success).toBe(false);
  });
  it("valida el reparto devuelto por el servidor", () => {
    const expense = createDemoExpense(input);
    expect(expenseSchema.safeParse(expense).success).toBe(true);
    expect(expenseSchema.safeParse({ ...expense, totalCents: 100 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, shares: expense.shares.map((share) => ({ ...share, amountCents: 999 })) }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, shares: [...expense.shares].reverse() }).success).toBe(false);
  });
});

describe("fotos", () => {
  it("admite fotos JPG, PNG y WebP hasta 8 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() => validateImage({ type, size: 8 * 1024 * 1024 })).not.toThrow();
    }
  });
  it("rechaza HEIC, SVG, vacías y demasiado grandes", () => {
    for (const file of [{ type: "image/heic", size: 100 }, { type: "image/svg+xml", size: 100 }, { type: "image/png", size: 0 }, { type: "image/png", size: 8 * 1024 * 1024 + 1 }]) {
      expect(() => validateImage(file)).toThrow();
    }
  });
});
