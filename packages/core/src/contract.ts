/**
 * Contracts: a subscription or bill series to a company that has a start and may have an end (a car lease, a loan, a
 * phone, insurance or gym contract). A contract is a recurring series with three payments or more to a company
 * (`partyKind`: a name that does not say, like "Siirto", is none). It adds what a series does not say:
 *
 * - the start: the first payment of the series, or a larger first payment to the same payee within one cadence before
 *   the run (a lease's first rent), which is told apart as the first payment and is no part of the monthly cost;
 * - the end: no payment by the expected next date plus one and a half cadences, and the expected date past by 20
 *   days (a monthly contract: about day 75 after its last payment). Payments again make it active again, as the series
 *   is recomputed from the rows. An ended series is never active, so nothing that reads the cost ahead
 *   (`expectedCharges`, Erääntyvät maksut, /api/ahead, the savings tips) counts it;
 * - the closing refund: money from the same payee on the same account within 60 days after the last payment, once the
 *   contract has ended (on the view's today) and no payment of the same run followed it. It is no income:
 *   `closedContract` pairs it with the contract's payments, the categoriser gives it their category and `moneyIn`
 *   takes it off their category. A later contract with the same payee is another run and changes nothing of it.
 *
 * What the user marked wins over the inference (`isEndedContract` in commitments.ts).
 */
import { getCategory } from "./categories.ts";
import { addDays, daysBetween } from "./dates.ts";
import { partyKind } from "./party-kind.ts";
import { CADENCES, SEMIMONTHLY } from "./recurring-cadence.ts";
import { amountsDiffer, type SeriesInput } from "./recurring-occurrence.ts";
import { detectRecurring, type RecurringSeries } from "./recurring.ts";
import { sum } from "./stats.ts";
import type { IsoDate, Transaction } from "./types.ts";

export interface Contract {
  /** The first payment: a larger one before the series, else the series' first charge. */
  startDate: IsoDate;
  /** The larger first payment; null when the first payment was like the others. */
  firstPaymentCents: number | null;
  /** The last payment, one that a payment from another account settled included. */
  lastDate: IsoDate;
  ended: boolean;
  /** The closing refund's day, else the day of the first payment that did not come; null while active. */
  endedOn: IsoDate | null;
  /** What the series costs a month; a larger first payment is not in it. */
  monthlyCents: number;
  /** Everything paid to the contract, the first payment included and the refund not taken off. */
  totalPaidCents: number;
  /** The closing refund, when one came. */
  refund: { date: IsoDate; cents: number } | null;
  /** What the contract cost in the end: the total paid less the closing refund. */
  costAfterRefundCents: number;
}

type ContractRow = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "category"> & Partial<Pick<Transaction, "isTransfer" | "status" | "counterparty">>;

const MIN_PAYMENTS = 3;
/** A first payment is told apart when it is this many times the usual one. */
const FIRST_PAYMENT_TIMES = 1.5;
/** Ended: no payment by the expected date plus this many cadences ... */
const ENDED_CADENCES = 1.5;
/** ... and the expected date past by this many days. A payment within this many cadences of the last is of the same run. */
const ENDED_LATE_DAYS = 20;
/** The closing refund comes this many days after the last payment at the latest. */
export const CLOSING_REFUND_DAYS = 60;

const asInput = (t: ContractRow): SeriesInput => ({
  id: t.id,
  accountId: t.accountId,
  bookingDate: t.bookingDate,
  amountCents: t.amountCents,
  merchant: t.merchant,
  category: t.category,
  isTransfer: t.isTransfer ?? false,
  status: t.status ?? "booked",
});

/**
 * A company by the merchant's name or by the bank's own `counterparty` (the merchant has lost its legal form, OYJ). A
 * name that does not say is a company for leasing and insurance, which a person is not paid for; a person never is. Not
 * for debt: a loan from a relative under one name ("Mummo") is no contract (banks are known by their words).
 */
function isCompany(merchant: string, counterparty: string | null | undefined, category: string): boolean {
  const kinds = [partyKind(merchant), ...(counterparty ? [partyKind(counterparty)] : [])];
  if (kinds.includes("company")) return true;
  if (kinds.includes("person")) return false;
  return category === "leasing" || category === "insurance";
}

