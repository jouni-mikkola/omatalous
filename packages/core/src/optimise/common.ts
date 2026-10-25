/**
 * Helpers every Optimoi area uses, so the rules of the plan hold in one place: the year window of complete months,
 * accounts that existed before a window, the level without one-offs, the yearly figure, certainty from weaknesses and
 * the evidence checks behind them.
 */
import { type AnalysisContext, type AnalysisTx, netSpend } from "../analysis/context.ts";
import { accountCovers, monthSpan, sameAccounts } from "../analysis/coverage.ts";
import { dataQualityReport, type QualitySignal } from "../analysis/data-quality.ts";
import { cardGapCause, missingCardPurchases } from "../analysis/card-bills.ts";
import { balanceWalk, type BalanceWalk } from "../analysis/balance-walk.ts";
import { formatEur } from "../analysis/format.ts";
import { ITEM_GATE_MONTHLY_CENTS } from "../analysis/insights/shared.ts";
import type { DateRange } from "../analysis/period.ts";
import { LEVEL, oneOffs } from "../analysis/one-offs.ts";
import { completeMonthsBefore, isCompleteMonth } from "../analysis/usual.ts";
import { addMonths, dayNumber, monthEnd, monthOf } from "../dates.ts";
import { priceChangeYearlyCents, type RecurringSeries } from "../recurring.ts";
import { bufferReport } from "../reports/buffer.ts";
import { mean, median } from "../stats.ts";
import type { BalanceInput, IsoDate } from "../types.ts";
import { AREA_IDS, type AreaId, type AreaInput, type Certainty, type CertaintyLevel, type EvidenceQuality, type NoDataWhy, type Weakness, type WeaknessId } from "./types.ts";

/** Rule 3: the insights' item gate over a year, 120 €. An area adds its own gate on top. */
export const GATE_YEARLY_CENTS = 12 * ITEM_GATE_MONTHLY_CENTS;

/** At most this many evidence rows per finding (rule 4). */
export const MAX_ROWS = 60;

/** Rule 6: what a finding weighs in the order of areas. The euros shown stay mid. */
export const CERTAINTY_WEIGHT: Readonly<Record<CertaintyLevel, number>> = { korkea: 1, keskitaso: 0.6, matala: 0.25 };

/** `<area>:<kind>` or `<area>:<kind>:<subject>`: stable for the same subject, so a stored state finds it again. */
export function findingId(area: AreaId, kind: string, subject?: string | null): string {
  return subject ? `${area}:${kind}:${subject}` : `${area}:${kind}`;
}

const KIND = /^[a-z][a-z0-9_]{0,39}$/;
// a merchant name or a series id: printable, bounded, no control characters
const SUBJECT = /^[^\p{Cc}]{1,200}$/u;

/** A subject the server may store in a finding id or an input key. */
export const isSubject = (text: string): boolean => SUBJECT.test(text);

/** The parts of a finding id, or null for text no area could have made: the server's check before it stores a state. */
export function parseFindingId(id: string): { area: AreaId; kind: string; subject: string | null } | null {
  const first = id.indexOf(":");
  const second = first < 0 ? -1 : id.indexOf(":", first + 1);
  const area = id.slice(0, first) as AreaId;
  const kind = second < 0 ? id.slice(first + 1) : id.slice(first + 1, second);
  const subject = second < 0 ? null : id.slice(second + 1);
  if (first < 0 || !(AREA_IDS as readonly string[]).includes(area) || !KIND.test(kind) || (subject !== null && !SUBJECT.test(subject))) return null;
  return { area, kind, subject };
}

export interface YearWindow {
  /** Complete months up to `end`, oldest first, at most 12. */
  months: string[];
  /** The first day of the first month; null without a complete month. */
  from: IsoDate | null;
  to: IsoDate;
}

