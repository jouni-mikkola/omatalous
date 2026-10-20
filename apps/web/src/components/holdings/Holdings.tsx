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
import { cardName, daysBetween, SAME_DEBT_TWICE } from "@banking/core";
import { query } from "../../api.ts";
import { date, money, moneyIn } from "../../format.ts";
import { partText, typedByText } from "../../part.ts";
import { LOANS_REPORT_ANCHOR } from "../../routes.ts";
import type { DashboardData, Meta, ReconcileState, Scope } from "../../types.ts";
import { AccountMark, cardBankOf } from "../BankLogo.tsx";
import { Figure } from "../Figure.tsx";
import { Why } from "../Why.tsx";
import { CardFace } from "./CardFace.tsx";
import { CreditArc } from "./CreditArc.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { cardMasks, cardsOwe, maskedNames, reconcileTitle } from "./holding-rows.ts";
import "../../styles/statement.css";
import "../../styles/holdings.css";

type Answer = DashboardData["holdings"];

/** A figure of the answer, or the dash for one the bank did not give. */
const figure = (cents: number | null, foreign?: { currency: string; cents: number } | null): string =>
  foreign ? moneyIn(foreign.cents, foreign.currency) : cents === null ? "–" : money(cents);

/** The line that dates a balance the bank gave more than a day ago; nothing for a fresh one. */
function sinceLine(balanceAt: string | null, today: string): string | null {
  return balanceAt && daysBetween(balanceAt, today) > 1 ? `Saldo päivältä ${date(balanceAt)}` : null;
}

/** A name that is a link, in the colour of the row until it is pointed at; `mask` tells apart two that share a name. */
function Name({ name, href, mask, mark }: { name: string; href: string; mask: string | undefined; mark?: ReactNode }) {
  return (
    <span className="st-name holding-name" title={mask ? `${name} ·· ${mask}` : name}>
      {mark}
      <a href={href}>{name}</a>
      {mask && <span className="muted"> ·· {mask}</span>}
    </span>
  );
}

/** The last row of a group: its total, bold over a rule, set as a figure of the middle size. */
function Total({ label, cents, note, door }: { label: ReactNode; cents: number | null; note?: string | undefined; door?: (text: string, figure: ReactNode) => ReactNode }) {
  return (
    <dl className="st-rows">
      <div className="st-row st-total">
        <dt className="st-name">{label}</dt>
        <dd className="st-num">
          {door && cents !== null ? door(figure(cents), <Figure text={figure(cents)} size="m" />) : <Figure text={figure(cents)} size="m" />}
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

/** The small mark before a balance (its glyph is drawn by the stylesheet): ✓ when the bank's balances are the sum of the rows, ! when they differ; nothing where it cannot be told. */
function Tick({ state }: { state: ReconcileState | undefined }) {
  const title = state ? reconcileTitle(state) : null;
  if (!title) return null;
  return (
    <span className={`holding-tick holding-tick-${state}`} role="img" aria-label={title} title={title} />
  );
}

function Accounts({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts, accountsCents, accountsAddUp: adds, accountShares: percents } = holdings;
  const masks = maskedNames(accounts);
  // an account in another currency has a balance: it is shown with its currency and is in no total, so it is not missing
  const missing = accounts.filter((a) => a.balanceCents === null && !a.foreign).length;
  // the marks assert arithmetic core did: a bracket when the rows add up to the total, a track on each when each is a part of it
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
          const part = partText(a.part, "account", meta.accounts.find((m) => m.id === a.id)?.traced);
          const since = sinceLine(a.balanceAt, meta.today);
          const track = tracks?.[i];
          const classes = ["st-row", "holding-account", track ? "share" : "", adds && i === known[0] ? "part-first" : "", adds && i === known[known.length - 1] ? "part-last" : ""];
          return (
            <li key={a.id} className={classes.filter(Boolean).join(" ")} style={track ? ({ "--from": track.at, "--part": track.p } as CSSProperties) : undefined}>
              <Name name={a.name} href={`#/transactions${query({ accountId: a.id })}`} mask={masks.get(a.id)} mark={<AccountMark name={a.name} institution={a.bank} banks={meta.bank?.banks ?? []} />} />
              <span className="st-num">
                <Tick state={a.reconcile} />
                {figure(a.balanceCents, a.foreign)}
              </span>
              {a.loanPayment && <span className="st-sub">Lainanhoitotili</span>}
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
              face={<CardFace card={c} bank={cardBankOf(c.name, c.bank, meta.bank?.banks ?? [])} href={href} />}
              arc={<CreditArc usedCents={used} limitCents={limit} />}
            >
              <FigureRow label="Käytetty luotto" bad={over !== null}>
                <Tick state={c.reconcile} />
                {figure(used)}
              </FigureRow>
              {limit !== null && <FigureRow label="Luottoraja">{money(limit)}</FigureRow>}
              {limit !== null && (over !== null ? <FigureRow label="Luottoraja ylitetty">{money(over)}</FigureRow> : free !== null && <FigureRow label="Käytettävissä">{money(free)}</FigureRow>)}
            </Unit>
          );
        })}
      </ul>
    </section>
  );
}

