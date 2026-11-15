// Decision: is the household spending more than it earns, month after month, and is this month on its usual course
import { MonthBars } from "../../charts/MonthBars.tsx";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

/**
 * Tulot ja menot: the last twelve months of income and spending as bars (MonthBars), the running month marked as not
 * whole and the usual month's spending as a line. A month opens its rows. The months as a table are on Raportit >
 * Menot, which Menot kategorioittain links to, so the page links there once.
 */
export function Months({ data, today }: { data: DashboardData; today: string }) {
  if (data.overview.months.length === 0) return null;
  return (
    <section className="card home-months" aria-labelledby="home-months-h">
      <h2 id="home-months-h">{t("home.months_title")}</h2>
      <MonthBars overview={data.overview} today={today} />
    </section>
  );
}
