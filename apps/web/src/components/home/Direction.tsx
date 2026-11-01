// Decision: is the household's money growing or shrinking, and how long would it last without pay
import { money } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { bufferBasisText, bufferText, directionText } from "./texts.ts";
import { t } from "../../text.ts";

type Home = DashboardData["home"];

/**
 * Varat ja velat: one list. The net worth is the first row and the accounts and debts that make it up follow, all fields of
 * `holdings`. The buffer, in months of the expected spending, and the 12-month average spending with the direction of the last
 * three months come from `home.direction`. Accounts one by one are in the Saldot report.
 */
export function Direction({ holdings, direction, balancesHref }: { holdings: DashboardData["holdings"]; direction: Home["direction"]; balancesHref: string }) {
  const note = directionText(direction);
  return (
    <section className="card home-direction" aria-labelledby="home-direction-h">
      <h2 id="home-direction-h">{t("home.assets_debts")}</h2>
      <dl className="home-rows">
        {holdings.netCents !== null && (
          <div className="home-row home-row-lead">
            <dt>{t("home.net_assets")}</dt>
            <dd className="num">{money(holdings.netCents, false)}</dd>
          </div>
        )}
        {holdings.accountsCents !== null && (
          <div className="home-row">
            <dt>{t("home.accounts")}</dt>
            <dd className="num">{money(holdings.accountsCents, false)}</dd>
          </div>
        )}
        {holdings.debtCents > 0 && (
          <div className="home-row">
            <dt>{t("home.debts")}</dt>
            <dd className="num">−{money(holdings.debtCents, false)}</dd>
          </div>
        )}
        {direction.bufferMonths !== null && (
          <div className="home-row">
            <dt>{t("home.buffer")}</dt>
            <dd className="num">{bufferText(direction.bufferMonths)}<small>{bufferBasisText(direction)}</small></dd>
          </div>
        )}
        {direction.averageCents !== null && (
          <div className="home-row">
            <dt>{t("home.spend_average")}</dt>
            <dd className="num">
              {money(direction.averageCents, false)}{t("home.per_month")}<small>{note}</small>
            </dd>
          </div>
        )}
      </dl>
      <p className="home-more">
        <a href={balancesHref}>{t("home.accounts_cards_loans")}</a>
      </p>
    </section>
  );
}
