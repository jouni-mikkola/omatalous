// Decision: which payment comes next, on which day and for how much
import { dayHeading, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { isEstimate, isPayment, type Payment } from "../next-days.ts";

/**
 * The first payment of the next 30 days of the dashboard answer's `ahead.upcoming`, whichever account pays it: its day,
 * its payee and its exact sum, the first thing the page says. Not drawn without one.
 */
export function NextPayment({ data }: { data: DashboardData }) {
  const ahead = data.ahead;
  const next = ahead?.upcoming.find((r): r is Payment => isPayment(r));
  if (!ahead || !next) return null;
  return (
    <section className="bills-next" aria-labelledby="bills-next-h">
      <h3 id="bills-next-h" className="bills-next-label">
        {t("bills.up_next")}
      </h3>
      <p className="bills-next-what">
        <span className="bills-next-day">{dayHeading(next.date, ahead.from)}</span>
        <span className="bills-next-name">{next.name}</span>
        {next.onCard && <span className="mb-tag">{t("bills.on_card")}</span>}
        {isEstimate(next) && <span className="mb-tag">{t("bills.legend_estimate")}</span>}
      </p>
      <Figure text={money(Math.abs(next.cents))} size="l" />
    </section>
  );
}
