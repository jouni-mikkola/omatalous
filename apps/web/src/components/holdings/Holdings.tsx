/**
 * Decision: what the household has and what it owes, before the month: each account with its balance, each credit card
 * with what is used of its limit, each loan with what is left, and a total at the foot of each group. Yhteenveto opens
 * with it, under the heading Varallisuus. Tilit and Lainat stand side by side, the cards in a row of their own under
 * them; where a group is missing the others close up, so a household with no loan has Tilit and its cards side by
 * side and no hole. A card and a loan have one form: the name as a link, then its figures as rows; a card has its picture
 * (CardFace) and, when it has a limit, the arc of what is used (CreditArc) beside its name. Every figure is the one in
 * `holdings` (the answer Yhteenveto already loads), shown as given: no sum is made here. A group with nothing in it is
 * left out, and every account has its row, in the order core gives. The name of an account, a card or a loan is a link:
 * to the rows of the account in Tapahtumat, to the report Lainat.
 */
import type { CSSProperties, ReactNode } from "react";
import { daysBetween, SAME_DEBT_TWICE } from "@banking/core";
import { query } from "../../api.ts";
import { logoForInstitution } from "../../banks.ts";
import { date, money } from "../../format.ts";
import { addsUp, shares } from "../../marks.ts";
import { partText, typedByText } from "../../part.ts";
import { LOANS_REPORT_ANCHOR } from "../../routes.ts";
import type { DashboardData, Meta } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { CardFace } from "./CardFace.tsx";
import { CreditArc } from "./CreditArc.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { cardMasks, cardName, cardsOwe, maskedNames } from "./holding-rows.ts";
import "../../styles/statement.css";
import "../../styles/holdings.css";

type Answer = DashboardData["holdings"];

/** A figure of the answer, or the dash for one the bank did not give. */
const figure = (cents: number | null): string => (cents === null ? "–" : money(cents));

/** The line that dates a balance the bank gave more than a day ago; nothing for a fresh one. */
function sinceLine(balanceAt: string | null, today: string): string | null {
  return balanceAt && daysBetween(balanceAt, today) > 1 ? `Saldo päivältä ${date(balanceAt)}` : null;
}

/** A name that is a link, in the colour of the row until it is pointed at; `mask` tells apart two that share a name. */
function Name({ name, href, mask }: { name: string; href: string; mask: string | undefined }) {
  return (
    <span className="st-name holding-name" title={mask ? `${name} ·· ${mask}` : name}>
      <a href={href}>{name}</a>
      {mask && <span className="muted"> ·· {mask}</span>}
    </span>
  );
}

/** The last row of a group: its total, bold over a rule, set as a figure of the middle size. */
function Total({ label, cents, note }: { label: string; cents: number | null; note?: string | undefined }) {
  return (
    <dl className="st-rows">
      <div className="st-row st-total">
        <dt className="st-name">{label}</dt>
        <dd className="st-num">
          <Figure text={figure(cents)} size="m" />
        </dd>
        {note && <dd className="st-sub">{note}</dd>}
      </div>
    </dl>
  );
}

/**
 * A card or a loan: its name with the lines under it, and its figures as rows set in a little. `note` follows the figures.
 * `face` is a picture at the left of all of that, for the eye alone, and `arc` stands under the name beside it.
 */
function Unit({ name, href, mask, lines, note, face, arc, children }: { name: string; href: string; mask?: string | undefined; lines: (string | null | undefined)[]; note?: ReactNode; face?: ReactNode; arc?: ReactNode; children: ReactNode }) {
  const rows = (
    <>
      <div className="st-row holding-unit-head">
        <Name name={name} href={href} mask={mask} />
        {lines.map((line, i) => line && <span key={i} className="st-sub">{line}</span>)}
      </div>
      {arc}
      <dl className="st-rows">{children}</dl>
      {note}
    </>
  );
  if (!face) return <li className="holding-unit">{rows}</li>;
  return (
    <li className="holding-unit holding-unit-faced">
      {face}
      <div className="holding-unit-body">{rows}</div>
    </li>
  );
}

