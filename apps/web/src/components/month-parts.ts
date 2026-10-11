// Decision: is this month a reason to worry, and where to move money to savings
import { GAP_HELP, REST_CATEGORY } from "@banking/core";
import type { DashboardData } from "../types.ts";

type Trend = DashboardData["trend"];
type Totals = Pick<DashboardData["totals"], "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "leftCents">;

/** One line of the month breakdown: what the explanation says, or the plain categories while there is no usual level. */
export interface BreakdownRow {
  key: string;
  /** null for the two rows that are no single category. */
  category: string | null;
  label: string;
  now: number;
  usual: number | null;
  change: number | null;
  cause: string | null;
}

/**
 * The rows of the table under the monthly chart. The usual column is the explanation's own figures, a negative one
 * included, so the column adds up to the total row.
 */
export function breakdownRows(trend: Trend, active: number): BreakdownRow[] {
  const explanation = trend.explanations[active] ?? null;
  if (explanation) {
    return explanation.rows.map((r) => ({ key: r.category ?? r.kind, category: r.category, label: r.label, now: r.nowCents, usual: r.usualCents, change: r.changeCents, cause: r.kind === "between" ? GAP_HELP : (r.cause?.text ?? null) }));
  }
  return trend.series
    .filter((s) => (s.values[active] ?? 0) > 0)
    .map((s) => ({ key: s.category, category: s.category === REST_CATEGORY ? null : s.category, label: s.label, now: s.values[active] ?? 0, usual: null, change: null, cause: null }));
}

export interface BridgePart {
  key: "consumption" | "debt" | "saved" | "left";
  label: string;
  cents: number;
  color: string;
}

/**
 * The parts of the surplus bridge in their fixed order. Each has a colour of its own, none the colour of the income
 * in the chart under it (series 1), since what stayed is a share of the income and not the income itself.
 */
export function bridgeParts(totals: Totals): BridgePart[] {
  const over = totals.leftCents < 0;
  return [
    { key: "consumption", label: "Kulutus", cents: totals.consumptionCents, color: "var(--series-2)" },
    { key: "debt", label: "Velanhoito", cents: totals.debtCents, color: "var(--series-7)" },
    // money taken out of savings is no part of how the income was used: it shows in the remainder
    { key: "saved", label: "Säästöön", cents: Math.max(0, totals.savedCents), color: "var(--series-3)" },
    { key: "left", label: "Yli jäi", cents: over ? 0 : totals.leftCents, color: "var(--series-5)" },
  ];
}

/** The income the bridge's sentence names: the figure its change against the usual income is told from. */
export interface BridgeIncome {
  label: "Tulot" | "Ansiotulot";
  cents: number;
  /** Tavalliset tulot to compare with; null when the month has none. */
  usualCents: number | null;
}

/**
 * Usual income is earned income (ADR 0004), so the month is told by its earned income too. While that equals the bar's
 * Tulot the sentence says Tulot; a month with money from people or refunds names the smaller figure Ansiotulot, the
 * income report's word, so one label never carries two sums on the card.
 */
export function bridgeIncome(b: DashboardData["bridge"]): BridgeIncome {
  const earned = b.earnedIncomeCents;
  if (earned === null) return { label: "Tulot", cents: b.totals.incomeCents, usualCents: null };
  return { label: earned === b.totals.incomeCents ? "Tulot" : "Ansiotulot", cents: earned, usualCents: b.usualIncomeCents };
}
