// Decision: is the household's money growing or shrinking, and how long would it last without pay
import { addMonths, monthEnd } from "@banking/core";
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData, Scope } from "../../types.ts";
import { Why } from "../Why.tsx";
import { reportHref } from "./Answer.tsx";
import { bufferBasisText, bufferText, directionText } from "./texts.ts";

/** From the oldest month the average reads to the end of last month: the period its months are taken from. */
function averagePeriod(today: string, from: string): { from: string; to: string } {
  return { from, to: monthEnd(addMonths(today.slice(0, 7), -1)) };
}

/**
 * Varat ja velat: the figures side by side, name over figure. What is left after the debts stands first, then the
 * accounts and the debts it is made of (fields of `holdings`, each a link to its rows), the buffer in months of the
 * expected spending (cash less card debt and the payments before payday: no loan is in it, so it stands with a loan unsaved) and the average spending of the
 * complete months before this one (up to 12, named by their count) with the direction of the last three (`home.direction`). The average opens its months and their rows.
 * It reads the flows Kuukausi reads (consumption and debt), but with a card bill whole on its booking day, over ended
 * months and with every one-off purchase in the mean, so it stands well above a month's spending to date; its label
 * and line say so, as it is not Kuukausi's figure.
 * With a loan nobody saved a balance for, the net figure would be too large: it is left out and the line under the
 * figures says such a loan is missing, and the label of the debts says their sum is partial.
 */
export function Direction({ holdings, direction, today, scope }: { holdings: DashboardData["holdings"]; direction: DashboardData["home"]["direction"]; today: string; scope: Scope }) {
  const unsaved = holdings.unsavedLoans?.count ?? 0;
  const note = directionText(direction);
  const basis = bufferBasisText(direction);
  if (holdings.accountsCents === null && direction.averageCents === null) return null;
  return (
    <section className="card home-direction" aria-labelledby="home-direction-h">
      <h2 id="home-direction-h">{t("home.assets_debts")}</h2>
      <dl className="home-rows">
        {holdings.netCents !== null && unsaved === 0 && (
          <div className="home-row home-row-lead">
            <dt>{t("home.net_assets")}</dt>
            <dd className="num">{answerMoney(holdings.netCents)}</dd>
          </div>
        )}
        {holdings.accountsCents !== null && (
          <div className="home-row">
            <dt>{t("home.accounts")}</dt>
            <dd className="num">
              <a href={reportHref("saldot")}>{answerMoney(holdings.accountsCents)}</a>
            </dd>
          </div>
        )}
        {(holdings.debtCents > 0 || unsaved > 0) && (
          <div className="home-row">
            {/* with a loan nobody saved a balance for, the sum is of the others: the label says so */}
            <dt>{unsaved > 0 ? tn(unsaved, "home.debts_partial_one", "home.debts_partial_many") : t("home.debts")}</dt>
            <dd className="num">
              <a href={reportHref("velat")}>{holdings.debtCents > 0 ? `−${answerMoney(holdings.debtCents)}` : answerMoney(0)}</a>
              {unsaved > 0 && (
                <small>
                  {tn(unsaved, "home.nyt_unsaved_one", "home.nyt_unsaved_many", { names: (holdings.unsavedLoans?.names ?? []).join(", ") })} <a href={hashOf({ page: "review", params: new URLSearchParams() })}>{t("home.nyt_unsaved_link")}</a>
                </small>
              )}
            </dd>
          </div>
        )}
        {direction.bufferMonths !== null && (
          <div className="home-row">
            <dt>{t("home.buffer")}</dt>
            <dd className="num">
              {bufferText(direction.bufferMonths)}
              {basis && <small>{basis}</small>}
            </dd>
          </div>
        )}
        {direction.averageCents !== null && direction.from !== null && (
          <div className="home-row">
            <dt>{t("home.spend_average", { count: direction.months })}</dt>
            <dd className="num">
              <Why figure="spend.average" title={t("home.spend_average", { count: direction.months })} range={averagePeriod(today, direction.from)} scope={scope} text={answerMoney(direction.averageCents)}>
                {answerMoney(direction.averageCents)}
              </Why>
              {t("home.per_month")}
              <small>{note ? `${t("home.spend_average_basis")} ${note}` : t("home.spend_average_basis")}</small>
            </dd>
          </div>
        )}
      </dl>
      <p className="home-more">
        <a href={reportHref("saldot")}>{t("home.accounts_cards_loans")}</a>
      </p>
    </section>
  );
}