function Accounts({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts, accountsCents } = holdings;
  const masks = maskedNames(accounts);
  const missing = accounts.filter((a) => a.balanceCents === null).length;
  // the marks assert arithmetic: a bracket when the rows add up to the total, a track on each when each is a part of it
  const parts = accounts.map((a) => a.balanceCents);
  const adds = accountsCents !== null && addsUp(parts, accountsCents);
  const percents = accountsCents !== null ? shares(parts, accountsCents) : null;
  const known = accounts.flatMap((a, i) => (a.balanceCents === null ? [] : [i]));
  let from = 0;
  const tracks = percents?.map((p) => {
    const at = from;
    from += p ?? 0;
    return p === null ? null : { at, p };
  });
  return (
    <section>
      <h3 className="st-cap">Tilit</h3>
      <ul className={adds ? "st-rows adds-up" : "st-rows"}>
        {accounts.map((a, i) => {
          const part = partText(a.part, "account");
          const since = sinceLine(a.balanceAt, meta.today);
          const track = tracks?.[i];
          const classes = ["st-row", "holding-account", track ? "share" : "", adds && i === known[0] ? "part-first" : "", adds && i === known[known.length - 1] ? "part-last" : ""];
          return (
            <li key={a.id} className={classes.filter(Boolean).join(" ")} style={track ? ({ "--from": track.at, "--part": track.p } as CSSProperties) : undefined}>
              <Name name={a.name} href={`#/transactions${query({ accountId: a.id })}`} mask={masks.get(a.id)} />
              <span className="st-num">{figure(a.balanceCents)}</span>
              {part && <span className="st-sub">{part}</span>}
              {since && <span className="st-sub">{since}</span>}
            </li>
          );
        })}
      </ul>
      <Total label="Tilit yhteensä" cents={accountsCents} note={missing > 0 ? `Ilman ${missing} tilin saldoa` : undefined} />
    </section>
  );
}

function Cards({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { cards, cardsCents } = holdings;
  const masks = cardMasks(cards);
  return (
    <section className="holding-cards">
      <header className="holding-cards-head">
        <h3 className="st-cap">Luottokortit</h3>
        {cards.length > 1 && (
          <dl className="holding-inline">
            <dt>Luottokortit yhteensä</dt>
            <dd>
              <Figure text={figure(cardsCents)} size="s" />
            </dd>
          </dl>
        )}
      </header>
      <ul className="holding-units holding-card-list">
        {cards.map((c) => {
          const { usedCents: used, limitCents: limit, freeCents: free, overCents } = c;
          const over = overCents !== null && overCents > 0 ? overCents : null;
          const href = `#/transactions${query({ accountId: c.id })}`;
          return (
            <Unit
              key={c.id}
              name={cardName(c.name)}
              href={href}
              mask={masks.get(c.id)}
              lines={[partText(c.part, "debt"), sinceLine(c.balanceAt, meta.today)]}
              face={<CardFace card={c} logo={c.bank ? logoForInstitution(c.bank, meta.bank.banks) : null} href={href} />}
              arc={<CreditArc usedCents={used} limitCents={limit} />}
            >
              <FigureRow label="Käytetty luotto" bad={over !== null}>{figure(used)}</FigureRow>
              {limit !== null && <FigureRow label="Luottoraja">{money(limit)}</FigureRow>}
              {limit !== null && (over !== null ? <FigureRow label="Luottoraja ylitetty">{money(over)}</FigureRow> : free !== null && <FigureRow label="Käytettävissä">{money(free)}</FigureRow>)}
            </Unit>
          );
        })}
      </ul>
    </section>
  );
}

function Loans({ holdings }: { holdings: Answer }) {
  const { loans, loansCents } = holdings;
  return (
    <section>
      <h3 className="st-cap">Lainat</h3>
      <ul className="holding-units holding-loans">
        {loans.map((l) => (
          <Unit
            key={l.id}
            name={l.name}
            href={`#/reports#${LOANS_REPORT_ANCHOR}`}
            lines={[l.lender, l.part && partText(l.part, "debt"), l.typedBy && typedByText(l.typedBy)]}
            note={l.maybeTwice && <p className="st-note">{SAME_DEBT_TWICE}: katso Lainat.</p>}
          >
            <FigureRow label="Lainaa jäljellä">{figure(l.leftCents)}</FigureRow>
            {l.monthlyPaymentCents !== null && <FigureRow label="Kuukausierä">{money(l.monthlyPaymentCents)}</FigureRow>}
          </Unit>
        ))}
      </ul>
      {loansCents !== null && loansCents > 0 && <Total label="Lainat yhteensä" cents={loansCents} />}
    </section>
  );
}

export function Holdings({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts, cards, loans, debtCents } = holdings;
  const groups = [accounts.length, cards.length, loans.length].filter((n) => n > 0).length;
  if (groups === 0) return null;
  // two groups stand side by side; of three, Tilit and Lainat do, with the cards under them across the block: a group
  // that is missing leaves no hole, the next one moves up into its place
  const columns = `holding-groups holding-groups-${groups}`;
  // the debts of the block are more than the loans only when a card owes: then they have their own line at its foot
  const debts = loans.length > 0 && cardsOwe(cards);

  return (
    <section className="card holdings" aria-labelledby="holdings-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="holdings-h">Varallisuus</h2>
        </div>
      </div>
      <div className={columns}>
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} />}
        {loans.length > 0 && <Loans holdings={holdings} />}
        {cards.length > 0 && <Cards holdings={holdings} meta={meta} />}
      </div>
      {debts && (
        <dl className="st-rows holding-foot">
          <div className="st-row">
            <dt className="st-name st-strong">Velat yhteensä</dt>
            <dd className="st-num st-strong">{money(debtCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