/** Rule 2: the last 12 complete months up to `end` (the last day of the last complete month). */
export function yearWindow(ctx: AnalysisContext, end: IsoDate): YearWindow {
  const months = completeMonthsBefore(ctx, addMonths(monthOf(end), 1), 12);
  return { months, from: months.length ? `${months[0]}-01` : null, to: end };
}

/**
 * Accounts with rows that were in the data from `from` on (`accountCovers`, with its slack of a few days). A window
 * counts only these, so an account connected inside it never reads as a rise (rule 4).
 */
export function accountsBefore(ctx: AnalysisContext, from: IsoDate): ReadonlySet<string> {
  const withRows = new Set(ctx.txs.map((t) => t.accountId));
  return new Set([...withRows].filter((id) => accountCovers(ctx, [id], from)));
}

/** What a row cost in the end: consumption and debt service less what came back, never below zero. Transfers cost nothing. */
export function netCost(t: Pick<AnalysisTx, "spend" | "refunded" | "isTransfer">): number {
  return t.isTransfer ? 0 : netSpend(t);
}

export interface Level {
  /** Cents per month, aligned with the months given. */
  byMonth: number[];
  /** Ids of the one-offs (`oneOffs`, the level policy), left out of the level. */
  struck: string[];
}

/**
 * The monthly level of `rows` over `months`, with the one-offs (`oneOffs`, the level policy every view uses) taken out
 * and listed struck. Purchases count `netCost`, so a full refund removes a purchase; transfers never count.
 */
export function levelWithoutOneOffs(rows: readonly AnalysisTx[], months: readonly string[], fixed?: ReadonlySet<string>): Level {
  const inWindow = new Set(months);
  const counted = rows.filter((t) => !t.isTransfer && inWindow.has(monthOf(t.bookingDate)));
  const struck = oneOffs(counted, LEVEL, fixed);
  const at = new Map(months.map((m, i) => [m, i]));
  const byMonth = months.map(() => 0);
  for (const t of counted) if (!struck.has(t.id)) byMonth[at.get(monthOf(t.bookingDate))!]! += netCost(t);
  return { byMonth, struck: [...struck] };
}

/** Rule 7 weakness for a yearly figure from fewer than 12 months. */
export function shortHistoryWeakness(months: number): Weakness {
  return { id: "short_history", reason: `Vuoden summa on laskettu ${months} kuukauden tiedoista.` };
}

export interface Annualised {
  yearlyCents: number;
  months: number;
  /** Set when fewer than 12 months stand behind the figure. */
  weakness: Weakness | null;
}

/**
 * Rule 2: the sum of the last 12 monthly values; 6 to 11 values give their mean times 12 with one certainty step;
 * under 6 there is no yearly figure.
 */
export function annualise(byMonth: readonly number[]): Annualised | null {
  const n = Math.min(12, byMonth.length);
  if (n < 6) return null;
  const sum = byMonth.slice(-n).reduce((s, x) => s + x, 0);
  return n === 12 ? { yearlyCents: sum, months: 12, weakness: null } : { yearlyCents: Math.round((sum / n) * 12), months: n, weakness: shortHistoryWeakness(n) };
}

/** The order of rule 7: the first weakness present names the reason. */
export const WEAKNESS_ORDER: readonly WeaknessId[] = ["short_history", "estimate", "sample", "gap", "stale", "own_unconnected", "uncategorised", "uncertain_rows", "wide_range"];

export const WIDE_RANGE: Weakness = { id: "wide_range", reason: "Vaihteluväli on suurempi kuin arvio." };

const NO_WEAKNESS = "Laskettu omista tiedoista.";

