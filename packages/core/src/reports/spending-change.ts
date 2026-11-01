// Decision: is the change in spending a reason to act, and where
import { type BucketKind, bucketLabel, type CategoryChange, type ChangeView, type MerchantChange, namedCauses, restLabel, type SpendingChange, spendingChange } from "../analysis/change.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { changeMonths, cutWords, signed, spanLabel, upper } from "../analysis/change-text.ts";
import { formatEur, monthNameIn } from "../analysis/format.ts";
import type { DateRange } from "../analysis/period.ts";
import { getCategory } from "../categories.ts";
import { categoryLabel } from "../category-names.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import type { IsoDate } from "../types.ts";

/** One bar of the bridge: a cause in a category, or the causes that stay under the gate together. */
interface ChangeBar {
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
const restBarLabel = (lang: Language) => messageIn(lang, "rep.rest_changes");

/**
 * The four categories that moved most with a cause over the gate, then what is left together, so the bars add up to
 * the change. Without such a category there are no bars: the rest alone is the change the table already totals. A bar is the category's whole change, as in the table below it, and names its causes over the gate; the
 * pieces under it stay in the bar without a name. A category whose net change is under the gate is left out (a renamed
 * shop is a new and a stopped shop of the same size), and so is one whose change does not stand out from its own
 * month-to-month noise: a busy month of the household's own is no cause.
 */
function barsOf(c: SpendingChange, lang: Language): ChangeBar[] {
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
    cause: named.map((b) => bucketLabel(b.kind, b.cents, r.bills, lang).toLowerCase()).join(", "),
  }));
  // without a named bar the rest would be the whole change under a name the table gives its small categories
  if (!bars.length) return [];
  const rest = c.changeCents - bars.reduce((s, b) => s + b.cents, 0);
  if (rest !== 0) bars.push({ category: null, label: restBarLabel(lang), kind: "rest", cents: rest, season: false, cause: "" });
  return bars;
}

/** Whether the sentence calls the period dearer or cheaper: the total passes the gate and stands out from its noise. */
const callsTotal = (c: SpendingChange) => c.standsOut && Math.abs(c.changeCents) >= c.gateCents;

/** The sentence states the totals only: no total and no category change stands out. */
const isQuiet = (c: SpendingChange, bars: readonly ChangeBar[]) => !callsTotal(c) && !bars.some((b) => b.kind !== "rest");

function sentenceOf(c: SpendingChange, subject: string, baseLabel: string, bars: readonly ChangeBar[], today: IsoDate, lang: Language): string {
  const abs = formatEur(Math.abs(c.changeCents), false, lang);
  const up = c.changeCents > 0;
  // a running month says the day its figures are cut at when the rows end before today, as the spike alert does
  const upTo = cutWords(c.running, c.target.to, today, lang) ?? (c.running ? messageIn(lang, "rep.change_so_far") : null);
  const average = messageIn(lang, "rep.change_average", { count: c.base.months.length });
  let lead: string;
  if (!callsTotal(c)) lead = messageIn(lang, "rep.change_quiet", { subject, now: formatEur(c.nowCents, false, lang), base: baseLabel, baseSum: formatEur(c.baseCents, false, lang), average: c.view === "expected" ? ` (${average})` : "" });
  else if (c.view === "expected") lead = messageIn(lang, up ? "rep.change_expected_up" : "rep.change_expected_down", { subject, upTo: upTo ? `${upTo} ` : "", amount: abs, average });
  else lead = messageIn(lang, up ? "rep.change_other_up" : "rep.change_other_down", { subject, amount: abs, base: baseLabel });
  if (isQuiet(c, bars) || !bars.length) return `${lead}.`;
  const parts = bars.map((b) => (b.kind === "rest" ? `${restBarLabel(lang).toLowerCase()} ${signed(b.cents, lang)}` : `${b.label} ${signed(b.cents, lang)}${b.cause ? ` (${b.cause}${b.season ? `, ${messageIn(lang, "rep.change_season")}` : ""})` : ""}`));
  return `${lead}. ${upper(parts.join(", "))}.`;
}


/** The labels of the change the analysis writes in Finnish (a category's name, the row of the small ones, the spread), in `lang`. */
function inLanguage(c: SpendingChange, lang: Language): SpendingChange {
  // the count of the small ones is only in the Finnish label: "Muut (3)"
  const rest = (label: string) => restLabel(Number(/\((\d+)\)$/.exec(label)?.[1] ?? 0), lang);
  const merchant = (m: MerchantChange): MerchantChange => (m.kind === "smaller" ? { ...m, label: rest(m.label) } : m.kind === "spread" ? { ...m, label: bucketLabel("spread", m.changeCents, false, lang) } : m);
  const category = (r: CategoryChange): CategoryChange => ({
    ...r,
    label: r.kind === "smaller" ? rest(r.label) : categoryLabel(getCategory(r.category!), lang),
    merchants: r.merchants.map(merchant),
  });
  return { ...c, categories: c.categories.map(category) };
}

/** One view of the change as the report tells it; null when the history does not support the comparison. */
function viewOf(ctx: AnalysisContext, view: ChangeView, m: string, title: string, lang: Language, yearMonths?: number): ChangeViewReport | null {
  const found = spendingChange(ctx, view, m, yearMonths);
  if (!found) return null;
  const change = lang === DEFAULT_LANGUAGE ? found : inLanguage(found, lang);
  const periodLabel = view === "expected" ? upper(monthNameIn(m, lang)) : upper(spanLabel(change.target.months, lang));
  const baseLabel = view === "expected" ? messageIn(lang, "rep.change_expected_word") : spanLabel(change.base.months, lang);
  const bars = barsOf(change, lang);
  const sentence = sentenceOf(change, view === "season" ? `${upper(monthNameIn(m, lang))} ${m.slice(0, 4)}` : periodLabel, baseLabel, bars, ctx.today, lang);
  return { view, title, sentence, quiet: isQuiet(change, bars), periodLabel, baseLabel, bars, change };
}

/**
 * Why spending changed, in the views the history supports: the month against its expected figure, the last months against
 * the same months a year earlier, and the month against the same month a year ago.
 */
export function spendingChangeReport(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): SpendingChangeReport {
  const { month, lastComplete } = changeMonths(ctx, range);
  const specs: [ChangeView, string, string][] = [
    ["expected", month, messageIn(lang, "rep.expected")],
    ["year", lastComplete, messageIn(lang, "rep.change_year")],
    ["season", month, messageIn(lang, "rep.change_season_title")],
  ];
  const views = specs.flatMap(([view, m, title]) => viewOf(ctx, view, m, title, lang) ?? []);
  return { views };
}
