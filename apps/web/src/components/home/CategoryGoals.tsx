// Decision: which category has used up its goal for the month, read beside the pace of the whole month
import type { CategoryGoalPace } from "@banking/core";
import { money } from "../../format.ts";
import { t } from "../../text.ts";

/** The category's goal in a sentence: what is spent of it and what is left, or by how much it is over. */
export function categoryGoalText(g: CategoryGoalPace): string {
  const spent = `${money(g.spentCents, false)} / ${money(g.cents, false)}`;
  return g.leftCents < 0 ? t("home.category_over", { label: g.label, spent, over: money(-g.leftCents, false) }) : t("home.category_left", { label: g.label, spent, left: money(g.leftCents, false) });
}

/** Under the pace chart: the goals set per category against the month so far. Nothing when none is set; they are set in Raportit, Rahankäyttö. */
export function CategoryGoals({ goals }: { goals: readonly CategoryGoalPace[] }) {
  if (goals.length === 0) return null;
  return (
    <ul className="pace-category-goals">
      {goals.map((g) => (
        <li key={g.category} data-over={g.leftCents < 0 || undefined}>
          {categoryGoalText(g)}
        </li>
      ))}
    </ul>
  );
}
