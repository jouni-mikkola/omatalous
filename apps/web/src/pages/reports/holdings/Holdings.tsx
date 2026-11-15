/**
 * Decision: what the household has and what it owes, before the month: each account with its balance, each credit card
 * with what is used of its limit and its next bill, each loan with what is left, and a total at the foot of each group.
 * Yhteenveto shows it under the heading Tilit ja kortit, Raportit > Tilit ja saldot under Varat ja velat; the next bill of
 * a card shows where the page gives the coming bills (`ahead`), which only Yhteenveto loads. The accounts
 * stand in their types (checking, savings, other) when there are two types or more, a type of two accounts or more with its total. Every
 * row names its bank and the day of its balance. Tilit and Lainat stand side by side, the cards in a row of their own under
 * them; where a group is missing the others close up, so a household with no loan has Tilit and its cards side by
 * side and no hole. A card and a loan have one form: the name as a link, then its figures as rows; a card has its picture
 * (CardFace) and, when it has a limit, the arc of what is used (CreditArc) beside its name. Every figure is the one in
 * `holdings` (the answer Yhteenveto already loads), shown as given: no sum is made here. A group with nothing in it is
 * left out, and every account has its row, in the order core gives. The name of an account, a card or a loan is a link:
 * to the rows of the account in Tapahtumat, to the report Lainat.
 */
import { Fragment, type ReactNode } from "react";
import { cardName } from "@banking/core";
import { query } from "../../../api.ts";
import { date, money, moneyIn } from "../../../format.ts";
import { t, tn } from "../../../text.ts";
import { partText, typedByText } from "../../../part.ts";
import { LOANS_REPORT_ANCHOR, SETTINGS_ANCHOR, settingsCardHash } from "../../../routes.ts";
import type { DashboardData, Meta, ReconcileState, Scope } from "../../../types.ts";
import { cardBankOf } from "../../../components/BankLogo.tsx";
import { Figure } from "../../../components/Figure.tsx";
import { Why } from "../../../components/Why.tsx";
import { CardFace } from "./CardFace.tsx";
import { CreditArc } from "./CreditArc.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { netLabelOf } from "../../../components/net-label.ts";
import { cardMasks, cardsOwe, maskedNames, reconcileTitle } from "./holding-rows.ts";
import "../../../styles/statement.css";
import "../../../styles/holdings.css";
import { css } from "../../../css.ts";

type Answer = DashboardData["holdings"];
type Ahead = NonNullable<DashboardData["ahead"]>;

/** A figure of the answer, or the dash for one the bank did not give. */
const figure = (cents: number | null, foreign?: { currency: string; cents: number } | null): string =>
  foreign ? moneyIn(foreign.cents, foreign.currency) : cents === null ? "–" : money(cents);

/** The line that dates a balance: the day the bank gave it, so a figure of today and one of last week read apart. */
function sinceLine(balanceAt: string | null, today: string): string | null {
  return balanceAt ? t("ahead.balance_on", { date: date(balanceAt, today) }) : null;
}