/** Where a loan figure of the block opens its calculation: today's, in the view the page shows. */
interface Door {
  scope: Scope;
  today: string;
}

function Loans({ holdings, door }: { holdings: Answer; door: Door }) {
  const { loans, loansCents } = holdings;
  const day = { from: door.today, to: door.today };
  return (
    <section>
      <h3 className="st-cap">Lainat</h3>
      <ul className="holding-units holding-loans">
        {loans.map((l) => (
          <Unit
            key={l.id}
            name={l.name}
            href={`#/reports#${LOANS_REPORT_ANCHOR}`}
            lines={[l.lender, l.paidOff ? "Maksettu" : null, l.part && partText(l.part, "debt"), l.typedBy && typedByText(l.typedBy)]}
            note={l.maybeTwice && <p className="st-note">{SAME_DEBT_TWICE}: katso Lainat.</p>}
          >
            {!l.paidOff && (
              <FigureRow label="Lainaa jäljellä">
                {l.leftCents === null ? (
                  figure(l.leftCents)
                ) : (
                  <Why figure="loan.balance" loan={l.id} title={`${l.name}, lainaa jäljellä`} range={day} scope={door.scope} text={money(l.leftCents)}>
                    {money(l.leftCents)}
                  </Why>
                )}
              </FigureRow>
            )}
            {l.monthlyPaymentCents !== null && (
              <FigureRow label="Kuukausierä">
                <Why figure="loan.monthly" loan={l.id} title={`${l.name}, kuukausierä`} range={day} scope={door.scope} text={money(l.monthlyPaymentCents)}>
                  {money(l.monthlyPaymentCents)}
                </Why>
              </FigureRow>
            )}
          </Unit>
        ))}
      </ul>
      {loansCents !== null && loansCents > 0 && (
        <Total
          label="Lainat yhteensä"
          cents={loansCents}
          door={(text, shown) => (
            <Why figure="holdings.loans" title="Lainat yhteensä" range={day} scope={door.scope} text={text}>
              {shown}
            </Why>
          )}
        />
      )}
    </section>
  );
}

export function Holdings({ holdings, meta, scope }: { holdings: Answer; meta: Meta; scope: Scope }) {
  const { accounts, cards, loans, debtCents, unsavedLoans, netCents } = holdings;
  const groups = [accounts.length, cards.length, loans.length].filter((n) => n > 0).length;
  if (groups === 0) return null;
  // two groups stand side by side; of three, Tilit and Lainat do, with the cards under them across the block: a group
  // that is missing leaves no hole, the next one moves up into its place
  const columns = `holding-groups holding-groups-${groups}`;
  // the debts of the block are more than the loans only when a card owes: then they have their own line at its foot
  const debts = loans.length > 0 && cardsOwe(cards);
  // lenders paid every month whose loan nobody saved: the total cannot hold them, so it says so (the server counts them)
  const unsaved = unsavedLoans ? `${unsavedLoans.count} ${unsavedLoans.count === 1 ? "laina" : "lainaa"} ilman saldoa, ${money(unsavedLoans.paymentCents)}/kk` : null;

  return (
    <section className="card holdings" aria-labelledby="holdings-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="holdings-h">Varallisuus</h2>
        </div>
        {/* what the household has net, the accounts less the debts (core's netCents) */}
        {netCents !== null && (
          <div className="card-datum">
            {debtCents > 0 && <span className="datum-label">Netto</span>}
            <Figure text={money(netCents, false)} size="s" />
          </div>
        )}
      </div>
      <div className={columns}>
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} />}
        {loans.length > 0 && <Loans holdings={holdings} door={{ scope, today: meta.today }} />}
        {cards.length > 0 && <Cards holdings={holdings} meta={meta} />}
      </div>
      {(debts || unsaved) && (
        <dl className="st-rows holding-foot">
          {debts && (
            <div className="st-row">
              <dt className="st-name st-strong">Velat yhteensä</dt>
              <dd className="st-num st-strong">
                <Why figure="loans.total" title="Velat yhteensä" range={{ from: meta.today, to: meta.today }} scope={scope} text={money(debtCents)}>
                  {money(debtCents)}
                </Why>
              </dd>
            </div>
          )}
          {unsaved && (
            <div className="st-row">
              <dt className="st-name">{debts ? "Lisäksi" : "Ilman saldoa"}</dt>
              <dd className="st-num">{unsaved}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
