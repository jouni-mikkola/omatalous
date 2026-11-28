/**
 * Decision: what the household has and what it owes, before the month: each account with its balance, each credit card
 * with what is used of its limit, each loan with what is left, and a total at the foot of each group.
 * The loans and the cards stand in the order core gives, the dearest by yearly cost first; a debt that is dear (Kallis,
 * Erittäin kallis) says so in a word among the lines under its name, and no other class and no unknown cost says anything.
 * Raportit > Varat ja velat shows it with no heading of its own, without the net figure at its head (`net`) and with the loans
 * left to the report Lainat when that lists them (`loansListed`). Yhteenveto shows only three lines of it (HoldingsLines). The accounts
 * stand in their types (checking, savings, other) when there are two types or more, a type of two accounts or more with its total.
 * No row names its bank or the day of its balance, and no group ends in a total of its own: the tiles at the head of the page say the
 * accounts and the debts. Tilit and Lainat stand side by side, the cards in a row of their own under
 * them; where a group is missing the others close up, so a household with no loan has Tilit and its cards side by
 * side and no hole. A card and a loan have one form: the name as a link, then its figures as rows; a card has its picture
 * (CardFace) and, when it has a limit, the arc of what is used (CreditArc) beside its name. Every figure is the one in
 * `holdings` (the dashboard answer), shown as given: no sum is made here. A group with nothing in it is
 * left out, and every account has its row, in the order core gives. The name of an account, a card or a loan is a link:
 * to the rows of the account in Tapahtumat, to the report Lainat.
 */
import { Fragment, type ReactNode } from "react";
import { cardName } from "@banking/core";
import { query } from "../../../api.ts";
import { money, moneyIn } from "../../../format.ts";
import { t } from "../../../text.ts";
import { partText, typedByText } from "../../../part.ts";
import { loanHash } from "../../../routes.ts";
import type { DashboardData, Meta, ReconcileState } from "../../../types.ts";
import { cardBankOf } from "../../../components/BankLogo.tsx";
import { Figure } from "../../../components/Figure.tsx";
import { CardFace } from "./CardFace.tsx";
import { CreditArc } from "./CreditArc.tsx";
import { FigureRow } from "./FigureRow.tsx";
import { lackingDebts, netLabelOf } from "../../../components/net-label.ts";
import { cardMasks, dearWord, maskedNames, reconcileTitle } from "./holding-rows.ts";
import "../../../styles/statement.css";
import "../../../styles/holdings.css";

type Answer = DashboardData["holdings"];

/** A figure of the answer, or the dash for one the bank did not give. */
const figure = (cents: number | null, foreign?: { currency: string; cents: number } | null): string =>
  foreign ? moneyIn(foreign.cents, foreign.currency) : cents === null ? "–" : money(cents);

