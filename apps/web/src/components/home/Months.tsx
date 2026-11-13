// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { MonthBars } from "../../charts/MonthBars.tsx";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Button } from "../ui/Button.tsx";
import { reportHref } from "./Tiles.tsx";

/**
 * Tulot ja menot: the last twelve months of income and spending as bars (MonthBars), the running month marked as not
 * whole and the usual month's spending as a line. A month opens its rows; the months as a table are on Raportit >
 * Menot, behind the link, so the page stays one screen.
 */
export function Months({ data, today }: { data: DashboardData; today: string }) {
  if (data.overview.months.length === 0) return null;
  return (
    <section className="card home-months" aria-labelledby="home-months-h">
      <h2 id="home-months-h">{t("home.months_title")}</h2>
      <MonthBars overview={data.overview} today={today} />
      <p className="home-more">
        <Button variant="link" href={reportHref("menot")}>
          {t("rpt.sm_months")}
        </Button>
      </p>
    </section>
  );
}
