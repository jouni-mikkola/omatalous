/**
 * A bill paid another way. A series knows only its own rows (one account, one payee name), so a bill the household paid
 * from another account, or by hand under another payee name, would still stand as falling due. This reads the view's
 * rows once and marks the occurrences of a bill that such a payment settled. Computed every time, nothing stored: when
 * the paying row goes away or its booked twin arrives, the answer follows the rows. Called from the analysis context
 * only, so every reader of the context's series agrees; `detectRecurring` stays what the series' own rows say.
 */
import { billCents } from "./account-use.ts";
import { addDays, dayNumber } from "./dates.ts";
import { UNKNOWN_MERCHANT } from "./merchant.ts";
import { isActiveAt, isOverdue, parseSeriesId, projectDates, type RecurringSeries, type SettledOccurrence } from "./recurring.ts";
import { CADENCES, type CadenceDef } from "./recurring-cadence.ts";
import { amountsDiffer } from "./recurring-occurrence.ts";
import { median } from "./stats.ts";
import { normalizeIban } from "./transfers.ts";
import type { Account, IsoDate, Transaction } from "./types.ts";

/** A payment up to this many days before the due date counts as paying it (an early or a late due date). */
export const PAID_EARLY_DAYS = 31;

/** A row of the view with what the proof needs: the bank's own sum, the references and how much came back. */
export type SettleRow = Pick<
  Transaction,
  "id" | "accountId" | "bookingDate" | "amountCents" | "wholeCents" | "merchant" | "isTransfer" | "status" | "counterpartyIban" | "reference"
> & { refunded: number };

/** A payment before the previous charge's midpoint is nearer that charge than this one. */
const NEARER_THIS_SHARE = 0.5;
/** A bill by use may lie this far outside its last six sums. */
const BAND_WIDEN = 0.1;
/** Under another payee name the sum may be this far from the typical one. */
const OTHER_NAME_SUM_SHARE = 0.25;
const MIN_PREFIX = 8;
const MIN_PREFIX_SHARE = 0.6;
/** Enough rows to know a creditor account from. */
const MIN_IBAN_ROWS = 2;
/** Far enough past the last settled date to hold the next one, for the longest step (a year). */
const HORIZON_DAYS = PAID_EARLY_DAYS + 450;

/** A payment reference with its spaces, case, a leading `RFnn` and leading zeros taken out; null is no reference. */
export function normalizeReference(ref: string | null | undefined): string | null {
  const s = (ref ?? "").replace(/\s+/gu, "").toUpperCase().replace(/^RF\d{2}/u, "").replace(/^0+/u, "");
  return s || null;
}

/** The index of the first entry whose day is after `day`, in entries sorted by day. */
function firstAfter(sorted: readonly { day: number }[], day: number): number {
  let [lo, hi] = [0, sorted.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.day > day) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const sumOf = (t: Pick<SettleRow, "amountCents" | "wholeCents">) => Math.abs(billCents(t));
const before = (a: SettleRow, b: SettleRow) => a.bookingDate.localeCompare(b.bookingDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What a series expects of its next payment, by the bank's own sums. */
function expectations(s: RecurringSeries, own: readonly SettleRow[]) {
  const byDay = new Map<IsoDate, number>();
  for (const t of own) byDay.set(t.bookingDate, (byDay.get(t.bookingDate) ?? 0) + sumOf(t));
  const sums = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, cents]) => cents);
  const last = sums[sums.length - 1] ?? 0;
  const typical = s.priceChange ? last : Math.round(median(sums.slice(-3)));
  const six = sums.slice(-6);
  const band = s.kind === "bill" && six.length ? { low: Math.min(...six) * (1 - BAND_WIDEN), high: Math.max(...six) * (1 + BAND_WIDEN) } : null;
  return { typical, last, fits: (cents: number) => !amountsDiffer(cents, typical) || !amountsDiffer(cents, last) || (!!band && cents >= band.low && cents <= band.high) };
}

/** How a series' rows tie a foreign payment to it: one reference for every invoice, or invoices numbered on from a prefix. */
function referenceProof(own: readonly SettleRow[]): ((ref: string) => boolean) | null {
  const refs = own.map((t) => normalizeReference(t.reference));
  const [a, b, c] = refs.slice(-3) as [string | null, string | null, string | null];
  const lastTwo = refs.slice(-2);
  if (lastTwo.length === 2 && lastTwo[0] && lastTwo[0] === lastTwo[1]) return (ref) => ref === lastTwo[0];
  if (!a || !b || !c || a.length !== b.length || b.length !== c.length || new Set([a, b, c]).size < 3) return null;
  let n = 0;
  while (n < a.length && a[n] === b[n] && b[n] === c[n]) n++;
  if (n < MIN_PREFIX || n < MIN_PREFIX_SHARE * a.length) return null;
  const known = new Set(refs);
  return (ref) => ref.length === a.length && ref.startsWith(a.slice(0, n)) && !known.has(ref);
}

/**
 * Marks the occurrences of a bill that a payment from another account, or under another payee name with proof, settled.
 * A series that was settled gains `settled`, its `nextDate` is the date after the last settled one, and `active` and
 * `overdue` count the settled occurrence as its latest charge; `lastDate` stays its own last row. Series and rows
 * that no payment settled come back as they were. The paying rows are `settled[].id`.
 */
