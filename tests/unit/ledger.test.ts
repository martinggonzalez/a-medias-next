import { describe, expect, it } from "vitest";
import { createDemoExpense, loadDemoExpenses, persistDemoExpenses, setDemoSettlement } from "../../src/lib/demo";
import { coupleMembers, defaultParticipants, expenseInputSchema, expenseSchema, type CoupleMemberId, type ExpenseInput } from "../../src/lib/domain";
import { summarizeLedger, ticketDebt } from "../../src/lib/ledger";
import { CURRENT_MEMBER_KEY, loadCurrentMember } from "../../src/lib/preferences";

function ticket(paidById: CoupleMemberId = "adela", amountCents = 6000, extra: Partial<ExpenseInput> = {}) {
  return createDemoExpense({
    merchant: "Compra", date: "2026-10-20", currency: "EUR", participants: defaultParticipants(), splitMode: "equal",
    items: [{ id: "shared", name: "Compra común", amountCents, selected: true, ownerId: null }],
    registeredById: paidById, paidById, ...extra
  });
}

describe("identidades y preferencias de la pareja", () => {
  it("conserva nombres e identificadores entre tickets y sesiones", () => {
    expect(defaultParticipants()).toEqual(defaultParticipants());
    expect(defaultParticipants().map(({ id, name }) => ({ id, name }))).toEqual(coupleMembers);
    expect(ticket().paidById).toBe("adela");
  });
  it("recuerda quién registra y rechaza valores desconocidos", () => {
    const storage = { getItem: (key: string) => key === CURRENT_MEMBER_KEY ? "martin" : null };
    expect(loadCurrentMember(storage)).toBe("martin");
    expect(loadCurrentMember({ getItem: () => "otra-persona" })).toBe("adela");
    expect(loadCurrentMember({ getItem: () => { throw new Error("bloqueado"); } })).toBe("adela");
  });
  it("distingue registrar de pagar", () => {
    const expense = ticket("martin", 6000, { registeredById: "adela" });
    expect(expense.registeredById).toBe("adela");
    expect(ticketDebt(expense)).toEqual({ from: "adela", to: "martin", amountCents: 3000 });
  });
  it("no acepta identidades inventadas o ausentes del reparto", () => {
    expect(expenseInputSchema.safeParse({ ...ticket(), paidById: "otra" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...ticket(), participants: defaultParticipants().map((person) => ({ ...person, id: person.id + "-otro" })) }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...ticket(), participants: defaultParticipants().map((person) => ({ ...person, name: person.name + " renombrado" })) }).success).toBe(false);
  });
});

describe("gasto propio y saldo pendiente", () => {
  it("compensa importes monetarios, no el número de tickets", () => {
    const summary = summarizeLedger([ticket("adela", 6000), ticket("martin", 2000)], "EUR");
    expect(summary.totalCents).toBe(8000);
    expect(summary.sharedCents).toBe(8000);
    expect(summary.people.map((person) => person.spentCents)).toEqual([4000, 4000]);
    expect(summary.people.map((person) => person.paidCents)).toEqual([6000, 2000]);
    expect(summary.people.map((person) => person.pendingBalanceCents)).toEqual([2000, -2000]);
    expect(summary.pendingCount).toBe(2);
  });
  it("incluye los productos personales de quien no pagó", () => {
    const expense = ticket("adela", 4000);
    const mixed = ticket("adela", 4000, { items: [...expense.items, { id: "own", name: "Solo Martín", amountCents: 1000, selected: true, ownerId: "martin" }] });
    const summary = summarizeLedger([mixed], "EUR");
    expect(ticketDebt(mixed)?.amountCents).toBe(3000);
    expect(summary.sharedCents).toBe(4000);
    expect(summary.personalCents).toBe(1000);
    expect(summary.people.map((person) => [person.spentCents, person.personalCents])).toEqual([[2000, 0], [3000, 1000]]);
  });
  it("aplica pesos solo a lo compartido y conserva céntimos", () => {
    const expense = ticket("martin", 1001, { splitMode: "weighted", participants: defaultParticipants().map((person, index) => ({ ...person, weight: index === 0 ? 60 : 40 })) });
    expect(ticketDebt(expense)?.amountCents).toBe(601);
    expect(summarizeLedger([expense], "EUR").people.map((person) => person.spentCents)).toEqual([601, 400]);
  });
  it("no genera deuda para un ticket entero del propio pagador", () => {
    const expense = ticket("adela", 1000, { items: [{ id: "own", name: "Personal", amountCents: 1000, selected: true, ownerId: "adela" }] });
    expect(ticketDebt(expense)?.amountCents).toBe(0);
    expect(summarizeLedger([expense], "EUR").pendingCount).toBe(0);
  });
  it("incluye entero lo personal de la otra persona sin dividirlo", () => {
    const expense = ticket("martin", 1000, { items: [{ id: "own", name: "Personal", amountCents: 1000, selected: true, ownerId: "adela" }] });
    expect(ticketDebt(expense)?.amountCents).toBe(1000);
  });
  it("no cuenta productos excluidos y respeta descuentos personales", () => {
    const expense = ticket("adela", 4000, { items: [
      { id: "shared", name: "Compartido", amountCents: 4000, selected: true },
      { id: "own", name: "Personal", amountCents: 1000, selected: true, ownerId: "martin" },
      { id: "discount", name: "Descuento", amountCents: -100, selected: true, ownerId: "martin" },
      { id: "excluded", name: "No incluido", amountCents: 50000, selected: false, ownerId: "martin" }
    ] });
    expect(ticketDebt(expense)?.amountCents).toBe(2900);
    expect(summarizeLedger([expense], "EUR").totalCents).toBe(4900);
  });
  it("no mezcla monedas y agrega tickets de otros meses", () => {
    const summary = summarizeLedger([ticket("adela", 6000), ticket("martin", 2000, { date: "2026-09-10" }), ticket("martin", 99999, { currency: "USD" })], "EUR");
    expect(summary.totalCents).toBe(8000);
    expect(summary.people[0].pendingBalanceCents).toBe(2000);
  });
  it("un saldo neto cero no implica marcar tickets como pagados", () => {
    const summary = summarizeLedger([ticket("adela", 6000), ticket("martin", 6000)], "EUR");
    expect(summary.people.map((person) => person.pendingBalanceCents)).toEqual([0, 0]);
    expect(summary.pendingCount).toBe(2);
  });
});