const ACCOUNT_TYPES = ["checking", "savings", "other"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

/** A card's next bill: the first bill of Laskut's 30 days (`ahead.upcoming`) that names the card. */
function nextBill(ahead: Ahead | undefined, cardId: string): { cents: number; date: string } | null {
  const row = ahead?.upcoming.find((r) => r.cardId === cardId && r.cents !== null && r.cents < 0);
  return row ? { cents: -row.cents!, date: row.date } : null;
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
 * `face` is a flat row above all of that and stands for the name (the head then holds only the lines), and `arc` stands under the name beside it.
 */
function Unit({ name, href, mask, lines, note, face, arc, children }: { name: string; href: string; mask?: string | undefined; lines: (string | null | undefined)[]; note?: ReactNode; face?: ReactNode; arc?: ReactNode; children: ReactNode }) {
  const rows = (
    <>
      {(!face || lines.some(Boolean)) && (
        <div className="st-row holding-unit-head">
          {!face && <Name name={name} href={href} mask={mask} />}
          {lines.map((line, i) => line && <span key={i} className="st-sub">{line}</span>)}
        </div>
      )}
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

/**
 * The accounts as one list, under the headings of their types when `types` is given. One list keeps the bracket whole,
 * from the first known balance to the last into Tilit yhteensä, and each share track starts where the row above ended. A type's heading holds its total when it has two accounts or more; for one account it would only repeat it.
 */
function AccountRows({ holdings, meta, types }: { holdings: Answer; meta: Meta; types: { type: AccountType; rows: Answer["accounts"] }[] | null }) {
  const masks = maskedNames(holdings.accounts);
  const groups = types ?? [{ type: null, rows: holdings.accounts }];
  // the marks assert arithmetic core did: a bracket when the rows add up to the total, a track on each when each is a part of it
  const adds = holdings.accountsAddUp;
  const known = groups.flatMap((g) => g.rows).filter((a) => a.balanceCents !== null);
  let at = 0;
  return (
    <ul className={adds ? "st-rows adds-up" : "st-rows"}>
      {groups.map((g) => (
        <Fragment key={g.type ?? "all"}>
          {g.type && (
            <li className="st-row holding-type-head">
              <h4 className="st-cap holding-type-cap">{t(`holdings.${g.type}`)}</h4>
              {g.rows.length > 1 && <span className="st-num">{figure(holdings.typeCents[g.type])}</span>}
            </li>
          )}
          {g.rows.map((a) => {
            const part = partText(a.part, "account", meta.accounts.find((m) => m.id === a.id)?.traced);
            const since = sinceLine(a.balanceAt, meta.today);
            const p = holdings.accountShares?.[holdings.accounts.indexOf(a)];
            const track = p == null ? null : { at, p };
            at += p ?? 0;
            const classes = ["st-row", "holding-account", track ? "share" : "", adds && a === known[0] ? "part-first" : "", adds && a === known.at(-1) ? "part-last" : ""];
            return (
              <li key={a.id} className={classes.filter(Boolean).join(" ")} ref={css({ "--from": track?.at, "--part": track?.p })}>
                <Name name={a.name} href={`#/transactions${query({ accountId: a.id })}`} mask={masks.get(a.id)} />
                <span className="st-num">
                  <Tick state={a.reconcile} />
                  {figure(a.balanceCents, a.foreign)}
                </span>
                {a.bank && <span className="st-sub">{a.bank}</span>}
                {a.loanPayment && <span className="st-sub">{t("holdings.loan_account")}</span>}
                {part && <span className="st-sub">{part}</span>}
                {since && <span className="st-sub">{since}</span>}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}

function Accounts({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts, accountsCents } = holdings;
  // an account in another currency has a balance: it is shown with its currency and is in no total, so it is not missing
  const missing = accounts.filter((a) => a.balanceCents === null && !a.foreign).length;
  const types = ACCOUNT_TYPES.map((type) => ({ type, rows: accounts.filter((a) => a.type === type) })).filter((g) => g.rows.length > 0);
  return (
    <section>
      <h3 className="st-cap">{t("holdings.accounts")}</h3>
      <AccountRows holdings={holdings} meta={meta} types={types.length > 1 ? types : null} />
      <Total label={t("holdings.accounts_total")} cents={accountsCents} note={missing > 0 ? tn(missing, "holdings.missing_one", "holdings.missing_many") : undefined} />
    </section>
  );
}

function Cards({ holdings, meta, ahead }: { holdings: Answer; meta: Meta; ahead: Ahead | undefined }) {
  const { cards, cardsCents } = holdings;
  const masks = cardMasks(cards);
  return (
    <section className="holding-cards">
      <header className="holding-cards-head">
        <h3 className="st-cap">{t("holdings.cards")}</h3>
        {cards.length > 1 && (
          <dl className="holding-inline">
            <dt>{t("holdings.cards_total")}</dt>
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
          const bill = nextBill(ahead, c.id);
          return (
            <Unit
              key={c.id}
              name={cardName(c.name)}
              href={href}
              mask={masks.get(c.id)}
              lines={[partText(c.part, "debt"), sinceLine(c.balanceAt, meta.today)]}
              face={<CardFace card={{ name: cardName(c.name), mask: c.mask }} bank={cardBankOf(c.name, c.bank, meta.bank?.banks ?? [])} href={href} />}
              arc={<CreditArc usedCents={used} limitCents={limit} />}
            >
              <FigureRow label={t("holdings.used")} bad={over !== null}>
                <Tick state={c.reconcile} />
                {figure(used)}
              </FigureRow>
              {limit !== null && <FigureRow label={t("holdings.limit")}>{money(limit)}</FigureRow>}
              {limit !== null && (over !== null ? <FigureRow label={t("holdings.over")}>{money(over)}</FigureRow> : free !== null && <FigureRow label={t("holdings.free")}>{money(free)}</FigureRow>)}
              {bill && <FigureRow label={t("holdings.next_bill")}>{t("holdings.bill_on", { sum: money(bill.cents), date: date(bill.date, meta.today) })}</FigureRow>}
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
      <h3 className="st-cap">{t("holdings.loans")}</h3>
      <ul className="holding-units holding-loans">
        {loans.map((l) => (
          <Unit
            key={l.id}
            name={l.name}
            href={`#/reports#${LOANS_REPORT_ANCHOR}`}
            lines={[l.lender, l.paidOff ? t("holdings.paid_off") : null, l.part && partText(l.part, "debt"), l.typedBy && typedByText(l.typedBy)]}
            note={l.maybeTwice && <p className="st-note">{t("holdings.twice_see", { twice: t("holdings.twice") })}</p>}
          >
            {!l.paidOff && (
              <FigureRow label={t("holdings.left")}>
                {l.leftCents === null ? (
                  figure(l.leftCents)
                ) : (
                  <Why figure="loan.balance" loan={l.id} title={t("holdings.left_named", { name: l.name })} range={day} scope={door.scope} text={money(l.leftCents)}>
                    {money(l.leftCents)}
                  </Why>
                )}
              </FigureRow>
            )}
            {l.monthlyPaymentCents !== null && (
              <FigureRow label={t("holdings.monthly")}>
                <Why figure="loan.monthly" loan={l.id} title={t("holdings.monthly_named", { name: l.name })} range={day} scope={door.scope} text={money(l.monthlyPaymentCents)}>
                  {money(l.monthlyPaymentCents)}
                </Why>
              </FigureRow>
            )}
          </Unit>
        ))}
      </ul>
      {loansCents !== null && loansCents > 0 && (
        <Total
          label={t("holdings.loans_total")}
          cents={loansCents}
          door={(text, shown) => (
            <Why figure="holdings.loans" title={t("holdings.loans_total")} range={day} scope={door.scope} text={text}>
              {shown}
            </Why>
          )}
        />
      )}
    </section>
  );
}

/** `ahead`: the window of the dashboard answer, whose bills give each card its next one; `title`: the block's heading. */
export function Holdings({ holdings, meta, scope, ahead, title = t("holdings.title") }: { holdings: Answer; meta: Meta; scope: Scope; ahead?: Ahead | null; title?: string }) {
  const { accounts, cards, loans, debtCents, unsavedLoans, netCents } = holdings;
  const groups = [accounts.length, cards.length, loans.length].filter((n) => n > 0).length;
  if (groups === 0) return null;
  // two groups stand side by side; of three, Tilit and Lainat do, with the cards under them across the block: a group
  // that is missing leaves no hole, the next one moves up into its place
  const columns = `holding-groups holding-groups-${groups}`;
  // the debts of the block are more than the loans only when a card owes: then they have their own line at its foot
  const debts = loans.length > 0 && cardsOwe(cards);
  // loans whose balance nobody gave: `netCents` holds no debt for them, so its name says so
  const { label: netLabel, lacking: unknown } = netLabelOf(holdings);
  // lenders paid every month whose loan nobody saved: the total cannot hold them, so it says so (the server counts them)
  const unsaved = unsavedLoans ? t("holdings.unsaved", { count: unsavedLoans.count, amount: money(unsavedLoans.paymentCents) }) : null;

  return (
    <section className="card holdings" aria-labelledby="holdings-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="holdings-h">{title}</h2>
        </div>
        {/* what the household has net, the accounts less the debts (core's netCents) */}
        {netCents !== null && (
          <div className="card-datum">
            {netLabel && (
              <span className="datum-label">
                {unknown === 0 ? netLabel : <a href={settingsCardHash(SETTINGS_ANCHOR.loans)} title={t("holdings.add_balances")}>{netLabel}</a>}
              </span>
            )}
            <Figure text={money(netCents, false)} size="s" />
          </div>
        )}
      </div>
      <div className={columns}>
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} />}
        {loans.length > 0 && <Loans holdings={holdings} door={{ scope, today: meta.today }} />}
        {cards.length > 0 && <Cards holdings={holdings} meta={meta} ahead={ahead ?? undefined} />}
      </div>
      {(debts || unsaved) && (
        <dl className="st-rows holding-foot">
          {debts && (
            <div className="st-row">
              <dt className="st-name st-strong">{t("holdings.debts_total")}</dt>
              <dd className="st-num st-strong">
                <Why figure="loans.total" title={t("holdings.debts_total")} range={{ from: meta.today, to: meta.today }} scope={scope} text={money(debtCents)}>
                  {money(debtCents)}
                </Why>
              </dd>
            </div>
          )}
          {unsaved && (
            <div className="st-row">
              <dt className="st-name">{t("holdings.no_balance")}</dt>
              <dd className="st-num">
                {unsaved}. <a href={settingsCardHash(SETTINGS_ANCHOR.loans)}>{t("holdings.add_balances_short")}</a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
