/**
 * Decision: whether money friends sent was their share of something the household paid, so the household knows what
 * the thing cost it, and whether its income is really income.
 *
 * D3, split bills, the level that asks (BA1-behaviour-model.md §D3). The strict match of returns.ts stays the one that
 * nets by itself; this finds the looser cases it leaves, and only ever asks. A purchase P on any of the household's
 * accounts (no bill, contract, person or payment of no category), and within three days money in from people (a person's name, or a MobilePay
 * row that names no one), each 15 % to 60 % of P: one payment that is P/2 or P/3 to the cent and not a round 50
 * cents; or, when P is something
 * friends do together (a meal, a game, a trip, a taxi, a gift, a stake put in together), two or more from distinct payers, each a whole 50
 * cents, about equal and within two days of each other, that leave the organiser a share and add up to 75 % to 105 %
 * of equal shares (friends round down). The best fits are taken first and a payment fits
 * one purchase. Payments the strict rule matched, payments of a steady payer (an allowance, a rent share) and
 * payments of a payer who sends many a day (a collection or sales, asked about apart) are no candidates. At most
 * three questions a week, the largest purchase first, and only about the last 90 days. A friend's share of a stake
 * answered yes lowers the stake (payer role cost_share); it is never a payout, which nets as a win (BH2).
 */
import { dayNumber } from "../dates.ts";
import { isSharedPurchase, isUnnamedMobilePay } from "../mobilepay.ts";
import { payerKeyOf, steadyPayers } from "../payer-role.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import type { Fact } from "./fact.ts";

interface SplitQuestion {
  purchaseId: string;
  day: IsoDate;
  payee: string;
  purchaseCents: number;
  /** The payments that may be shares, oldest first, as a guess: nothing is netted before the household answers. */
  shares: Fact<number[]>;
  /** What the purchase cost the household if the payments are shares. */
  leftCents: number;
}

/** A payer who sends so many payments that they are no friends' shares: asked about once as a payer. */
interface BusyPayer {
  key: string;
  rows: number;
  /** Days with `BUSY_DAY_ROWS` payments or more. */
  busyDays: number;
}

interface SplitCandidates {
  questions: SplitQuestion[];
  busyPayers: BusyPayer[];
}

/** Friends send their shares within this many days of the purchase, and within `GROUP_DAYS` of each other. */
const SPLIT_DAYS = 3;
const GROUP_DAYS = 2;
const MIN_PURCHASE_CENTS = 1000;
const MIN_SHARE = 0.15;
const MAX_SHARE = 0.6;
const ROUND_CENTS = 50;
const MAX_PAYERS = 8;
/** Shares are about equal: the largest at most this many times the smallest. */
const EQUAL_SPREAD = 1.25;
/** Shares add up to at least this much of what equal shares would be (friends round down, the organiser pays more), and at most `FIT_OVER` of it. */
const FIT_UNDER = 0.75;
const FIT_OVER = 1.05;
const PER_WEEK = 3;
const BUSY_DAYS = 90;
const BUSY_ROWS = 20;
const BUSY_DAY_ROWS = 5;
const BUSY_DAYS_NEEDED = 3;

/** Money in from a person: a person's payment by its category, or wallet money that names nobody. */
const isFromPerson = (t: AnalysisTx) => t.amountCents > 0 && !t.isTransfer && t.categorySource !== "user" && (t.category === "p2p_in" || isUnnamedMobilePay(t));
/**
 * What friends do together and split: a meal, a game, a trip, a taxi, a gift, a stake put in together ("kimppadepo").
 * Groceries and fuel are everyday costs first: only an exact half or third of them is asked about.
 */
const SHARED_CATEGORIES: ReadonlySet<string> = new Set(["restaurants", "food_delivery", "entertainment", "fitness", "travel", "transport", "gifts_donations", "alcohol", "gambling"]);
/** A payment the app could not place is too unclear to ask about. */
const NEVER_SHARED: ReadonlySet<string> = new Set(["other"]);
const isPurchase = (t: AnalysisTx) =>
  t.amountCents < 0 && !t.isTransfer && t.kind === "expense" && isSharedPurchase(t.category) && !NEVER_SHARED.has(t.category) && -t.amountCents >= MIN_PURCHASE_CENTS;

