// Decision: is the change in spending a reason to act, and where
import { type BucketKind, bucketLabel, type ChangeView, namedCauses, type SpendingChange, spendingChange } from "../analysis/change.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { changeMonths, cutWords, signed, spanLabel, upper } from "../analysis/change-text.ts";
import { formatEur, monthName } from "../analysis/format.ts";
import type { DateRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addMonths, monthIndex, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";

/** One bar of the bridge: a cause in a category, or the causes that stay under the gate together. */
export interface ChangeBar {
  category: string | null;
  label: string;
  kind: BucketKind | "rest";
  cents: number;
  /** The same month a year ago moved as far: the usual view calls it a season. */
  season: boolean;
  /** "kalliimpi ostoskerta, useammin"; empty for the rest bar, "Muut muutokset". */
  cause: string;
}

export interface ChangeViewReport {
  view: ChangeView;
  title: string;
  /** "Lokakuu on 640 € tavallista kalliimpi: Ruoka +150 € (kalliimpi ostoskerta), ..." */
  sentence: string;
  /** The sentence only states the totals: no change stands out from the household's own noise (change-signal.ts). */
  quiet: boolean;
  periodLabel: string;
  baseLabel: string;
  /** At most five, largest first, `rest` last; they add up to the change. None when no category stands out. */
  bars: ChangeBar[];
  change: SpendingChange;
}

export interface SpendingChangeReport {
  views: ChangeViewReport[];
}

const MAX_BARS = 5;
/** The rest bar: not "Muut", the table's row of small categories, which has a change of its own. */
const REST_LABEL = "Muut muutokset";

/**
 * The four categories that moved most with a cause over the gate, then what is left together, so the bars add up to
 * the change. Without such a category there are no bars: the rest alone is the change the table already totals. A bar is the category's whole change, as in the table below it, and names its causes over the gate; the
 * pieces under it stay in the bar without a name. A category whose net change is under the gate is left out (a renamed
 * shop is a new and a stopped shop of the same size), and so is one whose change does not stand out from its own
 * month-to-month noise: a busy month of the household's own is no cause.
 */
function barsOf(c: SpendingChange): ChangeBar[] {
  const top = c.categories
    .flatMap((r) => {
      // the rows the spike alert may tell as well (ADR 0013)
      const named = namedCauses(c, r);
      return named.length ? [{ r, named }] : [];
    })
    .sort((a, b) => Math.abs(b.r.changeCents) - Math.abs(a.r.changeCents) || a.r.category!.localeCompare(b.r.category!))
    .slice(0, MAX_BARS - 1);
  const bars: ChangeBar[] = top.map(({ r, named }) => ({
    category: r.category,
    label: r.label,
    kind: named[0]!.kind,
    cents: r.changeCents,
    season: r.season,
    cause: named.map((b) => bucketLabel(b.kind, b.cents, r.bills).toLowerCase()).join(", "),
  }));
  // without a named bar the rest would be the whole change under a name the table gives its small categories
  if (!bars.length) return [];
  const rest = c.changeCents - bars.reduce((s, b) => s + b.cents, 0);
  if (rest !== 0) bars.push({ category: null, label: REST_LABEL, kind: "rest", cents: rest, season: false, cause: "" });
  return bars;
}

/** Whether the sentence calls the period dearer or cheaper: the total passes the gate and stands out from its noise. */
const callsTotal = (c: SpendingChange) => c.standsOut && Math.abs(c.changeCents) >= c.gateCents;

/** The sentence states the totals only: no total and no category change stands out. */
const isQuiet = (c: SpendingChange, bars: readonly ChangeBar[]) => !callsTotal(c) && !bars.some((b) => b.kind !== "rest");

function sentenceOf(c: SpendingChange, subject: string, baseLabel: string, bars: readonly ChangeBar[], today: IsoDate): string {
  const abs = formatEur(Math.abs(c.changeCents), false);
  const up = c.changeCents > 0;
  // a running month says the day its figures are cut at when the rows end before today, as the spike alert does
  const upTo = cutWords(c.running, c.target.to, today) ?? (c.running ? "tähän asti" : null);
  let lead: string;
  if (!callsTotal(c)) lead = `${subject}: menot ${formatEur(c.nowCents, false)}, ${c.view === "usual" ? "tavallisesti" : baseLabel} ${formatEur(c.baseCents, false)}`;
  else if (c.view === "usual") lead = `${subject}: menot ${upTo ? `${upTo} ` : ""}${abs} tavallista ${up ? "suuremmat" : "pienemmät"}`;
  else lead = `${subject}: menot ${abs} ${up ? "suuremmat" : "pienemmät"} kuin ${baseLabel}`;
  if (isQuiet(c, bars) || !bars.length) return `${lead}.`;
  const parts = bars.map((b) => (b.kind === "rest" ? `${REST_LABEL.toLowerCase()} ${signed(b.cents)}` :`${b.label} ${signed(b.cents)}${b.cause ? ` (${b.cause}${b.season ? ", sama kuukausi vuotta aiemmin" : ""})` : ""}`));
  return `${lead}. ${upper(parts.join(", "))}.`;
}


/** One view of the change as the report tells it; null when the history does not support the comparison. */
function viewOf(ctx: AnalysisContext, view: ChangeView, m: string, title: string, yearMonths?: number): ChangeViewReport | null {
  const change = spendingChange(ctx, view, m, yearMonths);
  if (!change) return null;
  const periodLabel = view === "usual" ? upper(monthName(m)) : upper(spanLabel(change.target.months));
  const baseLabel = view === "usual" ? "tavallisesti" : spanLabel(change.base.months);
  const bars = barsOf(change);
  const sentence = sentenceOf(change, view === "season" ? `${upper(monthName(m))} ${m.slice(0, 4)}` : periodLabel, baseLabel, bars, ctx.today);
  return { view, title, sentence, quiet: isQuiet(change, bars), periodLabel, baseLabel, bars, change };
}

/**
 * The complete months of the range (at most twelve) against the same months a year earlier, in causes: what Raportit
 * answers for the range of its period bar. null when the history has no year for it.
 */
export function rangeChangeReport(ctx: AnalysisContext, range: DateRange): ChangeViewReport | null {
  const { lastComplete } = changeMonths(ctx, range);
  // the rows of a bank may stop inside the last month: the change planner then does not count it as complete, the month before is the last
  for (const m of [lastComplete, addMonths(lastComplete, -1)]) {
    const inRange = monthIndex(m) - monthIndex(monthOf(range.from)) + 1;
    const view = inRange < 1 ? null : viewOf(ctx, "year", m, "Vuosi vuodelta", Math.min(12, inRange));
    if (view) return view;
  }
  return null;
}

/**
 * Why spending changed, in the views the history supports: the month against its usual level, the last months against
 * the same months a year earlier, and the month against the same month a year ago.
 */
export function spendingChangeReport(ctx: AnalysisContext, range: DateRange): SpendingChangeReport {
  const { month, lastComplete } = changeMonths(ctx, range);
  const specs: [ChangeView, string, string][] = [
    ["usual", month, "Tavallisesti"],
    ["year", lastComplete, "Vuosi vuodelta"],
    ["season", month, "Sama kuukausi vuotta aiemmin"],
  ];
  const views = specs.flatMap(([view, m, title]) => viewOf(ctx, view, m, title) ?? []);
  return { views };
}
