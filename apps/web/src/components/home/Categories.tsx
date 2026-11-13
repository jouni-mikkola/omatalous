// Decision: which category of the month to look at first, and which runs past its usual month
import { css } from "../../css.ts";
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Button } from "../ui/Button.tsx";
import { reportHref } from "./Tiles.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

const percentOf = (part: number, whole: number) => `${whole > 0 ? Math.round(Math.min(1, Math.max(0, part / whole)) * 1000) / 10 : 0}%`;

/**
 * Menot kategorioittain: the month's six largest categories so far (`overview.categories`), each with its sum, a bar
 * and its usual month as a mark on the bar, and the rest as one line. The bars share one scale, the largest of the sums
 * and the usual months, so a mark past the end of a bar is a category that has room left. A row opens the category's
 * rows of the month. Every sum is a field of the answer: only the lengths of the bars are worked out here.
 */
export function Categories({ data }: { data: Data }) {
  const { overview, pace, nyt } = data;
  const { rows, otherCents, otherCount, usualMonths } = overview.categories;
  if (rows.length === 0) return null;
  const scale = Math.max(...rows.map((r) => Math.max(r.cents, r.usualCents ?? 0)));
  const marked = rows.some((r) => r.usualCents !== null);
  const rowsHref = (category: string) => hashOf({ page: "transactions", params: new URLSearchParams({ category, from: `${pace.month}-01`, to: nyt.from }) });
  return (
    <section className="card home-where" aria-labelledby="home-where-h">
      <h2 id="home-where-h">{t("home.categories_title")}</h2>
      <ol className="where-list">
        {rows.map((row) => (
          <li key={row.category}>
            <a className="where-row" href={rowsHref(row.category)}>
              <span className="where-name">{row.label}</span>
              {/* the usual month on the name's line, before the sum, so a row is one line and its bar */}
              <span className="where-change num">{row.usualCents !== null && t("home.categories_usual", { sum: answerMoney(row.usualCents) })}</span>
              <span className="where-sum num">{answerMoney(row.cents)}</span>
              <span className="where-bar" aria-hidden="true">
                <span className={row.usualCents !== null && row.cents > row.usualCents ? "where-fill more" : "where-fill"} ref={css({ "inline-size": percentOf(row.cents, scale) })} />
                {row.usualCents !== null && <span className="where-mark" ref={css({ "inset-inline-start": percentOf(row.usualCents, scale) })} />}
              </span>
            </a>
          </li>
        ))}
      </ol>
      <p className="home-detail where-foot">
        {marked && <span>{t("home.categories_mark", { months: usualMonths })} </span>}
        {otherCount > 0 && <span className="num">{tn(otherCount, "home.nyt_other_one", "home.nyt_other_many")} {answerMoney(otherCents)}. </span>}
        <Button variant="link" href={reportHref("menot")}>{t("home.nyt_all_categories")}</Button>
      </p>
    </section>
  );
}