/** A subscription or bill of three payments or more, to a company, for spending or debt service. */
function isContractSeries(s: Pick<RecurringSeries, "kind" | "occurrences" | "category" | "merchant" | "cadence">, counterparty?: string | null): boolean {
  if ((s.kind !== "subscription" && s.kind !== "bill") || !s.cadence || s.occurrences < MIN_PAYMENTS) return false;
  const kind = getCategory(s.category).kind;
  return (kind === "expense" || kind === "debt") && isCompany(s.merchant, counterparty, s.category);
}

/** No payment by the expected date plus one and a half cadences, and the expected date 20 days past or more. */
const hasEnded = (next: IsoDate, intervalDays: number, today: IsoDate): boolean => {
  const late = daysBetween(next, today);
  return late >= ENDED_LATE_DAYS && late > ENDED_CADENCES * intervalDays;
};

const partyOf = (t: Pick<ContractRow, "accountId" | "merchant">) => `${t.accountId}\u0000${t.merchant}`;

/**
 * What the history holds before the series' first charge: earlier charges of the run, which the series did not read
 * when it began beyond the days detectRecurring looks back, and the larger first payment within one cadence before them.
 * A larger payment that another payment of the payee precedes within a cadence is the end of an earlier run (a loan
 * that was refinanced to a lower instalment), not a first payment.
 */
function beforeRun(s: RecurringSeries, party: readonly ContractRow[], own: ReadonlySet<string>): { earlier: ContractRow[]; first: ContractRow | null } {
  const def = s.cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.id === s.cadence)!;
  const reach = def.days + def.tolerance;
  const before = party.filter((t) => t.amountCents < 0 && !own.has(t.id) && t.bookingDate < s.firstDate).sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || a.id.localeCompare(b.id));
  const usual = (t: ContractRow) => -t.amountCents < FIRST_PAYMENT_TIMES * s.typicalAmountCents && (s.kind !== "subscription" || !amountsDiffer(-t.amountCents, s.typicalAmountCents));
  const earlier: ContractRow[] = [];
  let at = s.firstDate;
  for (const t of before) {
    if (daysBetween(t.bookingDate, at) > reach) break;
    if (usual(t)) {
      earlier.push(t);
      at = t.bookingDate;
    } else if (-t.amountCents >= FIRST_PAYMENT_TIMES * s.typicalAmountCents) {
      const alone = !before.some((o) => o !== t && o.bookingDate < t.bookingDate && daysBetween(o.bookingDate, t.bookingDate) <= reach);
      return { earlier, first: alone ? t : null };
    }
  }
  return { earlier, first: null };
}

const paid = (rows: readonly ContractRow[]) => sum(rows.filter((t) => t.amountCents < 0).map((t) => -t.amountCents));

function contractOf(s: RecurringSeries, party: readonly ContractRow[], byId: ReadonlyMap<string, ContractRow>, today: IsoDate): Contract {
  const ids = new Set([...s.transactionIds, ...(s.settled ?? []).map((p) => p.id)]);
  const { earlier, first } = beforeRun(s, party, ids);
  const lastDate = (s.settled ?? []).reduce((day, p) => (p.paidOn > day ? p.paidOn : day), s.lastDate);
  const next = s.nextDate ?? addDays(lastDate, Math.round(s.intervalDays));
  const ended = hasEnded(next, s.intervalDays, today);
  const totalPaidCents = paid([...ids].flatMap((id) => byId.get(id) ?? [])) + paid(earlier) + (first ? -first.amountCents : 0);
  // the rows closedContract nets in the totals, one by one: the panel says what the reports took off
  const closing = ended
    ? party.filter((t) => t.amountCents > 0 && t.bookingDate > lastDate && daysBetween(lastDate, t.bookingDate) <= CLOSING_REFUND_DAYS && t.bookingDate <= today).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id))
    : [];
  const back: ContractRow[] = [];
  let room = totalPaidCents;
  for (const t of closing) {
    if (t.amountCents > room || !closedContract(party, t, today)) continue;
    back.push(t);
    room -= t.amountCents;
  }
  const refund = back.length ? { date: back[back.length - 1]!.bookingDate, cents: sum(back.map((t) => t.amountCents)) } : null;
  return {
    startDate: first?.bookingDate ?? earlier.at(-1)?.bookingDate ?? s.firstDate,
    firstPaymentCents: first ? -first.amountCents : null,
    lastDate,
    ended,
    endedOn: !ended ? null : refund ? refund.date : next,
    monthlyCents: s.monthlyCents,
    totalPaidCents,
    refund,
    costAfterRefundCents: totalPaidCents - (refund?.cents ?? 0),
  };
}

