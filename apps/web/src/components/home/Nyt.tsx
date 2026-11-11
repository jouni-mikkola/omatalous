// Decision: how much can we still spend before payday, and is the month's spending on its usual course
import { PaceChart } from "../../charts/PaceChart.tsx";
import { hashOf } from "../../routes.ts";
import { answerMoney, dayMonth, money } from "../../format.ts";
import { rich, t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { Button } from "../ui/Button.tsx";
import { euroRange, monthTitle, paceGapText } from "./texts.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

/** Why there is no sum to say. */
function unknownText(reason: Extract<NytData["left"], { known: false }>["reason"]): string {
  if (reason === "late") return t("home.gap_late");
  if (reason === "no-balance") return t("home.no_balance");
  return t("home.gap_no_payday");
}

/**
 * Nyt, the whole view (docs/design/README.md section 1.1): the sum left before the payday, that sum per day left
 * against what everyday spending usually takes a day, the month's spending against its usual band to the same day with
 * the chart of the month's days, and the balance and the bills the sum is made of. Every figure is a field of `nyt` in
 * the dashboard answer (`nytAnswer` of core); nothing is added up here. The answer is in whole euros, its two parts to
 * the cent.
 */
export function Nyt({ data }: { data: DashboardData & { nyt: NytData } }) {
  const { nyt, pace, ahead, home } = data;
  const { left, usualPerDayCents } = nyt;
  const usual = nyt.pace.usual;
  const payday = ahead?.payday && ahead.payday.date.startsWith(pace.month) ? Number(ahead.payday.date.slice(8, 10)) : null;
  const none = new URLSearchParams();
  const spentHref = hashOf({ page: "transactions", params: new URLSearchParams({ from: `${pace.month}-01`, to: nyt.from }) });
  const gap = usual ? null : paceGapText(home.paceGap);
  return (
    <section className="home-answer nyt" aria-labelledby="home-question">
      {left.known ? (
        <h2 id="home-question" className="home-answer-line">
          <span>{t("home.nyt_left", { date: dayMonth(left.payday.date) })}</span> <Figure text={answerMoney(left.leftCents)} size="l" />
        </h2>
      ) : (
        <h2 id="home-question" className="home-answer-line">
          {unknownText(left.reason)}
        </h2>
      )}
      {(left.known && left.days > 0) || usualPerDayCents !== null ? (
        <p className="home-detail nyt-per-day">
          {left.known && left.days > 0 && tn(left.days, "home.nyt_per_day_one", "home.nyt_per_day_many", { sum: answerMoney(left.perDayCents) })}
          {left.known && left.days > 0 && usualPerDayCents !== null && " "}
          {usualPerDayCents !== null && t("home.nyt_usual_per_day", { sum: answerMoney(usualPerDayCents) })}
        </p>
      ) : null}
      <p className="home-detail nyt-pace">
        {rich("home.nyt_spent", {}, { sum: <Button variant="link" href={spentHref}>{answerMoney(nyt.pace.spentCents)}</Button> })}
        {usual && `, ${t("home.nyt_usual_band", { range: euroRange(usual.lowCents, usual.highCents) })}`}
      </p>
      {gap && <p className="home-detail">{gap}</p>}
      <PaceChart pace={pace} goal={null} payday={payday} names={{ current: monthTitle(pace.month), previous: pace.previous ? t("home.last_month") : "" }} />
      {left.known && (
        <p className="home-detail nyt-parts num">
          {rich(
            "home.nyt_parts",
            {},
            {
              balance: <Button variant="link" href={hashOf({ page: "reports", params: new URLSearchParams({ q: "saldot" }) })}>{money(left.balanceCents)}</Button>,
              bills: <Button variant="link" href={hashOf({ page: "bills", params: none, anchor: "ennen-palkkapaivaa" })}>{money(left.billsCents)}</Button>,
            },
          )}
        </p>
      )}
    </section>
  );
}

