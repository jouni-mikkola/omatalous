/**
 * Decision: what the household has and what it owes, before the month: each account with its balance, each credit card
 * with what is used of its limit and its next bill, each loan with what is left, and a total at the foot of each group.
 * The loans and the cards stand in the order core gives, the dearest by yearly cost first; a debt that is dear (Kallis,
 * Erittäin kallis) says so in a word among the lines under its name, and no other class and no unknown cost says anything.
 * Yhteenveto shows it under the heading Varat ja velat, Raportit > Varat ja velat with no heading of its own and with
 * the loans left to the report Lainat; the next bill of
 * a card shows where the page gives the coming bills (`ahead`), which only Yhteenveto loads. The accounts
 * stand in their types (checking, savings, other) when there are two types or more, a type of two accounts or more with its total. The
 * first group's heading says the day most balances are from; a row says its own day only when it differs, and names its bank only when
 * the accounts have more than one. Tilit and Lainat stand side by side, the cards in a row of their own under
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
import { date, money, moneyIn, monthYear } from "../../../format.ts";
import { t, tn } from "../../../text.ts";
import { partText, typedByText } from "../../../part.ts";
import { LOAN_TERMS_HASH, loanHash } from "../../../routes.ts";
import type { DashboardData, Meta, ReconcileState } from "../../../types.ts";
import { cardBankOf } from "../../../components/BankLogo.tsx";
import { Figure } from "../../../components/Figure.tsx";
import { CardFace } from "./CardFace.tsx";
import { CreditArc } from "./CreditArc.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { netLabelOf } from "../../../components/net-label.ts";
import { cardMasks, cardsOwe, dearWord, maskedNames, reconcileTitle } from "./holding-rows.ts";
import "../../../styles/statement.css";
import "../../../styles/holdings.css";
import { css } from "../../../css.ts";

type Answer = DashboardData["holdings"];
type Ahead = NonNullable<DashboardData["ahead"]>;

/** A figure of the answer, or the dash for one the bank did not give. */
const figure = (cents: number | null, foreign?: { currency: string; cents: number } | null): string =>
  foreign ? moneyIn(foreign.cents, foreign.currency) : cents === null ? "–" : money(cents);

/** The day most balances are from as the page writes it, the latest on a tie: the first group's heading says it once. */
function commonDay(rows: { balanceAt: string | null }[], today: string): string | null {
  const counts = new Map<string, number>();
  const latestFirst = rows.flatMap((r) => (r.balanceAt ? [r.balanceAt] : [])).sort().reverse();
  for (const at of latestFirst) counts.set(date(at, today), (counts.get(date(at, today)) ?? 0) + 1);
  let best: string | null = null;
  for (const [day, n] of counts) if (best === null || n > counts.get(best)!) best = day;
  return best;
}