/** Questions about the purchases of the last `days` days: an old court booking is not worth asking about. */
export function splitCandidates(ctx: AnalysisContext, days = 90): SplitCandidates {
  const today = dayNumber(ctx.today);
  const incoming = ctx.txs.filter(isFromPerson);
  const busy = busyPayersOf(incoming, today);
  const busyKeys = new Set(busy.map((b) => b.key));
  const steady = steadyPayers(incoming);
  const matched = new Set(ctx.returns.keys());
  const purchases = ctx.txs.filter((t) => isPurchase(t) && t.refunded === 0 && today - t.day <= days);

  const eligible = incoming.filter((t) => {
    const key = payerKeyOf(t);
    return !matched.has(t.id) && !(key && (steady.has(key) || busyKeys.has(key)));
  });

  // every purchase with the group of payments that fits it best; then the best fits first, a payment used once
  const fits: { p: AnalysisTx; shares: AnalysisTx[]; miss: number }[] = [];
  let from = 0;
  for (const p of purchases) {
    while (from < eligible.length && eligible[from]!.day < p.day) from++;
    const near: AnalysisTx[] = [];
    for (let i = from; i < eligible.length && eligible[i]!.day - p.day <= SPLIT_DAYS; i++) {
      const share = eligible[i]!.amountCents / -p.amountCents;
      if (share >= MIN_SHARE && share <= MAX_SHARE) near.push(eligible[i]!);
    }
    const best = bestGroup(-p.amountCents, distinctPayers(near), SHARED_CATEGORIES.has(p.category));
    if (best) fits.push({ p, ...best });
  }
  fits.sort((x, y) => x.miss - y.miss || y.p.amountCents - x.p.amountCents || (x.p.id < y.p.id ? -1 : 1));
  const used = new Set<string>();
  const found: SplitQuestion[] = [];
  for (const { p, shares } of fits) {
    if (shares.some((t) => used.has(t.id))) continue;
    for (const t of shares) used.add(t.id);
    const total = shares.reduce((sum, t) => sum + t.amountCents, 0);
    found.push({
      purchaseId: p.id,
      day: p.bookingDate,
      payee: p.merchant,
      purchaseCents: -p.amountCents,
      shares: { value: shares.map((t) => t.amountCents), confidence: "guess", evidence: [p.id, ...shares.map((t) => t.id)] },
      leftCents: -p.amountCents - total,
    });
  }

  // at most three a week, the largest first
  const perWeek = new Map<number, SplitQuestion[]>();
  for (const q of found) {
    const week = Math.floor((dayNumber(q.day) + 3) / 7);
    perWeek.set(week, [...(perWeek.get(week) ?? []), q]);
  }
  const questions = [...perWeek.values()].flatMap((qs) => qs.sort((a, b) => b.purchaseCents - a.purchaseCents || (a.purchaseId < b.purchaseId ? -1 : 1)).slice(0, PER_WEEK));
  questions.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.purchaseId < b.purchaseId ? -1 : 1));
  return { questions, busyPayers: busy };
}

/**
 * The payments that look most like shares of `cents`: one that is half or a third of it to the cent (and no round 50
 * cents, which a round sum gives by chance), or two or more
 * whole 50 cents about equal
 * (the largest within a quarter of the smallest, sent within two days of each other) that leave the organiser a share
 * and add up to 75 % to 105 % of what equal shares would give. `miss` is how far they are from that, as a share of the
 * purchase. Rounded shares are read only on what friends do together (`together`); half of a basket of groceries to the
 * cent is a share too, two rounded sums near a basket are as likely chance.
 */
function bestGroup(cents: number, payments: readonly AnalysisTx[], together: boolean): { shares: AnalysisTx[]; miss: number } | null {
  let best: { shares: AnalysisTx[]; miss: number } | null = null;
  const consider = (shares: AnalysisTx[], miss: number) => {
    if (!best || miss < best.miss || (miss === best.miss && shares.length > best.shares.length)) best = { shares, miss };
  };
  // a round share is a third of a round sum by chance as often as by sharing: only one with cents of its own tells
  for (const t of payments) for (const parts of [2, 3]) if (t.amountCents % ROUND_CENTS !== 0 && Math.abs(t.amountCents * parts - cents) < parts) consider([t], 0);
  if (!together) return best;
  const sorted = payments.filter((t) => t.amountCents % ROUND_CENTS === 0).sort((a, b) => a.amountCents - b.amountCents || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    const least = sorted[i]!.amountCents;
    const first = sorted[i]!.day;
    const group = sorted.slice(i).filter((t) => t.amountCents <= least * EQUAL_SPREAD && Math.abs(t.day - first) <= GROUP_DAYS).slice(0, MAX_PAYERS);
    const total = group.reduce((sum, t) => sum + t.amountCents, 0);
    const equal = (cents * group.length) / (group.length + 1);
    if (group.length < 2 || total > cents - least || total < equal * FIT_UNDER || total > equal * FIT_OVER) continue;
    consider(group, Math.abs(total - equal) / cents);
  }
  return best;
}

/** One payment per payer, the first; payments that name nobody are each their own payer, since nothing tells them apart. */
function distinctPayers(rows: readonly AnalysisTx[]): AnalysisTx[] {
  const seen = new Set<string>();
  return rows.filter((t) => {
    const key = isUnnamedMobilePay(t) ? `row:${t.id}` : (payerKeyOf(t) ?? `row:${t.id}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Payers with `BUSY_ROWS` payments or more in the last 90 days and `BUSY_DAYS_NEEDED` days of `BUSY_DAY_ROWS` or more. */
function busyPayersOf(incoming: readonly AnalysisTx[], today: number): BusyPayer[] {
  const byKey = new Map<string, Map<number, number>>();
  for (const t of incoming) {
    const key = payerKeyOf(t);
    if (!key || today - t.day > BUSY_DAYS) continue;
    const days = byKey.get(key) ?? new Map<number, number>();
    days.set(t.day, (days.get(t.day) ?? 0) + 1);
    byKey.set(key, days);
  }
  const out: BusyPayer[] = [];
  for (const [key, days] of byKey) {
    const rows = [...days.values()].reduce((s, n) => s + n, 0);
    const busyDays = [...days.values()].filter((n) => n >= BUSY_DAY_ROWS).length;
    if (rows >= BUSY_ROWS && busyDays >= BUSY_DAYS_NEEDED) out.push({ key, rows, busyDays });
  }
  return out.sort((a, b) => b.rows - a.rows || (a.key < b.key ? -1 : 1));
}