/** The same weakness twice counts once; the rest in rule 7's order. */
export function sortWeaknesses(weaknesses: readonly Weakness[]): Weakness[] {
  const seen = new Set<string>();
  const unique = weaknesses.filter((w) => {
    const key = `${w.id}\u0000${w.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => WEAKNESS_ORDER.indexOf(a.id) - WEAKNESS_ORDER.indexOf(b.id));
}

const LEVELS = ["korkea", "keskitaso", "matala"] as const;

/** Rule 7: korkea, one step keskitaso, two steps or more matala. A finding is never hidden for its certainty. */
export function certaintyOf(weaknesses: readonly Weakness[]): Certainty {
  const sorted = sortWeaknesses(weaknesses);
  return { level: LEVELS[Math.min(2, sorted.length)]!, reason: sorted[0]?.reason ?? NO_WEAKNESS };
}

const ACCOUNT_SIGNALS: ReadonlySet<QualitySignal["id"]> = new Set(["gap", "stale", "own_unconnected"]);

/**
 * The quality signals over the window for the household and for each account alone. Each account is run through the
 * same report with only its own rows, so the signal names the account it is about.
 */
export function qualityOf(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[]): EvidenceQuality {
  const signals = dataQualityReport(ctx, range, balances).signals;
  const byAccount: Record<string, QualitySignal["id"][]> = {};
  for (const account of ctx.accounts) {
    const own = { ...ctx, accounts: [account], txs: ctx.txs.filter((t) => t.accountId === account.id) };
    byAccount[account.id] = dataQualityReport(own, range, []).signals.map((s) => s.id).filter((id) => ACCOUNT_SIGNALS.has(id));
  }
  return { signals, byAccount };
}

/** Over this share of evidence rows categorised by default or by industry is one step (rule 7). */
const UNCERTAIN_ROW_SHARE = 0.3;

const byIdCache = new WeakMap<AnalysisContext, Map<string, AnalysisTx>>();

/** The context's rows by id, built once per context. */
export function rowsById(ctx: AnalysisContext): ReadonlyMap<string, AnalysisTx> {
  let map = byIdCache.get(ctx);
  if (!map) byIdCache.set(ctx, (map = new Map(ctx.txs.map((t) => [t.id, t]))));
  return map;
}

const ACCOUNT_REASON: Record<"gap" | "stale", (name: string) => string> = {
  gap: (name) => `Tilin ${name} tiedoissa on tauko.`,
  stale: (name) => `Tilin ${name} uusimpia tapahtumia ei ole haettu.`,
};

/**
 * What is wrong with the household's data as a whole, counted on no finding: over 5 % of spending uncategorised and an
 * own account that moves money to one that is not connected. The page prints them once, above the findings.
 */
export function householdWeakness(quality: EvidenceQuality): Weakness[] {
  const out: Weakness[] = [];
  for (const id of ["uncategorised", "own_unconnected"] as const) {
    const signal = quality.signals.find((s) => s.id === id);
    if (signal) out.push({ id, reason: `${signal.title}.` });
  }
  return sortWeaknesses(out);
}

/**
 * Rule 7 weaknesses of the evidence: a gap or stale signal on an account the rows are on (one step per kind) and over
 * 30 % of the rows categorised by default or industry. Nothing for a finding without rows. The household's own faults
 * are in `householdWeakness`, not here.
 */
export function evidenceWeakness(ctx: AnalysisContext, rows: readonly string[], quality: EvidenceQuality): Weakness[] {
  const byId = rowsById(ctx);
  const txs = rows.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t);
  if (!txs.length) return [];
  const out: Weakness[] = [];
  const accounts = [...new Set(txs.map((t) => t.accountId))];
  for (const kind of ["gap", "stale"] as const) {
    const hit = accounts.find((id) => quality.byAccount[id]?.includes(kind));
    if (hit) out.push({ id: kind, reason: ACCOUNT_REASON[kind](ctx.accounts.find((a) => a.id === hit)?.name ?? hit) });
  }
  const uncertain = txs.filter((t) => t.categorySource === "default" || t.categorySource === "industry").length / txs.length;
  if (uncertain > UNCERTAIN_ROW_SHARE) {
    out.push({ id: "uncertain_rows", reason: `${Math.round(uncertain * 100)}\u00a0% laskelman tapahtumista on luokiteltu toimialan mukaan tai oletuksena.` });
  }
  return out;
}

// ── shared by several areas (an area imports no other area) ──

/** Months on each side of a year-over-year comparison: six now, six a year earlier. */
export const YEAR_OVER_YEAR_SIDE = 6;
/** The full months `yearOverYear` needs: the year, and the six before it a year earlier. */
export const YEAR_OVER_YEAR_NEED = 12 + YEAR_OVER_YEAR_SIDE;

/** Overlap keys of eating out. Delivery and a café habit claim them too, so the headline counts that money once. */
export const EATING_OUT_CLAIMS: readonly string[] = ["category:restaurants", "category:food_delivery"];

export { mean };

/** "8", "8,5": a count a month with at most one decimal. */
export function formatCount(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

/** The last six complete months, the same six a year earlier and every month between, or null without 18. */
export function yearOverYear(a: AreaInput): { now: string[]; then: string[]; all: string[] } | null {
  if (a.months.length < 12) return null;
  const now = a.months.slice(-YEAR_OVER_YEAR_SIDE);
  const then = now.map((m) => addMonths(m, -12));
  if (!then.every((m, i) => isCompleteMonth(a.ctx, m) && sameAccounts(a.ctx, monthSpan(m), monthSpan(now[i]!)))) return null;
  return { now, then, all: [...then, ...a.months.slice(0, 12 - YEAR_OVER_YEAR_SIDE), ...now] };
}

/** An outside figure the check compares with is old or missing (`factOn`). */
export const WHY_FACTS: NoDataWhy = { cause: "facts", text: "Vertailuluku on vanhentunut tai puuttuu." };
/** A check that could not say and has no cause of the other kinds: it does not guess one. */
export const WHY_OTHER: NoDataWhy = { cause: "other", text: "Tarkistus ei saanut kaikkia tarvitsemiaan tietoja." };

/**
 * Why a check on the year's spending could not say with `need` full months: card bills in the year whose purchases are
 * not in the data come first, since no month of history mends them; then a history shorter than `need`, with both
 * counts. A history long enough is no cause, so the check has no reason of this kind to name.
 */
export function whyHistory(a: AreaInput, need: number): NoDataWhy {
  const cause = cardGapCause(missingCardPurchases(a.ctx, { from: `${addMonths(monthOf(a.end), -11)}-01`, to: a.end }));
  if (cause) return { cause: "cards", text: `Korttilaskuja on, mutta ${cause}.` };
  const months = completeMonthsBefore(a.ctx, monthOf(a.today), 1200).length;
  if (months >= need) return WHY_OTHER;
  const count = (n: number) => (n === 1 ? "1 valmis kuukausi" : `${n} valmista kuukautta`);
  return { cause: "history", text: `Vertailuun tarvitaan ${count(need)}, mutta tapahtumahistoriassa ${months === 0 ? "ei ole yhtään" : `on vain ${count(months)}`}.` };
}

/** Over this the "interest" cannot be a deposit rate. */
const MAX_YIELD = 0.05;

/** A savings row this many days from the same sum leaving another own account is the other leg of a move. */
const MIRROR_DAYS = 3;

/** A withholding tax the bank books as its own row beside the interest. */
const WITHHOLDING = /L[AÄ]HDEVERO/i;

const pctFormat = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });

/** 0.0153 → "1,53 %". */
export const pct = (fraction: number) => `${pctFormat.format(fraction * 100)}\u00a0%`;

export const eur = (cents: number) => formatEur(cents, false);

/** The viewer's own accounts of a type: the money the viewer can move. */
export function ownAccounts(a: AreaInput, type: BalanceInput["type"]): BalanceInput[] {
  return a.balances.filter((b) => b.type === type && b.ownerName === null);
}

/** The last day of each window month as a day number. */
export function monthEndDays(months: readonly string[]): number[] {
  return months.map((m) => dayNumber(monthEnd(m)));
}

/** The walks of accounts that all have a balance; null when one has none. */
export function walksOf(a: AreaInput, accounts: readonly BalanceInput[]): BalanceWalk[] | null {
  const walks = accounts.map((b) => balanceWalk(a.ctx, b));
  return walks.every((w): w is BalanceWalk => w !== null) ? walks : null;
}

export interface SavingsYield {
  /** Interest paid on the savings accounts in the window, less a withholding tax booked as its own row. */
  interestCents: number;
  /** Mean month-end balance of the savings accounts over the window. */
  meanBalanceCents: number;
  /** interest / mean balance: 0.015 is 1,5 %. */
  rate: number;
  /** The interest rows. */
  rows: string[];
  accounts: BalanceInput[];
  walks: BalanceWalk[];
}

/**
 * The household's own savings yield over 12 complete months: interest paid on its savings accounts divided by their
 * mean month-end balance. Finnish banks pay deposit interest after the withholding tax, so this is already the yield
 * after tax. A move between own accounts is never interest. Null without 12 complete months (a yearly interest
 * payment could fall outside a shorter window), without an own savings account, when one has no balance or when one
 * started inside the window.
 */
export function savingsYield(a: AreaInput): SavingsYield | null {
  if (a.months.length < 12) return null;
  const accounts = ownAccounts(a, "savings");
  const from = `${a.months[0]}-01`;
  const before = accountsBefore(a.ctx, from);
  if (!accounts.length || accounts.some((b) => !before.has(b.id))) return null;
  const walks = walksOf(a, accounts);
  if (!walks) return null;
  const ends = monthEndDays(a.months);
  const meanBalanceCents = Math.round(ends.reduce((s, day) => s + walks.reduce((t, w) => t + w.at(day)!, 0), 0) / ends.length);
  if (meanBalanceCents <= 0) return null;
  const ids = new Set(accounts.map((b) => b.id));
  const inWindow = (t: AnalysisTx) => ids.has(t.accountId) && !t.isTransfer && t.bookingDate >= from && t.bookingDate <= a.end;
  // the savings leg of a move from an own account can keep a text such as KORKO when only the other leg names the
  // account: the same sum leaving another own account within a few days makes it a move, never interest
  const own = new Set(a.ctx.accounts.map((acc) => acc.id));
  const mirrored = (t: AnalysisTx) =>
    a.ctx.txs.some((o) => o.accountId !== t.accountId && own.has(o.accountId) && o.amountCents === -t.amountCents && Math.abs(o.day - t.day) <= MIRROR_DAYS);
  const interest = a.ctx.txs.filter((t) => inWindow(t) && t.category === "investment_income" && t.amountCents > 0 && !mirrored(t));
  const tax = a.ctx.txs.filter((t) => inWindow(t) && t.amountCents < 0 && WITHHOLDING.test(`${t.description ?? ""} ${t.merchant} ${t.counterparty ?? ""}`));
  const interestCents = interest.reduce((s, t) => s + t.flows.income, 0) + tax.reduce((s, t) => s + t.amountCents, 0);
  const rate = Math.max(0, interestCents) / meanBalanceCents;
  // no deposit account pays this much: the rows are something else (a sale, a refund), so there is no yield to use
  if (rate > MAX_YIELD) return null;
  return { interestCents, meanBalanceCents, rate, rows: interest.map((t) => t.id), accounts, walks };
}

/** Spending in a usual month, the buffer's yardstick (median of complete months); null under three. */
export function usualSpend(a: AreaInput): number | null {
  const usual = bufferReport(a.ctx, a.balances, a.inputs).usualSpendCents;
  return usual !== null && usual > 0 ? usual : null;
}

/** What `cents` a charge comes to in a year of the series' own charges, as the price insight counts a rise. */
export function yearlyAt(s: RecurringSeries, cents: number): number {
  return priceChangeYearlyCents({ cadence: s.cadence, perMonth: s.perMonth, priceChange: { fromCents: 0, toCents: cents, date: s.lastDate } }) ?? 0;
}
