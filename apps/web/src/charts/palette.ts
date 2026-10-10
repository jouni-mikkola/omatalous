import { REST_CATEGORY } from "@banking/core";

/**
 * Categories own colour slots 1–7 by their all-time spending (fixed order from
 * the server), so a category keeps its colour whatever period is selected.
 * Everything else folds into "Muut" in neutral gray.
 */
export function categoryColor(category: string, colorOrder: readonly string[]): string {
  if (category === REST_CATEGORY) return "var(--series-rest)";
  const i = colorOrder.indexOf(category);
  return i >= 0 && i < 7 ? `var(--series-${i + 1})` : "var(--series-rest)";
}
