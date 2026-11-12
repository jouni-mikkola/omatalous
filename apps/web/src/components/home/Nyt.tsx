// Decision: how much can we still spend before payday, is the month on its usual course, and which category to look at first
import { PaceChart } from "../../charts/PaceChart.tsx";
import { css } from "../../css.ts";
import { hashOf } from "../../routes.ts";
import { answerMoney, dayMonth, money } from "../../format.ts";
import { rich, t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { Button } from "../ui/Button.tsx";
import { euroRange, monthTitle, noPaydayText, paceGapText } from "./texts.ts";

type NytData = NonNullable<DashboardData["nyt"]>;
type Data = DashboardData & { nyt: NytData };
type Top = DashboardData["top"]["rows"][number];

const reportHref = (q?: string) => hashOf({ page: "reports", params: new URLSearchParams(q ? { q } : {}) });

/** Why there is no sum to say. */
function unknownText(left: Extract<NytData["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.gap_late");
  if (left.reason === "no-balance") return t("home.no_balance");
  return noPaydayText(left.found);
}

/** The answer: the sum left before the payday, what it is a day, and the balance and bills it is made of right under it. */
function Answer({ data }: { data: Data }) {
  const { left, usualPerDayCents } = data.nyt;
  return (
    <section className="home-answer" aria-labelledby="home-question">
      {left.known ? (
        <h2 id="home-question" className="home-answer-line">
          <span>{t("home.nyt_left", { date: dayMonth(left.payday.date) })}</span> <Figure text={answerMoney(left.leftCents)} size="l" />
        </h2>
      ) : (
        <h2 id="home-question" className="home-answer-line">
          {unknownText(left)}
        </h2>
      )}
      {(left.known && left.days > 0) || usualPerDayCents !== null ? (
        <p className="home-detail nyt-per-day">
          {left.known && left.days > 0
            ? usualPerDayCents !== null
              ? t("home.nyt_per_day_usual", { sum: answerMoney(left.perDayCents), usual: answerMoney(usualPerDayCents) })
              : t("home.nyt_per_day", { sum: answerMoney(left.perDayCents) })
            : usualPerDayCents !== null && t("home.nyt_usual_per_day", { sum: answerMoney(usualPerDayCents) })}
        </p>
      ) : null}
      {left.known && (
        <p className="home-detail nyt-parts num">
          {rich(
            "home.nyt_parts",
            {},
            {
              balance: <Button variant="link" href={reportHref("saldot")}>{money(left.balanceCents)}</Button>,
              bills: <Button variant="link" href={hashOf({ page: "bills", params: new URLSearchParams(), anchor: "ennen-palkkapaivaa" })}>{money(left.billsCents)}</Button>,
            },
          )}
        </p>
      )}
    </section>
  );
}

/**
 * The month so far: one sentence that says which side of the usual the spending is on, with the usual sum and its
 * range, then the chart that draws the same three figures. The month before is left off the chart here: the band
 * already says what is usual, and a fourth line hid the one that matters.
 */
function MonthSoFar({ data }: { data: Data }) {
  const { nyt, pace, ahead, home } = data;
  const payday = ahead?.payday && ahead.payday.date.startsWith(pace.month) ? Number(ahead.payday.date.slice(8, 10)) : null;
  const spentHref = hashOf({ page: "transactions", params: new URLSearchParams({ from: `${pace.month}-01`, to: nyt.from }) });
  const usual = home.pace;
  const spent = (cents: number) => <Button variant="link" href={spentHref}>{answerMoney(cents)}</Button>;
  const gap = usual ? null : paceGapText(home.paceGap);
  return (
    <section className="home-block nyt-month" aria-labelledby="home-month">
      <h3 id="home-month" className="home-title">
        <a href={reportHref()}>{t("home.nyt_month", { month: monthTitle(pace.month) })}</a>
      </h3>
      <p className="home-detail nyt-pace">
        {usual
          ? rich(
              usual.position === "within" ? "home.nyt_pace_within" : usual.position === "above" ? "home.nyt_pace_above" : "home.nyt_pace_below",
              { diff: answerMoney(Math.abs(usual.diffCents)), usual: answerMoney(usual.expectedCents), range: euroRange(usual.lowCents, usual.highCents) },
              { sum: spent(usual.spentCents) },
            )
          : rich("home.nyt_spent", {}, { sum: spent(nyt.pace.spentCents) })}
      </p>
      {gap && <p className="home-detail">{gap}</p>}
      <PaceChart pace={{ ...pace, previous: null }} goal={null} payday={payday} names={{ current: monthTitle(pace.month), previous: "" }} />
    </section>
  );
}

/** A category's change against last month to the same day, in words. Core says which word and gives the sum. */
function changeText(row: Top): string | null {
  if (row.change === null || row.changeCents === null) return null;
  if (row.change === "new") return t("home.nyt_change_new");
  if (row.change === "same") return t("home.nyt_change_same");
  return t(row.change === "more" ? "home.nyt_change_more" : "home.nyt_change_less", { sum: answerMoney(Math.abs(row.changeCents)) });
}

const percentOf = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;

/**
 * Where the money has gone: the five largest categories of the month as bars on one scale, each with last month's sum
 * to the same day as a mark on the bar and the difference in words. A bar opens the category's rows of the month.
 */
function Where({ data }: { data: Data }) {
  const { top, pace, nyt } = data;
  if (top.rows.length === 0) return null;
  const marked = top.rows.some((r) => r.change !== null && r.change !== "new");
  const rowsHref = (category: string) => hashOf({ page: "transactions", params: new URLSearchParams({ category, from: `${pace.month}-01`, to: nyt.from }) });
  return (
    <section className="home-block nyt-where" aria-labelledby="home-where">
      <h3 id="home-where" className="home-title">
        <a href={reportHref()}>{t("home.nyt_where")}</a>
      </h3>
      <ol className="where-list">
        {top.rows.map((row) => {
          const change = changeText(row);
          const mark = row.previousShare !== null && row.change !== "new";
          return (
            <li key={row.category}>
              <a className="where-row" href={rowsHref(row.category)}>
                <span className="where-name">{row.label}</span>
                <span className="where-bar" aria-hidden="true">
                  <span className="where-fill" ref={css({ "inline-size": percentOf(row.barShare) })} />
                  {mark && <span className="where-mark" ref={css({ "inset-inline-start": percentOf(row.previousShare!) })} />}
                </span>
                <span className="where-sum num">{answerMoney(row.cents)}</span>
                {change && <span className={`where-change num${row.change === "more" || row.change === "new" ? " more" : ""}`}>{change}</span>}
              </a>
            </li>
          );
        })}
      </ol>
      <p className="home-detail where-foot">
        {marked && <span>{t("home.nyt_where_mark")} </span>}
        {top.otherCount > 0 && <span className="num">{tn(top.otherCount, "home.nyt_other_one", "home.nyt_other_many")} {answerMoney(top.otherCents)}. </span>}
        <Button variant="link" href={reportHref()}>{t("home.nyt_all_categories")}</Button>
      </p>
    </section>
  );
}

/**
 * What the household has and owes today, two figures of `holdings`, each a link to its rows. No net figure: a loan
 * with no balance saved would make it too large, and the line under the figures says such a loan is missing.
 */
function Holdings({ data }: { data: Data }) {
  const { holdings } = data;
  if (holdings.accountsCents === null) return null;
  const unsaved = holdings.unsavedLoans?.count ?? 0;
  return (
    <section className="home-block nyt-holdings" aria-labelledby="home-holdings">
      <h3 id="home-holdings" className="home-title">
        <a href={reportHref("saldot")}>{t("home.nyt_holdings")}</a>
      </h3>
      <dl className="home-figures">
        <div>
          <dt>{t("home.nyt_accounts")}</dt>
          <dd>
            <a href={reportHref("saldot")}><Figure text={answerMoney(holdings.accountsCents)} size="m" /></a>
          </dd>
        </div>
        {(holdings.debtCents !== 0 || unsaved > 0) && (
          <div>
            <dt>{t("home.nyt_debt")}</dt>
            <dd>
              <a href={reportHref("velat")}><Figure text={answerMoney(holdings.debtCents)} size="m" /></a>
            </dd>
          </div>
        )}
      </dl>
      {unsaved > 0 && (
        <p className="home-detail nyt-unsaved">
          {tn(unsaved, "home.nyt_unsaved_one", "home.nyt_unsaved_many")} <Button variant="link" href={hashOf({ page: "review", params: new URLSearchParams() })}>{t("home.nyt_unsaved_link")}</Button>
        </p>
      )}
    </section>
  );
}

/**
 * Nyt (docs/design/README.md section 1.1): the answer, then the three things a household looks at after it, each one
 * step from its rows. Every figure is a field of the dashboard answer (`nyt`, `home.pace`, `top`, `holdings`); nothing
 * is added up or compared here.
 */
export function Nyt({ data }: { data: Data }) {
  return (
    <div className="nyt">
      <Answer data={data} />
      <MonthSoFar data={data} />
      <Where data={data} />
      <Holdings data={data} />
    </div>
  );
}
