/**
 * "Täsmää pankin saldoon": do the stored rows of an account add up, to the cent, to what the bank's own booked balance
 * says between two days? Pure: it reads the rows and the balances it is given and writes and moves nothing.
 *
 * An anchor is a balance the bank gave for the END of a closed day: CLBD and ITBD at their reference day, OPBD (the
 * start of a day) at the day before. Between two anchors of ONE type, the bank's change must equal the sum of the booked
 * rows dated after the first anchor's day up to the second's, with no tolerance. Types are never mixed, and the walk from
 * the newest interval back stops at the first one that does not match.
 */
import { addDays, dayNumber, fromDayNumber } from "./dates.ts";
import type { AccountType, IsoDate } from "./types.ts";

/** The account types that are reconciled: a card's or a loan's balance is a debt of varying sign. */
const SCOPE: ReadonlySet<AccountType> = new Set<AccountType>(["checking", "savings", "other"]);

/** The balance types that prove, best first: the closing booked, the interim booked and the opening booked balance. */
const PROVING = ["CLBD", "ITBD", "OPBD"] as const;
type ProvingType = (typeof PROVING)[number];

/** The sources whose balances prove; a `seed` balance is a guess made from the stored stamp. */
const PROVING_SOURCES: ReadonlySet<string> = new Set(["bank", "demo"]);

interface ReconcileAccount {
  type: AccountType;
  currency: string;
}

/** One stored row of the account (its own, unsplit, every category). Only booked rows count. */
interface ReconcileRow {
  bookingDate: IsoDate;
  amountCents: number;
  status: "booked" | "pending";
  /** When the row reached the app (an ISO instant), or null when not known. */
  importedAt: string | null;
}

/** One stored balance of the account's key (`account_balances`). */
export interface ReconcileBalance {
  /** The day it was fetched. */
  day: IsoDate;
  type: string;
  referenceDate: IsoDate | null;
  cents: number;
  fetchedAt: string;
  source: string;
}

interface ReconcileOptions {
  /** The first day the rows were asked for, else the day of the first stored booked row; null when neither is known. */
  historyFrom: IsoDate | null;
  /** Booking days of the account's rows in another currency. */
  foreignDays: readonly IsoDate[];
  today: IsoDate;
}

/** Why there is no result, or why part of it is missing. */
type ReconcileReason =
  /** Only XPCD, CLAV, ITAV or unknown codes are stored: those include credit lines and pending rows. */
  | "only_available"
  /** A balance of a proving type has no usable reference day, so it would have made a pair but cannot. */
  | "no_reference_day"
  /** Anchors of different types, none with two of one type; or a newer anchor of another type than the series. */
  | "type_changed"
  /** Fewer than two anchors of one type. */
  | "too_few";

type IntervalReason =
  /** The rows may be missing: they were asked for from a later day. */
  | "rows_start_later"
  /** A difference with rows in another currency inside it. */
  | "foreign_rows";

interface ReconcileInterval {
  /** The first day the interval covers (the day after the first anchor's day). */
  fromDay: IsoDate;
  /** The second anchor's day. */
  toDay: IsoDate;
  deltaCents: number;
  sumCents: number;
  /** The bank's change minus the rows' sum. */
  diffCents: number;
  state: "matched" | "differs" | "unknown";
  /** Two differing intervals that cancel out: `late` when a row reached us after the later balance was fetched, else `evens`. */
  mark: "late" | "evens" | null;
  reason: IntervalReason | null;
  /** The difference is the sum of one row of the interval; advice only. */
  hint: "one_row" | null;
}

export interface ReconcileResult {
  /** The balance type the series is made of. */
  type: ProvingType | null;
  status: "proved" | "differs" | "unknown";
  reason: ReconcileReason | null;
  /** The stretch proved: the unbroken run of matched intervals from the newest back. */
  provedFrom: IsoDate | null;
  provedTo: IsoDate | null;
  /** The last day of the newest matched interval, wherever it lies. */
  lastMatchedTo: IsoDate | null;
  /** Oldest first. */
  intervals: ReconcileInterval[];
}

interface Anchor {
  /** The end of the day the balance stands for. */
  day: IsoDate;
  cents: number;
  fetchedAt: string;
  type: ProvingType;
}

const isReal = (s: string | null): s is IsoDate => s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNumber(dayNumber(s)) === s;
const isProving = (type: string): type is ProvingType => (PROVING as readonly string[]).includes(type);

