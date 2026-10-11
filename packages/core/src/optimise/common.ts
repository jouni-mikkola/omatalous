/**
 * Helpers every Optimoi area uses, so the rules of the plan hold in one place: the year window of complete months,
 * accounts that existed before a window, the level without one-offs, the yearly figure, certainty from weaknesses and
 * the evidence checks behind them.
 */
import { type AnalysisContext, type AnalysisTx, historyCovers } from "../analysis/context.ts";
import { dataQualityReport, type QualitySignal } from "../analysis/data-quality.ts";
import { ITEM_GATE_MONTHLY_CENTS } from "../analysis/insights/shared.ts";
import type { DateRange } from "../analysis/period.ts";
import { completeMonthsBefore } from "../analysis/usual.ts";
import { addMonths, daysInMonth, monthOf } from "../dates.ts";
import { median } from "../stats.ts";
import type { BalanceInput, IsoDate } from "../types.ts";
import { AREA_IDS, type AreaId, type Certainty, type CertaintyLevel, type EvidenceQuality, type Weakness, type WeaknessId } from "./types.ts";

/** Rule 3: the insights' item gate over a year, 120 €. An area adds its own gate on top. */
export const GATE_YEARLY_CENTS = 12 * ITEM_GATE_MONTHLY_CENTS;

/** At most this many evidence rows per finding (rule 4). */
export const MAX_ROWS = 60;

/** A row over this many times its merchant's median leaves the level (rule 4). */
const ONE_OFF_FACTOR = 3;

/** Rule 6: what a finding weighs in the order of areas. The euros shown stay mid. */
export const CERTAINTY_WEIGHT: Readonly<Record<CertaintyLevel, number>> = { korkea: 1, keskitaso: 0.6, matala: 0.25 };

/** The same day `n` months later, clamped to the month's length (31.1. + 1 is 28.2.). */
export function addMonthsToDate(date: IsoDate, n: number): IsoDate {
  const month = addMonths(monthOf(date), n);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), daysInMonth(month))).padStart(2, "0")}`;
}

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
 * Accounts whose first row is on or before `from` (with the history's own slack of a few days). A window counts only
 * these, so an account connected inside it never reads as a rise (rule 4).
 */
export function accountsBefore(ctx: AnalysisContext, from: IsoDate): ReadonlySet<string> {
  const first = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (!first.has(t.accountId)) first.set(t.accountId, t.bookingDate);
  return new Set([...first].filter(([, date]) => historyCovers({ dataFrom: date }, from)).map(([id]) => id));
}

/** What a row cost in the end: consumption and debt service less what came back, never below zero. Transfers cost nothing. */
export function netCost(t: Pick<AnalysisTx, "spend" | "refunded" | "isTransfer">): number {
  return t.isTransfer ? 0 : Math.max(0, t.spend - t.refunded);
}

export interface Level {
  /** Mean cents a month over the months, one-offs out. */
  monthly: number;
  /** Cents per month, aligned with the months given. */
  byMonth: number[];
  /** Ids of the rows over three times their merchant's median, left out of the level. */
  struck: string[];
}

/**
 * The monthly level of `rows` over `months`, with a row over three times its merchant's median taken out and listed
 * struck. Purchases count `netCost`, so a full refund removes a purchase; transfers never count.
 */
export function levelWithoutOneOffs(rows: readonly AnalysisTx[], months: readonly string[]): Level {
  const inWindow = new Set(months);
  const counted = rows.filter((t) => !t.isTransfer && inWindow.has(monthOf(t.bookingDate)));
  const amounts = new Map<string, number[]>();
  for (const t of counted) {
    const list = amounts.get(t.merchant);
    if (list) list.push(netCost(t));
    else amounts.set(t.merchant, [netCost(t)]);
  }
  const medians = new Map([...amounts].map(([m, xs]) => [m, median(xs)]));
  const struck = new Set(counted.filter((t) => medians.get(t.merchant)! > 0 && netCost(t) > ONE_OFF_FACTOR * medians.get(t.merchant)!).map((t) => t.id));
  const at = new Map(months.map((m, i) => [m, i]));
  const byMonth = months.map(() => 0);
  for (const t of counted) if (!struck.has(t.id)) byMonth[at.get(monthOf(t.bookingDate))!]! += netCost(t);
  const monthly = months.length ? Math.round(byMonth.reduce((s, x) => s + x, 0) / months.length) : 0;
  return { monthly, byMonth, struck: [...struck] };
}

/** Rule 7 weakness for a yearly figure from fewer than 12 months. */
export function shortHistoryWeakness(months: number): Weakness {
  return { id: "short_history", reason: `Vuosiluku on laskettu ${months} kuukauden tiedoista.` };
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

/** Rule 7: korkea, one step keskitaso, two steps matala, three or more hidden (null). */
export function certaintyOf(weaknesses: readonly Weakness[]): Certainty | null {
  const sorted = sortWeaknesses(weaknesses);
  const level = (["korkea", "keskitaso", "matala"] as const)[sorted.length];
  return level ? { level, reason: sorted[0]?.reason ?? NO_WEAKNESS } : null;
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

const ACCOUNT_REASON: Record<"gap" | "stale" | "own_unconnected", (name: string) => string> = {
  gap: (name) => `Tilin ${name} tiedoissa on tauko.`,
  stale: (name) => `Tilin ${name} uusimpia tapahtumia ei ole haettu.`,
  own_unconnected: (name) => `Tililtä ${name} siirretään rahaa tilille, jota ei ole yhdistetty.`,
};

/**
 * Rule 7 weaknesses of the evidence: a gap, stale or own_unconnected signal on an account the rows are on (one step
 * per kind), over 5 % of spending uncategorised, over 30 % of the rows categorised by default or industry. Nothing
 * for a finding without rows.
 */
export function evidenceWeakness(ctx: AnalysisContext, rows: readonly string[], quality: EvidenceQuality): Weakness[] {
  const byId = rowsById(ctx);
  const txs = rows.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t);
  if (!txs.length) return [];
  const out: Weakness[] = [];
  const accounts = [...new Set(txs.map((t) => t.accountId))];
  for (const kind of ["gap", "stale", "own_unconnected"] as const) {
    const hit = accounts.find((id) => quality.byAccount[id]?.includes(kind));
    if (hit) out.push({ id: kind, reason: ACCOUNT_REASON[kind](ctx.accounts.find((a) => a.id === hit)?.name ?? hit) });
  }
  const uncategorised = quality.signals.find((s) => s.id === "uncategorised");
  if (uncategorised) out.push({ id: "uncategorised", reason: `${uncategorised.title}.` });
  const uncertain = txs.filter((t) => t.categorySource === "default" || t.categorySource === "industry").length / txs.length;
  if (uncertain > UNCERTAIN_ROW_SHARE) {
    out.push({ id: "uncertain_rows", reason: `${Math.round(uncertain * 100)}\u00a0% laskelman tapahtumista on luokiteltu toimialan mukaan tai oletuksena.` });
  }
  return out;
}

const NUMBER = /\d{1,2}\.\d{1,2}\.(?:\d{4})?|[\u2212-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|[\u2212-]?\d+(?:,\d+)?/g;

/**
 * The numbers of a Finnish text as written: "1 234,56", "12", "12.3.2026", "−5". Group spaces become plain spaces.
 * Rule 5's test reads every number of a title from its calc lines with this.
 */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/[\u00a0\u202f]/g, " ").replace(/^-/, "\u2212"));
}
