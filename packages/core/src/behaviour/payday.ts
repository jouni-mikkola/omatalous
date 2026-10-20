/**
 * Decision: whether to hold back part of the pay for the end of the month (a set sum to savings on pay day, a weekly
 * limit), because the days after pay day take more than the rest.
 *
 * D6, the payday effect (BA1-behaviour-model.md §D6). A cycle runs from one pay day to the next. Its spending is the
 * day-to-day kind only: purchases, no bill (no series of a bill or a subscription, no row with a reference number, no
 * card bill), no large one-off. The days after pay (pay day and the three after it) are set against the seven days
 * just before that pay, each against what the household's own weekdays would give, so a pay day on Friday is not a
 * weekend taken for an effect. The days just before are the nearest days with no pay: a busier month that begins after
 * pay day (a holiday month) does not read as an effect. Over the last twelve cycles together (six at least), told when the days after pay
 * run at twice the pace of the days before (and at 1,6 with any one cycle left out), faster than all of 999
 * draws with each cycle's four days put at a random other place in it (a permutation test: one card purchase a day
 * makes four days noisy), and 50 € or more a cycle beyond that pace. A row counts up to three times the median purchase, so one dear purchase on pay day makes no habit.
 * Chance alone gives up to 1,8 times on a year of a household with one card purchase a day, so a milder effect is
 * real but cannot be told from chance and is not told.
 * A cycle counts only when it has ended, every account that paid in it covers it, and card bills hide no more than
 * half of what it shows (a card with no rows of its own shows its purchases only as one bill). Booking days are
 * not purchase days: a card purchase is booked up to three days later, which moves spending out of the days after
 * pay as much as into them, so the figure is an estimate and never known.
 */
import { dayNumber, fromDayNumber } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { accountCovers } from "../analysis/coverage.ts";
import { INCOME_TYPES } from "../analysis/income.ts";
import { incomeBase } from "../analysis/income-series.ts";
import { largePurchases } from "../analysis/large.ts";
import { netPurchase } from "../analysis/context.ts";
import type { Fact } from "./fact.ts";

interface PaydayCycle {
  pay: IsoDate;
  next: IsoDate;
  /** Spent on pay day and the three days after it. */
  afterCents: number;
  /** Spent in the seven days before this pay. */
  beforeCents: number;
  /** The days after against the days before, each over what its weekdays give; null when the days before give nothing to compare. */
  ratio: number | null;
  /** What the days after took beyond the pace of the days before. */
  extraCents: number;
  rows: string[];
}

type SkipReason = "open" | "not_covered" | "card_bill" | "few_rows" | "short";

interface PaydayEffect {
  /** Cycles counted, oldest first, the last `CYCLES` at most. */
  cycles: PaydayCycle[];
  skipped: { pay: IsoDate; reason: SkipReason }[];
  /** The days after pay over the cycles counted, against the days before; null under `MIN_CYCLES`. */
  ratio: Fact<number> | null;
  /** What the days after took beyond the pace of the days before, a cycle on average; null under `MIN_CYCLES`. */
  extraCents: Fact<number> | null;
  /** How often four days put at random in the cycles gave as high a ratio (the permutation test); null under `MIN_CYCLES`. */
  chance: number | null;
  told: boolean;
}

const AFTER_DAYS = 4;
const BEFORE_DAYS = 7;
const CYCLES = 12;
const MIN_CYCLES = 6;
/** Over 100 steady made-up households the ratio reached 1,84 by chance alone: an effect is told only well beyond it. */
const TOLD_RATIO = 2;
/** With any one cycle left out, the days after pay still run at least this much faster. */
const LEFT_OUT_RATIO = 1.6;
const ROW_CAP = 3;
const DRAWS = 999;
/** No draw beats pay day: chance one in a thousand. Month-to-month swings make draws within a cycle look more alike than they are, so the bar is set beyond the usual one in a hundred. */
const TOLD_CHANCE = 0.001;
const TOLD_EXTRA_CENTS = 5000;
/** A pay this much of the series' usual level or more is a pay day; a small top-up is not. */
const PAY_SHARE = 0.5;
const MIN_PAY_CENTS = 50_000;
/** Pays of several series within this many days are one pay day. */
const SAME_PAY_DAYS = 3;
const MIN_CYCLE_ROWS = 8;
const CARD_BILL_SHARE = 0.5;