const empty = (reason: ReconcileReason): ReconcileResult => ({ type: null, status: "unknown", reason, provedFrom: null, provedTo: null, lastMatchedTo: null, intervals: [] });

/** The anchors and the proving balances that could not be one for lack of a reference day. */
function anchorsOf(balances: readonly ReconcileBalance[], today: IsoDate): { anchors: Anchor[]; noReference: ReconcileBalance[]; proving: number; others: number } {
  const noReference: ReconcileBalance[] = [];
  const kept = new Map<string, Anchor>();
  let proving = 0;
  let others = 0;
  for (const b of balances) {
    if (!PROVING_SOURCES.has(b.source)) continue;
    if (!isProving(b.type)) {
      others++;
      continue;
    }
    proving++;
    if (!isReal(b.referenceDate) || b.referenceDate > b.day) {
      noReference.push(b);
      continue;
    }
    // the start of a day is the end of the day before it
    const day = b.type === "OPBD" ? addDays(b.referenceDate, -1) : b.referenceDate;
    // a day that was not over when it was fetched stands for nothing yet (and no fetch day lies after today)
    if (!(day < b.day) || b.day > today) continue;
    const key = `${b.type}|${b.referenceDate}`;
    const held = kept.get(key);
    // the bank's last word on a day is the latest fetch
    if (!held || b.fetchedAt > held.fetchedAt) kept.set(key, { day, cents: b.cents, fetchedAt: b.fetchedAt, type: b.type });
  }
  return { anchors: [...kept.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)), noReference, proving, others };
}

