// Decision: where the household stands in what it has and owes, before it opens Varat ja velat for the parts
import type { ReactNode } from "react";
import { money } from "../../format.ts";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import "../../styles/statement.css";

const balancesHref = hashOf({ page: "balances", params: new URLSearchParams() });

/**
 * The right rail's block: Tilit, Luottokortit and Lainat as one line each, the figures of `holdings` as the answer gives them,
 * each a link to Varat ja velat where the accounts, cards and loans are told in full. A group the household has none of has no
 * line. `chip` stands by the heading and `buffer` at the foot.
 */
export function HoldingsLines({ holdings, chip, buffer }: { holdings: DashboardData["holdings"]; chip?: ReactNode; buffer?: ReactNode }) {
  const lines = [
    { id: "accounts", label: t("holdings.accounts"), has: holdings.accounts.length > 0, cents: holdings.accountsCents },
    { id: "cards", label: t("holdings.cards"), has: holdings.cards.length > 0, cents: holdings.cardsCents },
    { id: "loans", label: t("holdings.loans"), has: holdings.loans.length > 0, cents: holdings.loansCents },
  ].filter((line) => line.has);
  if (lines.length === 0) return null;
  return (
    <section className="card holdings holdings-lines" aria-labelledby="holdings-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="holdings-h">{t("holdings.title")}</h2>
          {chip}
        </div>
      </div>
      <dl className="st-rows">
        {lines.map((line) => (
          <div key={line.id} className="st-row" data-holding={line.id}>
            <dt className="st-name">
              <a href={balancesHref}>{line.label}</a>
            </dt>
            <dd className="st-num">{line.cents === null ? "–" : money(line.cents)}</dd>
          </div>
        ))}
      </dl>
      {buffer}
    </section>
  );
}
