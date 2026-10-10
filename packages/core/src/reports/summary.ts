import { getCategory } from "../categories.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, inDays } from "../analysis/context.ts";
import { totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { daysInMonth } from "../dates.ts";
import type { IsoDate } from "../types.ts";

export interface SummaryCategory {
  category: string;
  label: string;
  cents: number;
}

export interface SummaryChange extends SummaryCategory {
  previousCents: number;
}

export interface SummaryReport {
  /** The same period a year earlier is covered by the history: `changes` is filled only then. */
  comparable: boolean;
  incomeCents: number;
  /** consumption + debt */
  spendingCents: number;
  savedCents: number;
  /** income − spending */
  netCents: number;
  /** The three largest spending categories. */
  topCategories: SummaryCategory[];
  /** The three biggest changes against the same period a year earlier. */
  changes: SummaryChange[];
}

/** The same calendar day a year earlier (29.2. → 28.2.). */
export function yearEarlier(date: IsoDate): IsoDate {
  const month = `${Number(date.slice(0, 4)) - 1}-${date.slice(5, 7)}`;
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

function spendByCategory(txs: readonly AnalysisTx[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) if (t.spend) out.set(t.category, (out.get(t.category) ?? 0) + t.spend);
  return out;
}

/** The period in a few numbers: totals, where most money went, and what changed from a year ago. */
export function summaryReport(ctx: AnalysisContext, range: DateRange): SummaryReport {
  const current = inDays(ctx, toDayRange(range));
  const totals = totalsOf(current.map((t) => t.flows));
  const now = spendByCategory(current);
  const topCategories = [...now.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, cents]) => ({ category, label: getCategory(category).label, cents }));

  const from = yearEarlier(range.from);
  const comparable = historyCovers(ctx, from);
  let changes: SummaryChange[] = [];
  if (comparable) {
    const before = spendByCategory(inDays(ctx, toDayRange({ from, to: yearEarlier(range.to) })));
    // "other" is what nothing recognised: its change says more about the rules than about spending
    changes = [...new Set([...now.keys(), ...before.keys()])]
      .filter((c) => c !== "other")
      .map((category) => ({ category, label: getCategory(category).label, cents: Math.max(0, now.get(category) ?? 0), previousCents: Math.max(0, before.get(category) ?? 0) }))
      .filter((c) => c.cents !== c.previousCents)
      .sort((a, b) => Math.abs(b.cents - b.previousCents) - Math.abs(a.cents - a.previousCents))
      .slice(0, 3);
  }
  return {
    comparable,
    incomeCents: totals.incomeCents,
    spendingCents: totals.expenseCents,
    savedCents: totals.savedCents,
    netCents: totals.netCents,
    topCategories,
    changes,
  };
}
