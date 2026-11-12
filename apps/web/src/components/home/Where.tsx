// Decision: which category of the month to look at first
import { css } from "../../css.ts";
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Button } from "../ui/Button.tsx";
import { reportHref } from "./Answer.tsx";

type Top = DashboardData["top"]["rows"][number];

/** A category's change against last month to the same day, in words. Core says which word and gives the sum. */
function changeText(row: Top): string | null {
  if (row.change === null || row.changeCents === null) return null;
  if (row.change === "new") return t("home.nyt_change_new");
  if (row.change === "same") return t("home.nyt_change_same");
  return t(row.change === "more" ? "home.nyt_change_more" : "home.nyt_change_less", { sum: answerMoney(Math.abs(row.changeCents)) });
}

const percentOf = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;

/**
 * Suurimmat menot: the five largest categories of the month, each with its sum, a bar on the one scale they share, last
 * month's sum to the same day as a mark on the bar and the difference in words. A row opens the category's rows of the
 * month. Every figure is a field of `top`; the page adds up nothing.
 */
export function Where({ data }: { data: DashboardData & { nyt: NonNullable<DashboardData["nyt"]> } }) {
  const { top, pace, nyt } = data;
  if (top.rows.length === 0) return null;
  const marked = top.rows.some((r) => r.change !== null && r.change !== "new");
  const rowsHref = (category: string) => hashOf({ page: "transactions", params: new URLSearchParams({ category, from: `${pace.month}-01`, to: nyt.from }) });
  return (
    <section className="card home-where" aria-labelledby="home-where-h">
      <h2 id="home-where-h">{t("home.top_title")}</h2>
      <ol className="where-list">
        {top.rows.map((row) => {
          const change = changeText(row);
          const mark = row.previousShare !== null && row.change !== "new";
          return (
            <li key={row.category}>
              <a className="where-row" href={rowsHref(row.category)}>
                <span className="where-name">{row.label}</span>
                <span className="where-sum num">{answerMoney(row.cents)}</span>
                <span className="where-bar" aria-hidden="true">
                  <span className="where-fill" ref={css({ "inline-size": percentOf(row.barShare) })} />
                  {mark && <span className="where-mark" ref={css({ "inset-inline-start": percentOf(row.previousShare!) })} />}
                </span>
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