/** The series with `contract` set on those that are one. `rows` are every row of the history up to `today`. */
export function withContracts(series: readonly RecurringSeries[], rows: readonly ContractRow[], today: IsoDate): RecurringSeries[] {
  if (!series.some((s) => s.kind === "subscription" || s.kind === "bill")) return [...series];
  const byId = new Map(rows.map((t) => [t.id, t]));
  const parties = new Map<string, ContractRow[]>();
  for (const t of rows) {
    const key = partyOf(t);
    const list = parties.get(key);
    if (list) list.push(t);
    else parties.set(key, [t]);
  }
  return series.map((s) => {
    const own = s.transactionIds.map((id) => byId.get(id)).find(Boolean);
    return own && isContractSeries(s, own.counterparty) ? { ...s, contract: contractOf(s, parties.get(partyOf(own)) ?? [], byId, today) } : s;
  });
}

/** Whether the payee's payments up to the money's day run as a contract: then the rules of `closedContract` alone decide whether the money nets them. */
export function runsContract<T extends ContractRow>(payments: readonly T[], money: Pick<ContractRow, "accountId" | "bookingDate" | "amountCents" | "merchant">): boolean {
  const mine = payments.filter((t) => t.amountCents < 0 && partyOf(t) === partyOf(money));
  return mine.length >= MIN_PAYMENTS && detectRecurring(mine.filter((t) => t.bookingDate <= money.bookingDate).map(asInput), money.bookingDate).some((s) => isContractSeries(s, mine[0]!.counterparty));
}

/**
 * The payments of the contract that a refund closes, oldest first, or null when it closes none: `payments` are what was
 * paid to the refunding payee. The contract is read as the history stood on the refund's day, and it must have its last
 * payment within 60 days before the refund and have ended by `today`. A payment of the same run after the refund
 * (within one and a half cadences of the last) makes a credit of it; a later contract with the payee is another run.
 * The contract cannot have cost less than the refund.
 */
export function closedContract<T extends ContractRow>(payments: readonly T[], refund: Pick<ContractRow, "accountId" | "bookingDate" | "amountCents" | "merchant">, today: IsoDate): T[] | null {
  const mine = payments.filter((t) => t.amountCents < 0 && partyOf(t) === partyOf(refund));
  if (mine.length < MIN_PAYMENTS) return null;
  const closing = detectRecurring(mine.filter((t) => t.bookingDate <= refund.bookingDate).map(asInput), refund.bookingDate)
    .filter((s) => isContractSeries(s, mine[0]!.counterparty) && daysBetween(s.lastDate, refund.bookingDate) <= CLOSING_REFUND_DAYS)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.monthlyCents - a.monthlyCents || (a.id < b.id ? -1 : 1))[0];
  if (!closing) return null;
  const next = closing.nextDate ?? addDays(closing.lastDate, Math.round(closing.intervalDays));
  if (!hasEnded(next, closing.intervalDays, today)) return null;
  if (mine.some((t) => t.bookingDate > refund.bookingDate && daysBetween(closing.lastDate, t.bookingDate) <= ENDED_CADENCES * closing.intervalDays)) return null;
  const ids = new Set(closing.transactionIds);
  const { earlier, first } = beforeRun(closing, mine, ids);
  const joined = new Set([...earlier, ...(first ? [first] : [])]);
  const rows = mine.filter((t) => ids.has(t.id) || joined.has(t)).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
  return paid(rows) >= refund.amountCents ? rows : null;
}