export function settlePaidElsewhere(
  series: readonly RecurringSeries[],
  rows: readonly SettleRow[],
  today: IsoDate,
  accounts: readonly Pick<Account, "id" | "type">[],
): RecurringSeries[] {
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const defOf = (s: RecurringSeries): CadenceDef | undefined => CADENCES.find((c) => c.id === s.cadence);
  const accountOf = (s: RecurringSeries) => parseSeriesId(s.id)?.accountId ?? "";
  const eligible = (s: RecurringSeries) =>
    (s.kind === "bill" || s.kind === "subscription") && s.nextDate !== null && (defOf(s)?.months ?? 0) > 0 && parseSeriesId(s.id)?.direction === "out" && !cards.has(accountOf(s));
  const mine = series.filter(eligible).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!mine.length) return [...series];

  const byId = new Map(rows.map((t) => [t.id, t]));
  // a booked row of any series with a cadence belongs to that series
  const inSeries = new Set(series.filter((s) => s.cadence).flatMap((s) => s.transactionIds));
  const nextDays = new Map<string, { id: string; day: number; tolerance: number }[]>();
  for (const s of series) {
    const tolerance = s.cadence === "semimonthly" ? 3 : defOf(s)?.tolerance;
    if (!s.cadence || !s.nextDate || tolerance === undefined) continue;
    const list = nextDays.get(accountOf(s)) ?? [];
    list.push({ id: s.id, day: dayNumber(s.nextDate), tolerance });
    nextDays.set(accountOf(s), list);
  }
  const todayDay = dayNumber(today);
  const spent = (t: SettleRow) => t.amountCents < 0 && !t.isTransfer && (t.status === "booked" || t.status === "pending") && dayNumber(t.bookingDate) <= todayDay;
  const payments = rows.filter(spent);
  const pool = payments
    .filter((t) => !inSeries.has(t.id) && t.refunded < Math.abs(t.amountCents))
    .map((t) => ({ t, day: dayNumber(t.bookingDate), cents: sumOf(t) }))
    .sort((a, b) => a.day - b.day);
  const sameAccountAndPayee = new Map<string, { day: number; t: SettleRow }[]>();
  for (const t of payments) {
    const key = `${t.accountId}\u0000${t.merchant}`;
    const list = sameAccountAndPayee.get(key) ?? [];
    list.push({ day: dayNumber(t.bookingDate), t });
    sameAccountAndPayee.set(key, list);
  }

  const used = new Set<string>();
  const result = new Map<string, RecurringSeries>();
  for (const s of mine) {
    const def = defOf(s)!;
    const own = s.transactionIds.flatMap((id) => byId.get(id) ?? []).sort(before);
    const { typical, fits } = expectations(s, own);
    const account = accountOf(s);
    const ownIds = new Set(s.transactionIds);
    const referenceFits = referenceProof(own);
    const dates = projectDates(s, addDays(today, HORIZON_DAYS));
    const settled: SettledOccurrence[] = [];
    const settledIds = new Set<string>();
    let latest = s.lastDate;

    /** Does the row R settle an occurrence of this series, its day already in the window? */
    const proves = (t: SettleRow, cents: number, day: number): boolean => {
      if (used.has(t.id)) return false;
      if (t.status === "pending") {
        if (nextDays.get(t.accountId)?.some((q) => q.id !== s.id && Math.abs(day - q.day) <= q.tolerance)) return false;
      }
      if (t.merchant === s.merchant) {
        if (t.merchant === UNKNOWN_MERCHANT || (t.accountId === account && t.status !== "pending") || !fits(cents)) return false;
      } else {
        const near = Math.abs(cents - typical) <= OTHER_NAME_SUM_SHARE * typical;
        const ref = normalizeReference(t.reference);
        const iban = normalizeIban(t.counterpartyIban);
        const byReference = !!ref && near && !!referenceFits?.(ref);
        const byIban = !!iban && fits(cents) && own.filter((o) => normalizeIban(o.counterpartyIban) === iban && o.bookingDate < t.bookingDate).length >= MIN_IBAN_ROWS;
        if (!byReference && !byIban) return false;
      }
      // a second contract that has no series yet: its account already paid this payee one step before
      return !(sameAccountAndPayee.get(`${t.accountId}\u0000${t.merchant}`) ?? []).some(
        (e) => e.t.id !== t.id && Math.abs(day - e.day - def.days) <= def.tolerance && fits(sumOf(e.t)) && !ownIds.has(e.t.id) && !settledIds.has(e.t.id),
      );
    };

    for (let i = 0; i < dates.length - 1; i++) {
      const due = dates[i]!;
      const dueDay = dayNumber(due);
      if (!isActiveAt(def, latest, due) || dueDay - PAID_EARLY_DAYS > todayDay) break;
      const from = Math.max(dayNumber(latest) + NEARER_THIS_SHARE * def.days, dueDay - PAID_EARLY_DAYS);
      let best: { t: SettleRow; gap: number; off: number } | null = null;
      let k = firstAfter(pool, from);
      for (; k < pool.length && pool[k]!.day <= dueDay + def.tolerance; k++) {
        const p = pool[k]!;
        if (!proves(p.t, p.cents, p.day)) continue;
        const gap = Math.abs(p.day - dueDay);
        const off = Math.abs(p.cents - typical);
        if (!best || gap < best.gap || (gap === best.gap && (off < best.off || (off === best.off && p.t.id < best.t.id)))) best = { t: p.t, gap, off };
      }
      if (!best) break;
      used.add(best.t.id);
      settledIds.add(best.t.id);
      settled.push({ due, paidOn: best.t.bookingDate, id: best.t.id, pending: best.t.status === "pending" });
      latest = due;
    }
    if (!settled.length) continue;
    const nextDate = dates[settled.length]!;
    const active = isActiveAt(def, latest, today);
    result.set(s.id, { ...s, settled, nextDate, active, overdue: isOverdue(active, nextDate, today) });
  }
  return series.map((s) => result.get(s.id) ?? s);
}
