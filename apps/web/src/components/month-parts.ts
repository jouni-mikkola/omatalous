// Decision: where to move money to savings
import type { DashboardData } from "../types.ts";

type Totals = Pick<DashboardData["totals"], "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "leftCents">;

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
