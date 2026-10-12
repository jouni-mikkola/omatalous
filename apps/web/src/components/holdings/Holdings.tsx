/**
 * Decision: what the household has and what it owes, before the month: each account with its balance and a total over
 * them, each credit card with what is used of its limit, each loan with what is left. Yhteenveto opens with it, under the
 * heading Varallisuus. Every figure is the one in `holdings` (the answer Yhteenveto already loads), shown as given: nothing
 * here adds anything up, the total of the accounts and the debt total under Lainat are core's. A group with nothing in it
 * is left out.
 */
import { daysBetween, FIGURE_UNKNOWN, SAME_DEBT_TWICE } from "@banking/core";
import { logoForInstitution } from "../../banks.ts";
import { date, money } from "../../format.ts";
import { partText, typedByText } from "../../part.ts";
import type { DashboardData, Meta } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { CardRow } from "./CardFace.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { debtTotalName, maskedNames, splitAccounts } from "./holding-rows.ts";
import "../../styles/holdings.css";

type Answer = DashboardData["holdings"];

/** The line that dates a balance the bank gave more than a day ago; nothing for a fresh one. */
function sinceLine(balanceAt: string | null, today: string): string | null {
  return balanceAt && daysBetween(balanceAt, today) > 1 ? `Saldo päivältä ${date(balanceAt)}` : null;
}

function Accounts({ holdings, meta, logoOf }: { holdings: Answer; meta: Meta; logoOf: (bank: string | null) => string | null }) {
  const { accounts, accountsCents } = holdings;
  const { shown, folded } = splitAccounts(accounts);
  const masks = maskedNames(accounts);
  const logos = new Map(accounts.map((a) => [a.id, logoOf(a.bank)]));
  // the names line up when any account has a logo
  const slot = [...logos.values()].some(Boolean);
  const missing = accounts.filter((a) => a.balanceCents === null).length;
  const row = (a: Answer["accounts"][number]) => {
    const logo = logos.get(a.id);
    const since = sinceLine(a.balanceAt, meta.today);
    const mask = masks.get(a.id);
    const part = partText(a.part, "account");
    return (
      <li key={a.id} className="holding-row">
        {slot && <span className="holding-logo">{logo && <BankLogo src={logo} name={a.bank ?? ""} size="sm" />}</span>}
        <div className="holding-main">
          <div className="holding-name">
            {a.name}
            {mask && <span className="muted"> ·· {mask}</span>}
          </div>
          {part && <div className="holding-sub">{part}</div>}
          {since && <div className="holding-sub">{since}</div>}
        </div>
        <div className="holding-amount">{a.balanceCents === null ? "–" : money(a.balanceCents)}</div>
      </li>
    );
  };
  return (
    <section className="holding-group">
      <h3>Tilit</h3>
      <ul className="holding-list">
        <li className="holding-row holding-sum">
          <div className="holding-main">
            <div className="holding-name">Yhteensä</div>
            {missing > 0 && <div className="holding-sub">Ilman {missing} tilin saldoa</div>}
          </div>
          <div className="holding-amount">{accountsCents === null ? "–" : money(accountsCents)}</div>
        </li>
        {shown.map(row)}
      </ul>
      {folded.length > 0 && (
        <details className="holding-fold">
          <summary>Muut tilit ({folded.length})</summary>
          <ul className="holding-list">{folded.map(row)}</ul>
        </details>
      )}
    </section>
  );
}

function Loans({ holdings }: { holdings: Answer }) {
  const { loans, cards, debtCents } = holdings;
  return (
    <section className="holding-group">
      <h3>Lainat</h3>
      <ul className="holding-list">
        {loans.map((l) => (
          <li key={l.id} className="holding-loan">
            <div className="holding-name">{l.name}</div>
            {l.lender && <div className="holding-sub">{l.lender}</div>}
            {l.part && <div className="holding-sub">{partText(l.part, "debt")}</div>}
            {l.typedBy && <div className="holding-sub">{typedByText(l.typedBy)}</div>}
            <dl className="holding-figures">
              <FigureRow label="Lainaa jäljellä">{l.leftCents === null ? <span className="muted">{FIGURE_UNKNOWN}</span> : money(l.leftCents)}</FigureRow>
              {l.monthlyPaymentCents !== null && <FigureRow label="Kuukausierä">{money(l.monthlyPaymentCents)}</FigureRow>}
            </dl>
            {l.maybeTwice && <p className="holding-note small muted">{SAME_DEBT_TWICE}: katso Lainat.</p>}
          </li>
        ))}
        {debtCents > 0 && (
          <li className="holding-row holding-total">
            <div className="holding-main holding-name">{debtTotalName(cards)}</div>
            <div className="holding-amount">{money(debtCents)}</div>
          </li>
        )}
      </ul>
    </section>
  );
}

export function Holdings({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts, cards, loans } = holdings;
  if (!accounts.length && !cards.length && !loans.length) return null;
  const logoOf = (bank: string | null) => (bank ? logoForInstitution(bank, meta.bank.banks) : null);

  return (
    <div className="card holdings">
      <div className="card-head">
        <h2>Varallisuus</h2>
      </div>
      <div className="holding-groups">
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} logoOf={logoOf} />}
        {cards.length > 0 && (
          <section className="holding-group">
            <h3>Luottokortit</h3>
            <ul className="holding-list">
              {cards.map((c) => (
                <CardRow key={c.id} card={c} logo={logoOf(c.bank)} since={sinceLine(c.balanceAt, meta.today)} />
              ))}
            </ul>
          </section>
        )}
        {loans.length > 0 && <Loans holdings={holdings} />}
      </div>
    </div>
  );
}
