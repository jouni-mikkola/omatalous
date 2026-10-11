// Decision: find why a category rose and cap it
import { getCategory } from "../categories.ts";
import { type AnalysisContext, historyCovers } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { formatEur } from "../analysis/format.ts";
import { fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";
import { median } from "../stats.ts";

/** Months that must all be above the usual level: one month is a spike, three is a new level. */
const RECENT_MONTHS = 3;
/** The usual level is the median of up to this many complete months before the recent ones. */
const BASE_MONTHS = 12;
/** Fewer base months say too little about a usual level. */
const MIN_BASE_MONTHS = 6;
const MIN_RISE = 1.15;
/** A category with a usual month of a few euros has nothing to drift from. */
const MIN_BASE_CENTS = 2000;
const MIN_EXTRA_CENTS = 4000;
const MAX_ITEMS = 4;

/** Money handled, not spending that a household steers. */
const SKIPPED = new Set(["other", "card_bill", "p2p", "cash", "taxes"]);

export interface DriftItem {
  category: string;
  label: string;
  /** The recent months, oldest first. */
  months: string[];
  monthlyCents: number[];
  /** The middle one of the recent months. */
  recentCents: number;
  /** Median month before them. */
  usualCents: number;
  /** What the new level adds to a year. */
  extraYearlyCents: number;
  /** The recent months as a share above the usual level. */
  rise: number;
}

export interface DriftReport {
  /** The months that were judged; empty when the history is too short. */
  months: string[];
  items: DriftItem[];
  advice: string;
  /** Categories that were compared with their own level: big enough to have one. */
  checked: number;
  /** The smallest usual month, in cents, that a category needs to be compared. */
  minLevelCents: number;
  /** Complete months of history the check needs: the recent ones and the months it compares them with. */
  neededMonths: number;
  /** The first day from which a range can be judged: nine complete months of history. Null without history. */
  readyFrom: string | null;
}

/** The first day after the last of the `neededMonths` complete months the history holds. */
function readyFrom(ctx: AnalysisContext): string | null {
  if (!ctx.dataFrom) return null;
  const month = monthIndex(ctx.dataFrom);
  // a history that starts after the 3rd covers its first month only in part
  const first = historyCovers(ctx, `${fromMonthIndex(month)}-01`) ? month : month + 1;
  return `${fromMonthIndex(first + MIN_BASE_MONTHS + RECENT_MONTHS)}-01`;
}

/**
 * The last whole month at the end of the range: the range's own last month
 * when it ends on the month's last day and is over, else the one before.
 */
function lastWholeMonth(ctx: AnalysisContext, range: DateRange): number {
  const month = range.to.slice(0, 7);
  const end = monthEnd(month);
  return monthIndex(month) - (range.to >= end && end < ctx.today ? 0 : 1);
}

/**
 * Categories that have stayed above their own level for three months in a
 * row. A single dear month is a spike and the alerts tell about it; this
 * is the quieter rise that becomes the new normal. Judged at the end of the
 * range, so a past period reads as it was then. Without nine months of
 * history it judges nothing and says from when it can (`readyFrom`).
 */
export function driftReport(ctx: AnalysisContext, range: DateRange): DriftReport {
  const last = lastWholeMonth(ctx, range);
  const recent = Array.from({ length: RECENT_MONTHS }, (_, i) => last - RECENT_MONTHS + 1 + i);
  const base: number[] = [];
  for (let m = recent[0]! - BASE_MONTHS; m < recent[0]!; m++) if (historyCovers(ctx, `${fromMonthIndex(m)}-01`)) base.push(m);
  const frame = { minLevelCents: MIN_BASE_CENTS, neededMonths: MIN_BASE_MONTHS + RECENT_MONTHS, readyFrom: readyFrom(ctx) };
  if (base.length < MIN_BASE_MONTHS || !historyCovers(ctx, `${fromMonthIndex(recent[0]!)}-01`)) return { months: [], items: [], advice: "", checked: 0, ...frame };

  const first = base[0]!;
  const perCategory = new Map<string, { values: number[]; bills: number; all: number }>();
  for (const t of ctx.txs) {
    if (!t.spend || t.month < first - 12 || t.month > last) continue;
    let e = perCategory.get(t.category);
    if (!e) perCategory.set(t.category, (e = { values: new Array<number>(last - first + 13).fill(0), bills: 0, all: 0 }));
    e.values[t.month - (first - 12)]! += t.spend;
    if (t.month > last - RECENT_MONTHS) {
      e.all += t.spend;
      if (ctx.fixedIds.has(t.id)) e.bills += t.spend;
    }
  }

  const at = (values: readonly number[], m: number) => values[m - (first - 12)] ?? 0;
  const items: DriftItem[] = [];
  let checked = 0;
  for (const [category, e] of perCategory) {
    const c = getCategory(category);
    // mostly bills: a dearer bill is a price change, told on its own
    if (c.kind !== "expense" || SKIPPED.has(category) || e.bills >= 0.8 * e.all) continue;
    const baseValues = base.map((m) => at(e.values, m));
    const usual = median(baseValues);
    if (usual < MIN_BASE_CENTS) continue;
    checked += 1;
    const monthly = recent.map((m) => at(e.values, m));
    // the middle month, so one dear month among three does not carry the rise
    const level = median(monthly);
    if (level - usual < MIN_EXTRA_CENTS) continue;
    // all three months above the usual range, not one high and two ordinary
    const upper = [...baseValues].sort((a, b) => a - b)[Math.ceil(0.75 * baseValues.length) - 1]!;
    if (Math.min(...monthly) < Math.max(usual * MIN_RISE, upper)) continue;
    // the same months a year earlier were as dear: the season, not a new level
    const lastYear = recent.map((m) => (historyCovers(ctx, `${fromMonthIndex(m - 12)}-01`) ? at(e.values, m - 12) : null));
    if (lastYear.every((v) => v !== null) && median(lastYear as number[]) >= 0.9 * level) continue;
    items.push({
      category,
      label: c.label,
      months: recent.map(fromMonthIndex),
      monthlyCents: monthly,
      recentCents: Math.round(level),
      usualCents: Math.round(usual),
      extraYearlyCents: Math.round((level - usual) * 12),
      rise: level / usual - 1,
    });
  }
  items.sort((a, b) => b.extraYearlyCents - a.extraYearlyCents);
  const shown = items.slice(0, MAX_ITEMS);
  return { months: recent.map(fromMonthIndex), items: shown, advice: shown.length ? advice(shown) : "", checked, ...frame };
}

function advice(items: readonly DriftItem[]): string {
  const total = items.reduce((s, i) => s + i.extraYearlyCents, 0);
  const who = items.length === 1 ? `${items[0]!.label} on` : `${items.length} kategoriaa on`;
  // rounded to ten euros: the level is an estimate
  return `${who} ollut kolme kuukautta peräkkäin tavallista kalliimpi. Jos taso pysyy, se maksaa ${formatEur(Math.round(total / 1000) * 1000 || total, false)} vuodessa.`;
}
