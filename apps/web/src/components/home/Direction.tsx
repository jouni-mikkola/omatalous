// Decision: is the household's money growing or shrinking, and how long would it last without pay
import { monthEnd } from "@banking/core";
import { hashOf } from "../../routes.ts";
import { answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData, Scope } from "../../types.ts";
import { Why } from "../Why.tsx";
import { reportHref } from "./Answer.tsx";
import { bufferBasisText, bufferText, directionText } from "./texts.ts";

/** The running month: the expected spending is the month's, and its explanation lists the months it is read from. */
function monthOfToday(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: monthEnd(today.slice(0, 7)) };
}

/**
 * Varat ja velat: the figures side by side, name over figure. What is left after the debts stands first, then the
 * accounts and the debts it is made of (fields of `holdings`, each a link to its rows), the buffer in months of the
 * expected spending (cash less card debt and the payments before payday: no loan is in it, so it stands with a loan unsaved) and that
 * expected spending itself, the one usual spending of the page, with the direction of the last three months (`home.direction`). It opens its months and their rows.
 * With a loan nobody saved a balance for, the net figure would be too large: it is left out, and the debts' own label
 * says the sum lacks those loans.
 */
export function Direction({ holdings, direction, today, scope }: { holdings: DashboardData["holdings"]; direction: DashboardData["home"]["direction"]; today: string; scope: Scope }) {
  const unsaved = holdings.unsavedLoans?.count ?? 0;
  const note = directionText(direction);
  const basis = bufferBasisText(direction);
  if (holdings.accountsCents === null && direction.usualCents === null) return null;
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
            <dt>{unsaved > 0 ? tn(unsaved, "home.debts_partial_one", "home.debts_partial_many") : t("home.debts")}</dt>
            <dd className="num">
              <a href={reportHref("velat")}>{holdings.debtCents > 0 ? `−${answerMoney(holdings.debtCents)}` : answerMoney(0)}</a>
              {unsaved > 0 && (
                <small>
                  {t("home.nyt_unsaved_names", { names: (holdings.unsavedLoans?.names ?? []).join(", ") })} <a href={hashOf({ page: "review", params: new URLSearchParams() })}>{t("home.nyt_unsaved_link")}</a>
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
        {direction.usualCents !== null && (
          <div className="home-row">
            <dt>{t("home.spend_usual")}</dt>
            <dd className="num">
              <Why figure="expected.spend" title={t("home.spend_usual")} range={monthOfToday(today)} scope={scope} text={answerMoney(direction.usualCents)}>
                {answerMoney(direction.usualCents)}
              </Why>
              {t("home.per_month")}
              <small>{[t("home.spend_usual_basis", { count: direction.months }), note].filter(Boolean).join(" ")}</small>
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
