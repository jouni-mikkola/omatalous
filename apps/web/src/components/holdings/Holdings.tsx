/**
 * Decision: what the household has and what it owes, before the month: each account with its balance, each card with
 * what is used of its limit, each loan with what is left. Every figure is the one in `holdings` (the answer Kuukausi
 * already loads), shown as given: nothing here adds anything up, the debt total under Lainat is core's too. A group with
 * nothing in it is left out.
 */
import { daysBetween, FIGURE_UNKNOWN, SAME_DEBT_TWICE } from "@banking/core";
import { logoForInstitution } from "../../banks.ts";
import { date, money } from "../../format.ts";
import type { DashboardData, Meta } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { CardFace } from "./CardFace.tsx";
import "../../styles/holdings.css";

/** The line that dates a balance the bank gave more than a day ago; nothing for a fresh one. */
function sinceLine(balanceAt: string | null, today: string): string | null {
  return balanceAt && daysBetween(balanceAt, today) > 1 ? `Saldo päivältä ${date(balanceAt)}` : null;
}

export function Holdings({ holdings, meta }: { holdings: DashboardData["holdings"]; meta: Meta }) {
  const { accounts, cards, loans, debtCents } = holdings;
  if (!accounts.length && !cards.length && !loans.length) return null;
  const logoOf = (bank: string | null) => (bank ? logoForInstitution(bank, meta.bank.banks) : null);
  // the names line up when any account has a logo
  const accountLogos = accounts.map((a) => logoOf(a.bank));
  const slot = accountLogos.some(Boolean);

  return (
    <div className="card">
      {accounts.length > 0 && (
        <section className="holding-group">
          <div className="card-head">
            <h2>Tilit</h2>
          </div>
          <ul className="holding-list">
            {accounts.map((a, i) => {
              const logo = accountLogos[i];
              const since = sinceLine(a.balanceAt, meta.today);
              return (
                <li key={a.id} className="holding-row">
                  {slot && <span className="holding-logo">{logo && <BankLogo src={logo} name={a.bank ?? ""} size="sm" />}</span>}
                  <div className="holding-main">
                    <div className="holding-name">{a.name}</div>
                    {since && <div className="holding-sub">{since}</div>}
                  </div>
                  <div className="holding-amount">{a.balanceCents === null ? "–" : money(a.balanceCents)}</div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {cards.length > 0 && (
        <section className="holding-group">
          <div className="card-head">
            <h2>Kortit</h2>
          </div>
          <ul className="holding-cards">
            {cards.map((c) => (
              <CardFace key={c.id} card={c} logo={logoOf(c.bank)} since={sinceLine(c.balanceAt, meta.today)} />
            ))}
          </ul>
        </section>
      )}
      {loans.length > 0 && (
        <section className="holding-group">
          <div className="card-head">
            <h2>Lainat</h2>
          </div>
          <ul className="holding-list">
            {loans.map((l) => (
              <li key={l.id} className="holding-row">
                <div className="holding-main">
                  <div className="holding-name">{l.name}</div>
                  {l.lender && <div className="holding-sub">{l.lender}</div>}
                  {l.monthlyPaymentCents !== null && <div className="holding-sub">Maksu {money(l.monthlyPaymentCents)} kuukaudessa</div>}
                </div>
                <div className="holding-amount">
                  {l.leftCents === null ? <span className="muted">{FIGURE_UNKNOWN}</span> : money(l.leftCents)}
                  <div className="holding-sub">jäljellä</div>
                </div>
                {l.maybeTwice && <p className="holding-note small muted">{SAME_DEBT_TWICE}: katso Lainat.</p>}
              </li>
            ))}
            {debtCents > 0 && (
              <li className="holding-row holding-total">
                <div className="holding-main holding-name">Velkaa yhteensä</div>
                <div className="holding-amount">{money(debtCents)}</div>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
