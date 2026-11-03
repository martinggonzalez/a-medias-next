import { coupleMembers, type CoupleMemberId, type Currency, type Expense, type Participant } from "./domain";

export type TicketDebt = { from: CoupleMemberId; to: CoupleMemberId; amountCents: number };
export type PersonLedger = {
  id: CoupleMemberId;
  name: string;
  spentCents: number;
  sharedCents: number;
  personalCents: number;
  paidCents: number;
  pendingBalanceCents: number;
};

function memberForParticipant(participant: Participant): CoupleMemberId | undefined {
  const normalized = participant.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("es");
  return coupleMembers.find((person) => person.id === participant.id)?.id ?? coupleMembers.find((person) => person.id === normalized)?.id;
}

export function memberName(id: CoupleMemberId): string {
  return coupleMembers.find((person) => person.id === id)!.name;
}

export function ticketDebt(expense: Expense): TicketDebt | null {
  if (!expense.paidById || expense.participants.length !== 2) return null;
  const identities = expense.participants.map(memberForParticipant);
  if (identities.some((identity) => !identity) || new Set(identities).size !== 2) return null;
  const debtor = coupleMembers.find((person) => person.id !== expense.paidById)!;
  const share = expense.shares.find((entry) => {
    const participant = expense.participants.find((person) => person.id === entry.participantId);
    return participant && memberForParticipant(participant) === debtor.id;
  });
  return share ? { from: debtor.id, to: expense.paidById, amountCents: share.amountCents } : null;
}

export function summarizeLedger(expenses: Expense[], currency: Currency) {
  const people: PersonLedger[] = coupleMembers.map((person) => ({ ...person, spentCents: 0, sharedCents: 0, personalCents: 0, paidCents: 0, pendingBalanceCents: 0 }));
  let totalCents = 0;
  let sharedCents = 0;
  let unassignedCents = 0;
  let unknownDebtCount = 0;
  let pendingCount = 0;
  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    totalCents += expense.totalCents;
    sharedCents += expense.items.filter((item) => item.selected && item.ownerId == null).reduce((sum, item) => sum + item.amountCents, 0);
    for (const share of expense.shares) {
      const participant = expense.participants.find((person) => person.id === share.participantId)!;
      const person = people.find((entry) => entry.id === memberForParticipant(participant));
      if (!person) {
        unassignedCents += share.amountCents;
        continue;
      }
      const personalCents = expense.items.filter((item) => item.selected && item.ownerId === participant.id).reduce((sum, item) => sum + item.amountCents, 0);
      person.spentCents += share.amountCents;
      person.personalCents += personalCents;
      person.sharedCents += share.amountCents - personalCents;
    }
    const payer = people.find((person) => person.id === expense.paidById);
    if (payer) payer.paidCents += expense.totalCents;
    const debt = ticketDebt(expense);
    if (!debt) {
      unknownDebtCount += 1;
      continue;
    }
    if (expense.settledAt || debt.amountCents === 0) continue;
    pendingCount += 1;
    people.find((person) => person.id === debt.from)!.pendingBalanceCents -= debt.amountCents;
    people.find((person) => person.id === debt.to)!.pendingBalanceCents += debt.amountCents;
  }
  return { totalCents, sharedCents, personalCents: totalCents - sharedCents, people, unassignedCents, unknownDebtCount, pendingCount };
}
