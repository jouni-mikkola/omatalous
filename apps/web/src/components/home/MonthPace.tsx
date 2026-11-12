// Decision: is the month's spending on its usual course, or should the household slow down before payday
import { PaceChart } from "../../charts/PaceChart.tsx";
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { rich, t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { ChartWithTable } from "../table/selection.tsx";
import { Button } from "../ui/Button.tsx";
import { reportHref } from "./Answer.tsx";
import { PaceTable } from "./PaceTable.tsx";
import { euroRange, monthTitle, paceGapText } from "./texts.ts";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

/**
 * Kuukausi: one sentence that says which side of the usual the spending is on, with the usual sum and its range, then
 * the chart of the month's days and the same days as a table. The chart has one comparison: the usual band when the
 * household has one, else last month's line, so a household without a usual level still sees the month against something.
 * The spent sum opens the month's rows, and the days and categories behind the difference are one link away.
 */
export function MonthPace({ data }: { data: Data }) {
  const { nyt, ahead, home } = data;
  const usual = home.pace;
  // one comparison on the chart: with the band drawn, last month's line would be a fourth series over the one that matters
  const pace = usual ? { ...data.pace, previous: null } : data.pace;
  const payday = ahead?.payday && ahead.payday.date.startsWith(pace.month) ? Number(ahead.payday.date.slice(8, 10)) : null;
  const names = { current: monthTitle(pace.month), previous: pace.previous ? t("home.last_month") : "" };
  const spentHref = hashOf({ page: "transactions", params: new URLSearchParams({ from: `${pace.month}-01`, to: nyt.from }) });
  const spent = (cents: number) => <Button variant="link" href={spentHref}>{answerMoney(cents)}</Button>;
  const gap = usual ? null : paceGapText(home.paceGap);
  return (
    <section className="card home-pace" aria-labelledby="home-pace-h">
      <h2 id="home-pace-h">{t("home.how_month_goes")}</h2>
      <p className="home-detail home-pace-line">
        {usual
          ? rich(
              usual.position === "within" ? "home.nyt_pace_within" : usual.position === "above" ? "home.nyt_pace_above" : "home.nyt_pace_below",
              { diff: answerMoney(Math.abs(usual.diffCents)), usual: answerMoney(usual.expectedCents), range: euroRange(usual.lowCents, usual.highCents) },
              { sum: spent(usual.spentCents) },
            )
          : rich("home.nyt_spent", {}, { sum: spent(nyt.pace.spentCents) })}
      </p>
      {/* its own line: after the sum it read as one sentence with no stop */}
      {gap && <p className="home-detail home-pace-gap">{gap}</p>}
      <ChartWithTable chart={<PaceChart pace={pace} goal={null} payday={payday} names={names} />} table={<PaceTable pace={pace} names={names} />} />
      <p className="home-more">
        <Button variant="link" href={reportHref()}>{t("home.month_report")}</Button>
      </p>
    </section>
  );
}