describe("liquidación y compatibilidad", () => {
  it("liquidar y deshacer recalcula deudas, nunca gasto, total ni cuotas", () => {
    const original = [ticket("adela", 6000), ticket("martin", 2000)];
    const updated = setDemoSettlement(original, original[0].id, true);
    expect(updated[0].settledAt).toBeTruthy();
    const summary = summarizeLedger(updated, "EUR");
    expect(summary.people.map((person) => person.pendingBalanceCents)).toEqual([-1000, 1000]);
    expect(summary.totalCents).toBe(8000);
    expect(summary.people.map((person) => person.spentCents)).toEqual([4000, 4000]);
    expect(updated[0].shares).toEqual(original[0].shares);
    expect(original[0].settledAt).toBeNull();
    expect(summarizeLedger(setDemoSettlement(updated, original[0].id, false), "EUR")).toEqual(summarizeLedger(original, "EUR"));
  });
  it("liquidar todos los tickets incluidos en la compensación deja saldo cero", () => {
    const original = [ticket("adela", 6000), ticket("martin", 2000)];
    let updated = original;
    for (const expense of original) updated = setDemoSettlement(updated, expense.id, true);
    expect(summarizeLedger(updated, "EUR").people.map((person) => person.pendingBalanceCents)).toEqual([0, 0]);
  });
  it("marcar dos veces es idempotente y no modifica la fecha", () => {
    const original = ticket();
    const updated = setDemoSettlement([original], original.id, true);
    expect(setDemoSettlement(updated, original.id, true)).toEqual(updated);
  });
  it("restaura identidad y liquidación tras persistir", () => {
    let value = "";
    const storage = { setItem: (_key: string, content: string) => { value = content; }, getItem: () => value };
    const original = ticket("martin");
    const updated = setDemoSettlement([original], original.id, true);
    persistDemoExpenses(updated, storage);
    expect(loadDemoExpenses(storage)).toEqual(updated);
  });
  it("conserva tickets antiguos sin inventar un pagador", () => {
    const old = ticket();
    delete old.paidById;
    delete old.registeredById;
    delete old.settledAt;
    expect(expenseSchema.safeParse(old).success).toBe(true);
    const summary = summarizeLedger([old], "EUR");
    expect(summary.totalCents).toBe(6000);
    expect(summary.people.map((person) => person.pendingBalanceCents)).toEqual([0, 0]);
    expect(summary.unknownDebtCount).toBe(1);
    expect(() => setDemoSettlement([old], old.id, true)).toThrow(/pagador/);
  });
  it("no atribuye nombres antiguos desconocidos a miembros de la pareja", () => {
    const old = ticket();
    delete old.paidById;
    delete old.registeredById;
    old.participants = old.participants.map((person, index) => ({ ...person, id: `old-${index}`, name: `Persona ${index + 1}` }));
    old.shares = old.shares.map((share, index) => ({ ...share, participantId: `old-${index}`, name: `Persona ${index + 1}` }));
    expect(expenseSchema.safeParse(old).success).toBe(true);
    const summary = summarizeLedger([old], "EUR");
    expect(summary.unassignedCents).toBe(6000);
    expect(summary.people.map((person) => person.spentCents)).toEqual([0, 0]);
  });
  it("rechaza tickets borrados o liquidados sin pagador", () => {
    expect(() => setDemoSettlement([], "missing", true)).toThrow(/ya no/);
    const invalid = { ...ticket(), paidById: undefined, settledAt: new Date().toISOString() };
    expect(expenseSchema.safeParse(invalid).success).toBe(false);
  });
});
