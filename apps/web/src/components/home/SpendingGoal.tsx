// Decision: does the household slow down this month to keep to the spending goal it set, and by how much a day
import type { SpendingGoal as Goal } from "@banking/core";
import { money } from "../../format.ts";
import { estimateRange } from "../../charts/PaceChart.tsx";
import { Button } from "../ui/Button.tsx";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { t } from "../../text.ts";
/** The month's end as the goal's sentence says it: a range from the usual months, one figure on the last day. */
const endText = (end: NonNullable<Goal["end"]>) => (end.low === end.high ? money(end.low, false) : estimateRange(end.low, end.high));

/** Where the month stands against the goal, in sentences: what is left, how the month ends, and what a day may cost. */
export function goalAnswer(goal: Goal): string {
  const { cents, leftCents, end, perDayCents, state } = goal;
  if (state === "over") return t("home.goal_over", { goal: money(cents, false), over: money(-leftCents, false) });
  const left = t("home.goal_left", { goal: money(cents, false), left: money(leftCents, false) });
  const perDay = perDayCents === null ? "" : t("home.goal_per_day", { sum: money(perDayCents, false) });
  if (!end) return left + perDay;
  const ends = t("home.goal_ends", { end: endText(end) });
  if (state === "above") return t("home.goal_above", { left, ends, perDay });
  if (state === "near") return t("home.goal_near", { left, ends, perDay });
  return t("home.goal_within", { left, ends, perDay });
}

/** Under the chart of Menot tässä kuussa: the goal's sentence and the way to change it. The goal is set in Asetukset > Talous; with none set the chart shows nothing of it. */
export function SpendingGoalLine({ goal }: { goal: Goal | null }) {
  if (!goal) return null;
  return (
    <div className="pace-goal">
      <div className="form-row">
        <p className="pace-goal-answer">{goalAnswer(goal)}</p>
        <Button href={settingsCardHash(SETTINGS_ANCHOR.goal)}>{t("home.goal_change")}</Button>
      </div>
    </div>
  );
}
