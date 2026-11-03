import { expenseListSchema, expenseSchema, splitItems, type Expense, type ExpenseInput } from "./domain";

export const DEMO_STORAGE_KEY = "a-medias:demo:expenses:v1";

export function loadDemoExpenses(storage: Pick<Storage, "getItem">): Expense[] {
  const raw = storage.getItem(DEMO_STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("El historial local está dañado. Expórtalo o bórralo desde el navegador antes de volver a usar la demo.");
  }
  const result = expenseListSchema.safeParse(parsed);
  if (!result.success) throw new Error("El historial local no es válido. No se ha sobrescrito; borra los datos locales si quieres empezar de nuevo.");
  return result.data.items;
}

export function persistDemoExpenses(expenses: Expense[], storage: Pick<Storage, "setItem">): void {
  if (expenses.length > 500) throw new Error("La demo admite hasta 500 gastos. Exporta y elimina algunos antes de continuar.");
  const validated = expenseListSchema.parse({ items: expenses });
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(validated));
}

export function createDemoExpense(input: ExpenseInput): Expense {
  const totalCents = input.items.filter((item) => item.selected).reduce((total, item) => total + item.amountCents, 0);
  return expenseSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    totalCents,
    shares: splitItems(input.items, input.participants, input.splitMode),
    createdAt: new Date().toISOString(),
    settledAt: null
  });
}

export function setDemoSettlement(expenses: Expense[], id: string, settled: boolean): Expense[] {
  const expense = expenses.find((item) => item.id === id);
  if (!expense) throw new Error("El ticket ya no está en el historial. Actualiza antes de continuar.");
  if (!expense.paidById) throw new Error("Este ticket antiguo no tiene pagador. No se puede inventar una deuda.");
  const updated = expenseSchema.parse({ ...expense, settledAt: settled ? expense.settledAt ?? new Date().toISOString() : null });
  return expenses.map((item) => item.id === id ? updated : item);
}