/** The line that dates a balance, only when its day is not the one the heading names, so a figure of last week reads apart. */
function sinceLine(balanceAt: string | null, today: string, common: string | null): string | null {
  if (!balanceAt) return null;
  const day = date(balanceAt, today);
  return day === common ? null : t("ahead.balance_on", { date: day });
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
function Total({ label, cents, note }: { label: ReactNode; cents: number | null; note?: string | undefined }) {
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
 * The accounts as one list, under the headings of their types when `types` is given. One list lets each share track start where the row above ended. A type's heading holds its total when it has two accounts or more; for one account it would only repeat it.
 */
function AccountRows({ holdings, meta, types, common }: { holdings: Answer; meta: Meta; types: { type: AccountType; rows: Answer["accounts"] }[] | null; common: string | null }) {
  const masks = maskedNames(holdings.accounts);
  // a bank's name tells the rows apart only where the accounts are at more than one
  const severalBanks = new Set(holdings.accounts.flatMap((a) => (a.bank ? [a.bank] : []))).size > 1;
  const groups = types ?? [{ type: null, rows: holdings.accounts }];
  // a track on each row where core says each is a part of the total
  let at = 0;
  return (
    <ul className="st-rows">
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
            const since = sinceLine(a.balanceAt, meta.today, common);
            const p = holdings.accountShares?.[holdings.accounts.indexOf(a)];
            const track = p == null ? null : { at, p };
            at += p ?? 0;
            const classes = ["st-row", "holding-account", track ? "share" : ""];
            return (
              <li key={a.id} className={classes.filter(Boolean).join(" ")} ref={css({ "--from": track?.at, "--part": track?.p })}>
                <Name name={a.name} href={`#/transactions${query({ accountId: a.id })}`} mask={masks.get(a.id)} />
                <span className="st-num">
                  <Tick state={a.reconcile} />
                  {figure(a.balanceCents, a.foreign)}
                </span>
                {severalBanks && a.bank && <span className="st-sub">{a.bank}</span>}
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

function Accounts({ holdings, meta, common, stamp }: { holdings: Answer; meta: Meta; common: string | null; stamp: ReactNode }) {
  const { accounts, accountsCents } = holdings;
  // an account in another currency has a balance: it is shown with its currency and is in no total, so it is not missing
  const missing = accounts.filter((a) => a.balanceCents === null && !a.foreign).length;
  const types = ACCOUNT_TYPES.map((type) => ({ type, rows: accounts.filter((a) => a.type === type) })).filter((g) => g.rows.length > 0);
  return (
    <section>
      <header className="holding-head">
        <h3 className="st-cap">{t("holdings.accounts")}</h3>
        {stamp}
      </header>
      <AccountRows holdings={holdings} meta={meta} types={types.length > 1 ? types : null} common={common} />
      <Total label={t("holdings.accounts_total")} cents={accountsCents} note={missing > 0 ? tn(missing, "holdings.missing_one", "holdings.missing_many") : undefined} />
    </section>
  );
}

function Cards({ holdings, meta, ahead, common, stamp }: { holdings: Answer; meta: Meta; ahead: Ahead | undefined; common: string | null; stamp: ReactNode }) {
  const { cards, cardsCents } = holdings;
  const masks = cardMasks(cards);
  return (
    <section className="holding-cards">
      <header className="holding-cards-head">
        <h3 className="st-cap">{t("holdings.cards")}</h3>
        {stamp}
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
              lines={[dearWord(c.costClass), partText(c.part, "debt"), sinceLine(c.balanceAt, meta.today, common)]}
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

/**
 * The loans show the figures of the report Lainat, whose calculations open there: no door is repeated here. `known`: debts with
 * no balance are listed under the total, so it names itself the known one.
 */
function Loans({ holdings, known }: { holdings: Answer; known: boolean }) {
  const { loans, loansCents, loansEndDate } = holdings;
  return (
    <section>
      <h3 className="st-cap">{t("holdings.loans")}</h3>
      <ul className="holding-units holding-loans">
        {loans.map((l) => (
          <Unit
            key={l.id}
            name={l.name}
            href={loanHash(l.id)}
            lines={[l.lender, dearWord(l.costClass), l.paidOff ? t("holdings.paid_off") : null, l.part && partText(l.part, "debt"), l.typedBy && typedByText(l.typedBy)]}
            note={l.maybeTwice && <p className="st-note">{t("holdings.twice_see", { twice: t("holdings.twice") })}</p>}
          >
            {!l.paidOff && (
              <FigureRow label={t("holdings.left")}>
                {l.leftCents === null ? figure(l.leftCents) : money(l.leftCents)}
              </FigureRow>
            )}
            {l.monthlyPaymentCents !== null && (
              <FigureRow label={t("holdings.monthly")}>
                {money(l.monthlyPaymentCents)}
              </FigureRow>
            )}
          </Unit>
        ))}
      </ul>
      {loansCents !== null && loansCents > 0 && <Total label={t(known ? "holdings.loans_known" : "holdings.loans_total")} cents={loansCents} note={loansEndDate ? t("holdings.last_payment", { month: monthYear(loansEndDate).replace(/^0/, "") }) : t("holdings.last_payment_unknown")} />}
    </section>
  );
}

/**
 * `ahead`: the window of the dashboard answer, whose bills give each card its next one; `title`: the block's heading, none
 * (null) on a page whose own title says it; `buffer`: the line Yhteenveto adds at the foot; `loansListed`: the page lists the
 * loans in the report Lainat, so the block leaves out the Lainat group and the debts total (Lainat gives the same sum).
 */
export function Holdings({ holdings, meta, ahead, title = t("holdings.title"), buffer, loansListed = false }: { holdings: Answer; meta: Meta; ahead?: Ahead | null; title?: string | null; buffer?: ReactNode; loansListed?: boolean }) {
  const { accounts, accountsCents, cards, debtCents, unsavedLoans, netCents } = holdings;
  const loans = loansListed ? [] : holdings.loans;
  const groups = [accounts.length, cards.length, loans.length].filter((n) => n > 0).length;
  if (groups === 0) return null;
  // two groups stand side by side; of three, Tilit and Lainat do, with the cards under them across the block: a group
  // that is missing leaves no hole, the next one moves up into its place
  const columns = `holding-groups holding-groups-${groups}`;
  // the debts of the block are more than the loans only when a card owes: then they have their own line at its foot
  const debts = loans.length > 0 && cardsOwe(cards);
  // loans nobody saved: `netCents` holds no debt for them, so its name says so
  const netLabel = netLabelOf(holdings);
  // the day most balances are from, said once, beside the heading of Tilit when one of its accounts has a balance, else beside that of the cards
  const common = commonDay([...accounts, ...cards], meta.today);
  const stamp = common ? <span className="holding-date">{t("ahead.balance_on", { date: common })}</span> : null;
  // lenders paid every month whose loan nobody saved and cards nobody connected: the total cannot hold them, so each is told under it (the server lists them); Lainat lists them when it is shown
  const unsaved = loansListed ? [] : (unsavedLoans?.rows ?? []);

  return (
    <section className="card holdings" aria-labelledby={title === null ? undefined : "holdings-h"} aria-label={title === null ? t("holdings.title") : undefined}>
      <div className="card-head tb">
        <div className="card-name">{title !== null && <h2 id="holdings-h">{title}</h2>}</div>
        {/* what the household has net, the accounts less the debts (core's netCents): a dash while the debt total is unknown */}
        {(netCents !== null || (accountsCents !== null && debtCents === null)) && (
          <div className="card-datum">
            {netLabel && <span className="datum-label">{netLabel}</span>}
            <Figure text={netCents === null ? "–" : money(netCents, false)} size="s" />
          </div>
        )}
      </div>
      <div className={columns}>
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} common={common} stamp={accounts.some((a) => a.balanceAt) ? stamp : null} />}
        {loans.length > 0 && <Loans holdings={holdings} known={unsaved.length > 0} />}
        {cards.length > 0 && <Cards holdings={holdings} meta={meta} ahead={ahead ?? undefined} common={common} stamp={accounts.some((a) => a.balanceAt) ? null : stamp} />}
      </div>
      {(debts || unsaved.length > 0) && (
        <dl className="st-rows holding-foot">
          {debts && (
            <div className="st-row">
              <dt className="st-name st-strong">{t(unsaved.length > 0 ? "holdings.debts_known" : "holdings.debts_total")}</dt>
              <dd className="st-num st-strong">
                {figure(debtCents)}
              </dd>
            </div>
          )}
          {unsaved.map((u, i) => (
            <div className="st-row" key={i}>
              <dt className="st-name">{u.card ? `${u.name} · ${t("set.ri.credit_card")}` : u.kindUnknown ? `${u.name} · ${t("set.ri.credit_kind_not_known")}` : u.name}</dt>
              <dd className="st-num">
                {u.monthlyCents === null ? null : `${t("rpt.ln_per_month", { amount: money(u.monthlyCents) })} · `}
                {/* the missing balance is typed in Tarkistettavat, the list of debts that lack one; a debt answered "En tiedä" is no longer asked there */}
                {u.asked ? t("holdings.balance_missing") : <a href={LOAN_TERMS_HASH}>{t("holdings.balance_missing")}</a>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {buffer}
    </section>
  );
}
