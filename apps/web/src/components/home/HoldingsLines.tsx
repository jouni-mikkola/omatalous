// Decision: where the household stands in what it has and owes, before it opens Varat ja velat for the parts
import type { ReactNode } from "react";
import { money } from "../../format.ts";
import { hashOf, loanTermsHash } from "../../routes.ts";
import { t, tn } from "../../text.ts";
import { lackingDebts } from "../net-label.ts";
import type { DashboardData } from "../../types.ts";
import "../../styles/statement.css";

const balancesHref = hashOf({ page: "balances", params: new URLSearchParams() });

/**
 * The right rail's block: Tilit, Luottokortit and Lainat as one line each, the figures of `holdings` as the answer gives them,
 * under a heading that is the one link to Varat ja velat, where the accounts, cards and loans are told in full. A group the household has none of has no
 * line. While a debt lacks its balance the Lainat sum names itself the known one and a line under the three says how many
 * lack it, linking to the first of them still asked in Tarkistettavat. `chip` stands by the heading and `buffer` at the foot.
 */
export function HoldingsLines({ holdings, chip, buffer }: { holdings: DashboardData["holdings"]; chip?: ReactNode; buffer?: ReactNode }) {
  const lacking = lackingDebts(holdings) + holdings.loans.filter((l) => !l.paidOff && l.leftCents === null).length;
  const asked = holdings.unsavedLoans?.rows.find((u) => !u.asked);
  const lines = [
    { id: "accounts", label: t("holdings.accounts"), has: holdings.accounts.length > 0, cents: holdings.accountsCents },
    { id: "cards", label: t("holdings.cards"), has: holdings.cards.length > 0, cents: holdings.cardsCents },
    { id: "loans", label: t(lacking > 0 ? "holdings.loans_known" : "holdings.loans"), has: holdings.loans.length > 0 || lacking > 0, cents: holdings.loans.length > 0 ? holdings.loansCents : null },
  ].filter((line) => line.has);
  if (lines.length === 0) return null;
  return (
    <section className="card holdings holdings-lines" aria-labelledby="holdings-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="holdings-h">
            <a href={balancesHref}>{t("holdings.title")}</a>
          </h2>
          {chip}
        </div>
      </div>
      <dl className="st-rows">
        {lines.map((line) => (
          <div key={line.id} className="st-row" data-holding={line.id}>
            <dt className="st-name">{line.label}</dt>
            <dd className="st-num">{line.cents === null ? "–" : money(line.cents)}</dd>
          </div>
        ))}
      </dl>
      {lacking > 0 && (
        <p className="st-note">
          {asked ? <a href={loanTermsHash(asked.debtId)}>{tn(lacking, "rpt.bal_lacking_one", "rpt.bal_lacking_many")}</a> : tn(lacking, "rpt.bal_lacking_one", "rpt.bal_lacking_many")}
        </p>
      )}
      {buffer}
    </section>
  );
}
