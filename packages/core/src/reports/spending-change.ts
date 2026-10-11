// Decision: is the change in spending a reason to act, and where
import { type BucketKind, bucketLabel, type ChangeView, type SpendingChange, spendingChange } from "../analysis/change.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { changeMonths, monthName, signed, spanLabel, upper } from "../analysis/change-text.ts";
import { formatEur } from "../analysis/format.ts";
import type { DateRange } from "../analysis/period.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { addMonths, monthOf } from "../dates.ts";

/** One bar of the bridge: a cause in a category, or the causes that stay under the gate together. */
export interface ChangeBar {
  category: string | null;
  label: string;
  kind: BucketKind | "rest";
  cents: number;
  /** The same month a year ago moved as far: the usual view calls it a season. */
  season: boolean;
  /** "Kalliimpi ostoskerta", "Muut". */
  cause: string;
}

export interface ChangeViewReport {
  view: ChangeView;
  title: string;
  /** "Lokakuu on 640 € tavallista kalliimpi: Ruoka +150 € (kalliimpi ostoskerta), ..." */
  sentence: string;
  periodLabel: string;
  baseLabel: string;
  /** At most five, largest first, `rest` last; they add up to the change. */
  bars: ChangeBar[];
  change: SpendingChange;
}

export interface SpendingChangeReport {
  views: ChangeViewReport[];
}

const MAX_BARS = 5;

/**
 * The four categories that moved most with a cause over the gate, then what is left together, so the bars add up to
 * the change. A bar is the category's whole change, as in the table below it, and names its causes over the gate; the
 * pieces under it stay in the bar without a name. A category whose net change is under the gate is left out (a renamed
 * shop is a new and a stopped shop of the same size), and the gap to the usual level is no cause.
 */
function barsOf(c: SpendingChange): ChangeBar[] {
  const top = c.categories
    .flatMap((r) => {
      const named = r.buckets.filter((b) => b.kind !== "spread");
      return r.kind === "category" && r.category !== null && named.length && Math.abs(r.changeCents) >= c.gateCents ? [{ r, named }] : [];
    })
    .sort((a, b) => Math.abs(b.r.changeCents) - Math.abs(a.r.changeCents) || a.r.category!.localeCompare(b.r.category!))
    .slice(0, MAX_BARS - 1);
  const bars: ChangeBar[] = top.map(({ r, named }) => ({
    category: r.category,
    label: r.label,
    kind: named[0]!.kind,
    cents: r.changeCents,
    season: r.season,
    cause: named.map((b) => bucketLabel(b.kind, b.cents).toLowerCase()).join(", "),
  }));
  const rest = c.changeCents - bars.reduce((s, b) => s + b.cents, 0);
  if (rest !== 0) bars.push({ category: null, label: "Muut", kind: "rest", cents: rest, season: false, cause: "" });
  return bars;
}

function sentenceOf(c: SpendingChange, subject: string, baseLabel: string, bars: readonly ChangeBar[]): string {
  const abs = formatEur(Math.abs(c.changeCents), false);
  const up = c.changeCents > 0;
  const quiet = Math.abs(c.changeCents) < c.gateCents;
  let lead: string;
  if (quiet) lead = `${subject}: menot ${formatEur(c.nowCents, false)}, ${c.view === "usual" ? "tavallisesti" : baseLabel} ${formatEur(c.baseCents, false)}`;
  else if (c.view === "usual") lead = `${subject} on ${c.running ? "tähän asti " : ""}${abs} tavallista ${up ? "kalliimpi" : "halvempi"}`;
  else lead = `${subject}: menot ${abs} ${up ? "suuremmat" : "pienemmät"} kuin ${baseLabel}`;
  if (quiet) return `${lead}.`;
  const parts = bars.map((b) => (b.kind === "rest" ? `muut ${signed(b.cents)}` : `${b.label} ${signed(b.cents)}${b.cause ? ` (${b.cause}${b.season ? ", sama kuukausi vuotta aiemmin" : ""})` : ""}`));
  return `${lead}: ${parts.join(", ")}.`;
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
  const views: ChangeViewReport[] = [];
  for (const [view, m, title] of specs) {
    const change = spendingChange(ctx, view, m);
    if (!change) continue;
    const periodLabel = view === "usual" ? upper(monthName(m)) : upper(spanLabel(change.target.months));
    const baseLabel = view === "usual" ? "tavallisesti" : spanLabel(change.base.months);
    const bars = barsOf(change);
    views.push({ view, title, sentence: sentenceOf(change, view === "season" ? `${upper(monthName(m))} ${m.slice(0, 4)}` : periodLabel, baseLabel, bars), periodLabel, baseLabel, bars, change });
  }
  return { views };
}
