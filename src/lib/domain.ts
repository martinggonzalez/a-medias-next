import { z } from "zod";

export const currencies = ["EUR", "USD", "GBP"] as const;
export type Currency = (typeof currencies)[number];
export const coupleMembers = [{ id: "adela", name: "Adela" }, { id: "martin", name: "Martín" }] as const;
export type CoupleMemberId = (typeof coupleMembers)[number]["id"];
const memberIdSchema = z.enum(["adela", "martin"]);
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_LINE_CENTS = 100_000_000;
export const MAX_LINES = 100;
export const MAX_PARTICIPANTS = 8;

export type DraftLine = { id: string; name: string; amount: string; selected: boolean; ownerId?: string | null };
export type Participant = { id: string; name: string; weight: number };
export type SplitMode = "equal" | "weighted";
export type Share = { participantId: string; name: string; amountCents: number };

const centsSchema = z.number().int().min(-MAX_LINE_CENTS).max(MAX_LINE_CENTS);
const currencySchema = z.enum(currencies);
const dateSchema = z.iso.date();
const lineSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  amountCents: centsSchema,
  selected: z.boolean(),
  ownerId: z.string().min(1).max(100).nullable().optional()
});
const participantSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  weight: z.number().int().min(1).max(10_000)
});

export const receiptSchema = z.object({
  merchant: z.string().trim().min(1).max(120),
  date: dateSchema,
  currency: currencySchema,
  totalCents: z.number().int().min(0).max(MAX_LINE_CENTS * MAX_LINES),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    amountCents: centsSchema
  })).min(1).max(MAX_LINES),
  warnings: z.array(z.string().max(500)).max(20).default([])
});

export type Receipt = z.infer<typeof receiptSchema>;

export const expenseInputSchema = z.object({
  merchant: z.string().trim().min(1).max(120),
  date: dateSchema,
  currency: currencySchema,
  items: z.array(lineSchema).min(1).max(MAX_LINES),
  participants: z.array(participantSchema).min(2).max(MAX_PARTICIPANTS),
  splitMode: z.enum(["equal", "weighted"]),
  registeredById: memberIdSchema.optional(),
  paidById: memberIdSchema.optional()
}).superRefine((expense, context) => {
  const ids = expense.items.map((item) => item.id);
  const names = expense.participants.map((participant) => participant.name.toLocaleLowerCase("es"));
  const participantIds = expense.participants.map((participant) => participant.id);
  if (new Set(ids).size !== ids.length || new Set(participantIds).size !== participantIds.length) {
    context.addIssue({ code: "custom", message: "Hay identificadores repetidos." });
  }
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", message: "Usa un nombre distinto para cada persona." });
  }
  if ([expense.registeredById, expense.paidById].some((memberId) => memberId !== undefined && !participantIds.includes(memberId))) {
    context.addIssue({ code: "custom", message: "Quien registra y quien paga deben pertenecer al reparto con su identificador fijo." });
  }
  if ((expense.registeredById || expense.paidById) && (expense.participants.length !== 2 || coupleMembers.some((person) => !expense.participants.some((participant) => participant.id === person.id && participant.name === person.name)))) {
    context.addIssue({ code: "custom", message: "Usa las identidades fijas Adela y Martín para registrar los tickets de la pareja." });
  }
  const unknownOwner = expense.items.findIndex((item) => item.ownerId != null && !participantIds.includes(item.ownerId));
  if (unknownOwner !== -1) {
    context.addIssue({ code: "custom", path: ["items", unknownOwner, "ownerId"], message: "El propietario del producto debe ser una de las personas del reparto." });
    return;
  }
  const totalCents = expense.items.filter((item) => item.selected).reduce((total, item) => total + item.amountCents, 0);
  if (totalCents <= 0) {
    context.addIssue({ code: "custom", message: "Selecciona productos con un total mayor que cero." });
  }
  try {
    if (splitItems(expense.items, expense.participants, expense.splitMode).some((share) => share.amountCents < 0)) {
      context.addIssue({ code: "custom", message: "Los descuentos no pueden dejar a una persona con un importe negativo. Revisa a quién asignas cada descuento." });
    }
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "El reparto no es válido." });
  }
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const expenseSchema = z.object({
  id: z.string().min(1).max(100),
  merchant: z.string().trim().min(1).max(120),
  date: dateSchema,
  currency: currencySchema,
  items: z.array(lineSchema).min(1).max(MAX_LINES),
  participants: z.array(participantSchema).min(2).max(MAX_PARTICIPANTS),
  splitMode: z.enum(["equal", "weighted"]),
  totalCents: z.number().int().positive().max(MAX_LINE_CENTS * MAX_LINES),
  shares: z.array(z.object({
    participantId: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    amountCents: z.number().int().nonnegative()
  })).min(2).max(MAX_PARTICIPANTS),
  createdAt: z.iso.datetime({ offset: true }),
  registeredById: memberIdSchema.optional(),
  paidById: memberIdSchema.optional(),
  settledAt: z.iso.datetime({ offset: true }).nullable().optional()
}).superRefine((expense, context) => {
  const result = expenseInputSchema.safeParse(expense);
  if (!result.success) {
    context.addIssue({ code: "custom", message: "El gasto tiene datos inválidos." });
    return;
  }
  if (expense.settledAt && !expense.paidById) {
    context.addIssue({ code: "custom", message: "Un ticket liquidado necesita un pagador conocido." });
  }
  const total = expense.items.filter((item) => item.selected).reduce((sum, item) => sum + item.amountCents, 0);
  const expectedShares = splitItems(expense.items, expense.participants, expense.splitMode);
  if (expense.totalCents !== total || expense.shares.length !== expectedShares.length || expectedShares.some((expected, index) => {
    const actual = expense.shares[index];
    return actual.participantId !== expected.participantId || actual.name !== expected.name || actual.amountCents !== expected.amountCents;
  })) {
    context.addIssue({ code: "custom", message: "El reparto recibido no coincide con los productos seleccionados." });
  }
});

