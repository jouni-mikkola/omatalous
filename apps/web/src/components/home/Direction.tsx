// Decision: is the household's money growing or shrinking, and how long would it last without pay
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { reportHref } from "./Answer.tsx";
import { bufferBasisText, bufferText, directionText } from "./texts.ts";

/**
 * Varat ja velat: the figures side by side, name over figure. What is left after the debts stands first, then the
 * accounts and the debts it is made of (fields of `holdings`, each a link to its rows), the buffer in months of the
 * expected spending (cash less card debt and the payments before payday: no loan is in it, so it stands with a loan unsaved) and the 12-month average spending with the direction of the last three months (`home.direction`).
 * With a loan nobody saved a balance for, the net figure would be too large: it is left out and the line under the
 * figures says such a loan is missing.
 */
export function Direction({ holdings, direction }: { holdings: DashboardData["holdings"]; direction: DashboardData["home"]["direction"] }) {
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
            <dt>{t("home.debts")}</dt>
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
        {direction.averageCents !== null && (
          <div className="home-row">
            <dt>{t("home.spend_average")}</dt>
            <dd className="num">
              {answerMoney(direction.averageCents)}
              {t("home.per_month")}
              {note && <small>{note}</small>}
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