/** The first position in 0..n where `within` is false, for a `within` that is true up to some position and false after it. */
function upper(n: number, within: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (within(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether the later fetch of `at` holds a row that the earlier one could not have, by the instants (an unreadable one is not later). */
const importedAfter = (importedAt: string | null, at: string): boolean => importedAt !== null && Date.parse(importedAt) > Date.parse(at);

/**
 * The result for one account row, or null for an account that is not reconciled (a card, a loan, another currency).
 * `rows` are that account row's own rows, `balances` those of its real account.
 */
export function reconcile(account: ReconcileAccount, rows: readonly ReconcileRow[], balances: readonly ReconcileBalance[], options: ReconcileOptions): ReconcileResult | null {
  if (!SCOPE.has(account.type) || account.currency.trim().toUpperCase() !== "EUR") return null;
  const { anchors, noReference, proving, others } = anchorsOf(balances, options.today);

  const byType = new Map<ProvingType, Anchor[]>();
  for (const a of anchors) {
    const held = byType.get(a.type);
    if (held) held.push(a);
    else byType.set(a.type, [a]);
  }
  const type = PROVING.find((t) => (byType.get(t)?.length ?? 0) >= 2);
  if (!type) {
    // a proving type that would have had two balances if every one had a reference day
    const lacking = PROVING.some((t) => {
      const missing = new Set(noReference.filter((b) => b.type === t).map((b) => b.day)).size;
      return missing > 0 && (byType.get(t)?.length ?? 0) + missing >= 2;
    });
    if (lacking) return empty("no_reference_day");
    if (byType.size >= 2) return empty("type_changed");
    // a booked balance of the fetch day is still a booked balance: only a bank that sent none says only the available one
    if (proving === 0 && others > 0) return empty("only_available");
    return empty("too_few");
  }
  const series = byType.get(type)!;

  const booked = rows.filter((r) => r.status === "booked").sort((x, y) => (x.bookingDate < y.bookingDate ? -1 : x.bookingDate > y.bookingDate ? 1 : 0));
  // one running sum over the sorted rows: the rows of (E1, E2] are the slice between two positions found by bisection
  const cumulative = [0];
  for (const r of booked) cumulative.push(cumulative[cumulative.length - 1]! + r.amountCents);
  const after = (day: IsoDate): number => upper(booked.length, (i) => booked[i]!.bookingDate <= day);
  const foreignDays = [...options.foreignDays].sort();
  const foreignIn = (from: IsoDate, to: IsoDate): boolean => {
    const i = upper(foreignDays.length, (k) => foreignDays[k]! <= from);
    return i < foreignDays.length && foreignDays[i]! <= to;
  };
  interface Work extends ReconcileInterval {
    /** The rows of the interval are booked[lo..hi). */
    lo: number;
    hi: number;
    end: Anchor;
  }
  let intervals: Work[] = [];
  for (let i = 1; i < series.length; i++) {
    const from = series[i - 1]!;
    const end = series[i]!;
    const lo = after(from.day);
    const hi = after(end.day);
    const deltaCents = end.cents - from.cents;
    const sumCents = cumulative[hi]! - cumulative[lo]!;
    const diffCents = deltaCents - sumCents;
    const fromDay = addDays(from.day, 1);
    let state: ReconcileInterval["state"] = diffCents === 0 ? "matched" : "differs";
    let reason: IntervalReason | null = null;
    // the rows may not have been asked for before the history began: nothing is said of them
    if (options.historyFrom === null || fromDay < options.historyFrom) {
      state = "unknown";
      reason = "rows_start_later";
    }
    intervals.push({ fromDay, toDay: end.day, deltaCents, sumCents, diffCents, state, mark: null, reason, hint: null, lo, hi, end });
  }

  // two neighbours that differ by the same sum the other way are one stretch that matches: a row that was booked late
  // into the first moved the difference to the second. Newest first, as the walk goes.
  const merged: Work[] = [];
  for (let i = intervals.length - 1; i >= 0; i--) {
    const second = intervals[i]!;
    const first = intervals[i - 1];
    if (first && first.state === "differs" && second.state === "differs" && first.diffCents === -second.diffCents) {
      const late = booked.slice(first.lo, first.hi).some((r) => importedAfter(r.importedAt, first.end.fetchedAt) && r.amountCents === -first.diffCents);
      merged.unshift({
        fromDay: first.fromDay,
        toDay: second.toDay,
        deltaCents: first.deltaCents + second.deltaCents,
        sumCents: first.sumCents + second.sumCents,
        diffCents: 0,
        state: "matched",
        mark: late ? "late" : "evens",
        reason: null,
        hint: null,
        lo: first.lo,
        hi: second.hi,
        end: second.end,
      });
      i--;
    } else merged.unshift(second);
  }
  intervals = merged;

  // what still differs: with a row in another currency inside it nothing is said; else the hint, if one row is the whole difference
  for (const iv of intervals) {
    if (iv.state !== "differs") continue;
    if (foreignIn(addDays(iv.fromDay, -1), iv.toDay)) {
      iv.state = "unknown";
      iv.reason = "foreign_rows";
    } else if (booked.slice(iv.lo, iv.hi).some((r) => Math.abs(r.amountCents) === Math.abs(iv.diffCents))) iv.hint = "one_row";
  }

  let start = intervals.length;
  while (start > 0 && intervals[start - 1]!.state === "matched") start--;
  const newest = intervals[intervals.length - 1]!;
  const matched = intervals.filter((iv) => iv.state === "matched");
  const newestAnchor = anchors.reduce((a, b) => (b.day > a.day ? b : a));
  return {
    type,
    status: start < intervals.length ? "proved" : newest.state === "differs" ? "differs" : "unknown",
    reason: newestAnchor.type !== type && newestAnchor.day > series[series.length - 1]!.day ? "type_changed" : null,
    provedFrom: start < intervals.length ? intervals[start]!.fromDay : null,
    provedTo: start < intervals.length ? newest.toDay : null,
    lastMatchedTo: matched.length ? matched[matched.length - 1]!.toDay : null,
    intervals: intervals.map(({ lo: _lo, hi: _hi, end: _end, ...interval }) => interval),
  };
}

/**
 * The result with each run of plain matched intervals, and each run of unknown ones with the same reason, folded into
 * one, for an answer that does not need a line per day (a bank that sends a balance every day gives hundreds). The sums
 * add up, so the folded interval is exact; a differing interval and one with a mark or a hint stay as they are.
 */
export function compactReconcile(result: ReconcileResult): ReconcileResult {
  const intervals: ReconcileInterval[] = [];
  // a run of matched days with no mark or hint, or of unknown days for the same reason, is one interval
  const together = (x: ReconcileInterval, y: ReconcileInterval) =>
    x.state === y.state && x.mark === null && y.mark === null && x.hint === null && y.hint === null && x.reason === y.reason && (x.state === "matched" || x.state === "unknown");
  for (const iv of result.intervals) {
    const last = intervals[intervals.length - 1];
    if (last && together(last, iv)) {
      intervals[intervals.length - 1] = { ...last, toDay: iv.toDay, deltaCents: last.deltaCents + iv.deltaCents, sumCents: last.sumCents + iv.sumCents, diffCents: last.diffCents + iv.diffCents };
    } else intervals.push(iv);
  }
  return { ...result, intervals };
}