export type Expense = z.infer<typeof expenseSchema>;
export const expenseListSchema = z.object({ items: z.array(expenseSchema).max(500) });
export const loginSchema = z.object({ accessToken: z.string().min(1).max(16_000), expiresIn: z.number().int().positive().max(86_400) });

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return amount > MAX_LINE_CENTS ? null : (negative ? -amount : amount);
}

export function amountInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function money(cents: number, currency: Currency): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

export function splitAmount(totalCents: number, participants: Participant[], mode: SplitMode): Share[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || participants.length < 2 || participants.length > MAX_PARTICIPANTS) {
    throw new Error("Importe o participantes inválidos.");
  }
  const weights = participants.map((participant) => mode === "equal" ? 1 : participant.weight);
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 10_000)) {
    throw new Error("Los pesos deben ser enteros entre 1 y 10000.");
  }
  const weightTotal = BigInt(weights.reduce((total, weight) => total + weight, 0));
  const shares = participants.map((participant, index) => {
    const numerator = BigInt(totalCents) * BigInt(weights[index]);
    return { participantId: participant.id, name: participant.name.trim(), amountCents: Number(numerator / weightTotal), remainder: numerator % weightTotal, index };
  });
  let left = totalCents - shares.reduce((total, share) => total + share.amountCents, 0);
  const ordered = [...shares].sort((first, second) => first.remainder === second.remainder ? first.index - second.index : first.remainder > second.remainder ? -1 : 1);
  for (const share of ordered) {
    if (left === 0) break;
    share.amountCents += 1;
    left -= 1;
  }
  return shares.map(({ participantId, name, amountCents }) => ({ participantId, name, amountCents }));
}

export function blankLine(): DraftLine {
  return { id: crypto.randomUUID(), name: "", amount: "", selected: true, ownerId: null };
}

export function splitItems(items: Pick<ExpenseInput["items"][number], "amountCents" | "selected" | "ownerId">[], participants: Participant[], mode: SplitMode): Share[] {
  const personalTotals = new Map(participants.map((participant) => [participant.id, 0]));
  let sharedTotal = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.amountCents)) throw new Error("El importe del producto debe estar en céntimos enteros.");
    if (item.ownerId != null && !personalTotals.has(item.ownerId)) throw new Error("El propietario del producto debe ser una de las personas del reparto.");
    if (!item.selected) continue;
    if (item.ownerId == null) sharedTotal += item.amountCents;
    else personalTotals.set(item.ownerId, personalTotals.get(item.ownerId)! + item.amountCents);
  }
  const sign = sharedTotal < 0 ? -1 : 1;
  return splitAmount(Math.abs(sharedTotal), participants, mode).map((share) => ({
    ...share,
    amountCents: sign * share.amountCents + personalTotals.get(share.participantId)!
  }));
}

export function defaultParticipants(): Participant[] {
  return coupleMembers.map((person) => ({ ...person, weight: 50 }));
}

export function makeExpenseInput(merchant: string, date: string, currency: Currency, lines: DraftLine[], participants: Participant[], splitMode: SplitMode, identity?: { registeredById: CoupleMemberId; paidById: CoupleMemberId }): ExpenseInput {
  const items = lines.filter((line) => line.name.trim() || line.amount.trim()).map((line) => {
    const amountCents = toCents(line.amount);
    if (amountCents === null) throw new Error(`Revisa el importe de «${line.name || "producto sin nombre"}». Usa 12,34 sin separador de miles.`);
    return { id: line.id, name: line.name.trim(), amountCents, selected: line.selected, ownerId: line.ownerId ?? null };
  });
  const result = expenseInputSchema.safeParse({ merchant, date, currency, items, participants, splitMode, ...identity });
  if (!result.success) {
    const issue = result.error.issues.find((entry) => entry.code === "custom");
    throw new Error(issue?.message ?? "Completa comercio, fecha, productos y personas. Selecciona un total positivo y usa pesos enteros positivos.");
  }
  return result.data;
}

export function validateImage(file: Pick<File, "size" | "type">): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Usa una foto JPG, PNG o WebP. Convierte las imágenes HEIC antes de subirlas.");
  if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error("La foto debe tener contenido y pesar como máximo 8 MB.");
}

export function sampleReceipt(): Receipt {
  return {
    merchant: "La despensa",
    date: localDate(),
    currency: "EUR",
    totalCents: 2485,
    items: [
      { name: "Verduras de temporada", amountCents: 645 },
      { name: "Pasta fresca", amountCents: 390 },
      { name: "Aceite de oliva", amountCents: 795 },
      { name: "Café molido", amountCents: 455 }
    ],
    warnings: []
  };
}