/** The day-to-day spending of a row in cents, 0 for anything else. */
function dayToDay(t: AnalysisTx, billIds: ReadonlySet<string>, large: ReadonlySet<string>): number {
  if (t.isTransfer || t.kind !== "expense" || t.category === "card_bill" || t.reference || billIds.has(t.id) || large.has(t.id)) return 0;
  return netPurchase(t);
}

export function paydayEffect(ctx: AnalysisContext): PaydayEffect {
  const empty: PaydayEffect = { cycles: [], skipped: [], ratio: null, extraCents: null, chance: null, told: false };
  const pays = payDays(ctx);
  if (pays.length < 2) return empty;

  const billIds = new Set(ctx.recurring.filter((s) => s.kind === "subscription" || s.kind === "bill").flatMap((s) => s.transactionIds));
  const large = largePurchases(ctx);
  const spent = new Map<number, number>();
  const rowsOn = new Map<number, string[]>();
  const billed = new Map<number, number>();
  const payers = new Map<number, Set<string>>();
  const purchases: { t: AnalysisTx; cents: number }[] = [];
  for (const t of ctx.txs) {
    if (t.category === "card_bill" && !t.isTransfer) billed.set(t.day, (billed.get(t.day) ?? 0) + t.flows.debt);
    const cents = dayToDay(t, billIds, large);
    if (cents > 0) purchases.push({ t, cents });
  }
  // one dear purchase is no habit of pay day: a row counts up to three times the household's median purchase
  const sorted = purchases.map((p) => p.cents).sort((a, b) => a - b);
  const cap = ROW_CAP * (sorted[sorted.length >> 1] ?? 0);
  for (const { t, cents } of purchases) {
    spent.set(t.day, (spent.get(t.day) ?? 0) + Math.min(cents, cap));
    rowsOn.set(t.day, [...(rowsOn.get(t.day) ?? []), t.id]);
    payers.set(t.day, (payers.get(t.day) ?? new Set()).add(t.accountId));
  }
  const sum = (m: ReadonlyMap<number, number>, from: number, to: number) => {
    let s = 0;
    for (let d = from; d <= to; d++) s += m.get(d) ?? 0;
    return s;
  };

  const today = dayNumber(ctx.today);
  const counted: { pay: number; next: number }[] = [];
  const skipped: PaydayEffect["skipped"] = [];
  for (let i = 1; i + 1 < pays.length; i++) {
    const pay = pays[i]!;
    const next = pays[i + 1]!;
    const skip = (reason: SkipReason) => skipped.push({ pay: fromDayNumber(pay), reason });
    if (next >= today) {
      skip("open");
      continue;
    }
    if (next - pay < AFTER_DAYS + BEFORE_DAYS || pay - pays[i - 1]! < AFTER_DAYS + BEFORE_DAYS) {
      skip("short");
      continue;
    }
    const accounts = new Set<string>();
    let rows = 0;
    for (let d = pay - BEFORE_DAYS; d < next; d++) {
      for (const a of payers.get(d) ?? []) accounts.add(a);
      rows += rowsOn.get(d)?.length ?? 0;
    }
    if (!accounts.size || !accountCovers(ctx, accounts, fromDayNumber(pay - BEFORE_DAYS))) skip("not_covered");
    else if (sum(billed, pay - BEFORE_DAYS, next - 1) > CARD_BILL_SHARE * sum(spent, pay - BEFORE_DAYS, next - 1)) skip("card_bill");
    else if (rows < MIN_CYCLE_ROWS) skip("few_rows");
    else counted.push({ pay, next });
  }
  const last = counted.slice(-CYCLES);
  if (last.length < MIN_CYCLES) return { ...empty, skipped };

  // the household's own weekdays over the cycles counted: the mean a day of each weekday
  const byWeekday = Array.from({ length: 7 }, () => ({ cents: 0, days: 0 }));
  const weekday = (d: number) => (d + 3) % 7; // day number 0 is a Thursday (1970-01-01); Monday is 0
  for (const c of last)
    for (let d = c.pay - BEFORE_DAYS; d < c.next; d++) {
      const w = byWeekday[weekday(d)]!;
      w.cents += spent.get(d) ?? 0;
      w.days += 1;
    }
  const usualOn = (d: number) => {
    const w = byWeekday[weekday(d)]!;
    return w.days ? w.cents / w.days : 0;
  };
  const expected = (from: number, to: number) => {
    let s = 0;
    for (let d = from; d <= to; d++) s += usualOn(d);
    return s;
  };

  const cycles: PaydayCycle[] = last.map(({ pay, next }) => {
    const afterTo = pay + AFTER_DAYS - 1;
    const beforeFrom = pay - BEFORE_DAYS;
    const after = sum(spent, pay, afterTo);
    const before = sum(spent, beforeFrom, pay - 1);
    const expAfter = expected(pay, afterTo);
    const expBefore = expected(beforeFrom, pay - 1);
    const paceBefore = expBefore > 0 ? before / expBefore : 0;
    const ratio = expAfter > 0 && paceBefore > 0 ? after / expAfter / paceBefore : null;
    const rows: string[] = [];
    for (let d = pay; d <= afterTo; d++) rows.push(...(rowsOn.get(d) ?? []));
    return { pay: fromDayNumber(pay), next: fromDayNumber(next), afterCents: after, beforeCents: before, ratio, extraCents: Math.round(after - expAfter * paceBefore), rows };
  });
  const evidence = cycles.flatMap((c) => c.rows);
  // pooled over cycles, so four days of a sparse card do not swing it: the four days at `offsetOf(i)` after each pay,
  // against the pace of the days before those pays, both over what their weekdays give
  type Cycle = (typeof last)[number];
  const ratioOver = (cs: readonly Cycle[], offsetOf: (i: number) => number) => {
    let cents = 0;
    let exp = 0;
    let before = 0;
    let expBefore = 0;
    cs.forEach((c, i) => {
      const o = offsetOf(i);
      cents += sum(spent, c.pay + o, c.pay + o + AFTER_DAYS - 1);
      exp += expected(c.pay + o, c.pay + o + AFTER_DAYS - 1);
      before += sum(spent, c.pay - BEFORE_DAYS, c.pay - 1);
      expBefore += expected(c.pay - BEFORE_DAYS, c.pay - 1);
    });
    const pace = expBefore > 0 ? before / expBefore : 0;
    return { ratio: exp > 0 && pace > 0 ? cents / exp / pace : 0, extra: cents - exp * pace };
  };
  const real = ratioOver(last, () => 0);
  // it stands with any one cycle left out: one wild month makes no habit
  const without = last.map((_, i) => ratioOver([...last.slice(0, i), ...last.slice(i + 1)], () => 0).ratio);
  // a permutation test: the same ratio with each cycle's four days put at a random other place in it, after the days
  // after pay. An effect of pay day beats nearly every draw; chance beats about as many as it loses to.
  const rooms = last.map((c) => {
    const room: number[] = [];
    for (let o = AFTER_DAYS; o + AFTER_DAYS <= c.next - c.pay; o++) room.push(o);
    return room;
  });
  let beaten = 0;
  let seed = 0x2545f491;
  const draw = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  for (let k = 0; k < DRAWS; k++) if (ratioOver(last, (i) => rooms[i]![draw(rooms[i]!.length)] ?? 0).ratio >= real.ratio) beaten++;
  const chance = (beaten + 1) / (DRAWS + 1);
  const extraPerCycle = Math.round(real.extra / last.length);
  const ratio: Fact<number> = { value: Math.round(real.ratio * 100) / 100, confidence: "estimated", evidence };
  const extra: Fact<number> = { value: extraPerCycle, confidence: "estimated", evidence };
  const told = real.ratio >= TOLD_RATIO && without.every((r) => r >= LEFT_OUT_RATIO) && chance <= TOLD_CHANCE && extraPerCycle >= TOLD_EXTRA_CENTS;
  return { cycles, skipped, ratio, extraCents: extra, chance: Math.round(chance * 1000) / 1000, told };
}

/**
 * The household's pay days as day numbers, oldest first: the days pay of a regular earned income came (salary, pension,
 * a regular benefit), from 500 € and half the series' usual level. Pays of two series within three days are one.
 */
export function payDays(ctx: AnalysisContext): number[] {
  const days: number[] = [];
  for (const s of incomeBase(ctx, ctx.today).series) {
    if (!INCOME_TYPES[s.type].regular || s.usualCents < MIN_PAY_CENTS) continue;
    for (const t of s.rows) if (t.amountCents >= s.usualCents * PAY_SHARE) days.push(t.day);
  }
  days.sort((a, b) => a - b);
  const out: number[] = [];
  for (const d of days) if (!out.length || d - out[out.length - 1]! > SAME_PAY_DAYS) out.push(d);
  return out;
}
