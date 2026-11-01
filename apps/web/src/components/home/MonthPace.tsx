// Decision: is the month's spending on its expected course, or should the household slow down before payday
import { PaceChart } from "../../charts/PaceChart.tsx";
import type { DashboardData } from "../../types.ts";
import { Button } from "../ui/Button.tsx";
import { ChartWithTable } from "../table/selection.tsx";
import { CategoryGoals } from "./CategoryGoals.tsx";
import { SpendingGoalLine } from "./SpendingGoal.tsx";
import { PaceTable } from "./PaceTable.tsx";
import { monthTitle, paceGapText, paceHeadline, paceRangeText } from "./texts.ts";
import { t } from "../../text.ts";

/** The days the pace's figure covers: the month's first day to the last day it has a value for. Used by the door of the figure. */
export function paceRange(pace: DashboardData["pace"]): { from: string; to: string } {
  const day = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  return { from: `${pace.month}-01`, to: `${pace.month}-${String(Math.max(1, day)).padStart(2, "0")}` };
}

/**
 * Kuukausi: the heading says the difference from the expected month and what it is set against, the line
 * under it where the spending stands in the expected range. The chart and its table are the month's days
 * (`PaceChart`); the one monthly goal, when set, is a line on the chart and a sentence under it (`SpendingGoalLine`). The days and
 * categories the difference comes from are in Raportit, one link away (`reportHref`).
 */
export function MonthPace({ data, reportHref }: { data: DashboardData; reportHref: string }) {
  const { pace, ahead, goal, home } = data;
  const month = pace.month;
  const payday = ahead?.payday && ahead.payday.date.startsWith(month) ? Number(ahead.payday.date.slice(8, 10)) : null;
  const names = { current: monthTitle(month), previous: pace.previous ? t("home.last_month") : "" };
  const gap = paceGapText(home.paceGap);
  return (
    <section className="card home-pace" aria-labelledby="home-pace-h">
      <h2 id="home-pace-h">{t("home.how_month_goes")}</h2>
      {home.pace ? (
        <>
          <p className="home-verdict">{paceHeadline(home.pace)}</p>
          <p className="home-detail">{paceRangeText(home.pace)}</p>
        </>
      ) : (
        gap && <p className="home-detail">{gap}</p>
      )}
      <ChartWithTable chart={<PaceChart pace={pace} goal={goal?.cents ?? null} payday={payday} names={names} />} table={<PaceTable pace={pace} goal={goal?.cents ?? null} names={names} />} />
      <SpendingGoalLine goal={goal} />
      <CategoryGoals goals={data.categoryGoals} />
      <Button variant="link" href={reportHref}>
        {t("home.month_report")}
      </Button>
    </section>
  );
}