const ACCOUNT_TYPES = ["checking", "savings", "other"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

/** A name that is a link, in the colour of the row until it is pointed at; `mask` tells apart two that share a name. */
function Name({ name, href, mask }: { name: string; href: string; mask: string | undefined }) {
  return (
    <span className="st-name holding-name" title={mask ? `${name} ·· ${mask}` : name}>
      <a href={href}>{name}</a>
      {mask && <span className="muted"> ·· {mask}</span>}
    </span>
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
 * The accounts as one list, under the headings of their types when `types` is given. A type's heading holds its total when it has two accounts or more; for one account it would only repeat it.
 */
function AccountRows({ holdings, types }: { holdings: Answer; types: { type: AccountType; rows: Answer["accounts"] }[] | null }) {
  const masks = maskedNames(holdings.accounts);
  const groups = types ?? [{ type: null, rows: holdings.accounts }];
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
            // an account cut by who paid has no share to name; the tiles' panel says it is the viewer's part
            const part = meta.accounts.find((m) => m.id === a.id)?.traced ? null : partText(a.part, "account");
            return (
              <li key={a.id} className="st-row holding-account">
                <Name name={a.name} href={`#/transactions${query({ accountId: a.id })}`} mask={masks.get(a.id)} />
                <span className="st-num">
                  <Tick state={a.reconcile} />
                  {figure(a.balanceCents, a.foreign)}
                </span>
                {a.loanPayment && <span className="st-sub">{t("holdings.loan_account")}</span>}
                {part && <span className="st-sub">{part}</span>}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}

function Accounts({ holdings, meta }: { holdings: Answer; meta: Meta }) {
  const { accounts } = holdings;
  const types = ACCOUNT_TYPES.map((type) => ({ type, rows: accounts.filter((a) => a.type === type) })).filter((g) => g.rows.length > 0);
  return (
    <section>
      <h3 className="st-cap">{t("holdings.accounts")}</h3>
      <AccountRows holdings={holdings} types={types.length > 1 ? types : null} />
    </section>
  );
}

function Cards({ holdings, meta }: { holdings: Answer; meta: Meta }) {
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
          return (
            <Unit
              key={c.id}
              name={cardName(c.name)}
              href={href}
              mask={masks.get(c.id)}
              lines={[dearWord(c.costClass), partText(c.part, "debt")]}
              face={<CardFace card={{ name: cardName(c.name), mask: c.mask }} bank={cardBankOf(c.name, c.bank, meta.bank?.banks ?? [])} href={href} />}
              arc={<CreditArc usedCents={used} limitCents={limit} />}
            >
              <FigureRow label={t("holdings.used")} bad={over !== null}>
                <Tick state={c.reconcile} />
                {figure(used)}
              </FigureRow>
              {limit !== null && <FigureRow label={t("holdings.limit")}>{money(limit)}</FigureRow>}
              {limit !== null && (over !== null ? <FigureRow label={t("holdings.over")}>{money(over)}</FigureRow> : free !== null && <FigureRow label={t("holdings.free")}>{money(free)}</FigureRow>)}
            </Unit>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The loans show the figures of the report Lainat, whose calculations open there: no door is repeated here.
 */
function Loans({ holdings }: { holdings: Answer }) {
  const { loans } = holdings;
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
    </section>
  );
}

/**
 * `title`: the block's heading, none (null) on a page whose own title says it; `loansListed`: the page lists the loans in
 * the report Lainat (which also tells the debts that lack a balance), so the block leaves out the Lainat group and the debts
 * total (Lainat gives the same sum).
 */
export function Holdings({ holdings, meta, title = t("holdings.title"), loansListed = false, net = true }: { holdings: Answer; meta: Meta; title?: string | null; loansListed?: boolean; net?: boolean }) {
  const { accounts, accountsCents, cards, debtCents, netCents } = holdings;
  const loans = loansListed ? [] : holdings.loans;
  const groups = [accounts.length, cards.length, loans.length].filter((n) => n > 0).length;
  if (groups === 0) return null;
  // two groups stand side by side; of three, Tilit and Lainat do, with the cards under them across the block: a group
  // that is missing leaves no hole, the next one moves up into its place
  const columns = `holding-groups holding-groups-${groups}`;
  const netLabel = netLabelOf(holdings);

  return (
    <section className="card holdings" aria-labelledby={title === null ? undefined : "holdings-h"} aria-label={title === null ? t("holdings.title") : undefined}>
      <div className="card-head tb">
        <div className="card-name">{title !== null && <h2 id="holdings-h">{title}</h2>}</div>
        {/* what the household has net, the accounts less the debts (core's netCents): a dash while the debt total is unknown, and none while a debt has no balance, as the figure would be too high */}
        {net && lackingDebts(holdings) === 0 && (netCents !== null || (accountsCents !== null && debtCents === null)) && (
          <div className="card-datum">
            {netLabel && <span className="datum-label">{netLabel}</span>}
            <Figure text={netCents === null ? "–" : money(netCents, false)} size="s" />
          </div>
        )}
      </div>
      <div className={columns}>
        {accounts.length > 0 && <Accounts holdings={holdings} meta={meta} />}
        {loans.length > 0 && <Loans holdings={holdings} />}
        {cards.length > 0 && <Cards holdings={holdings} meta={meta} />}
      </div>
    </section>
  );
}
