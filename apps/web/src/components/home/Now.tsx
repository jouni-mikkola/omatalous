// Decision: how much of the money in the accounts is free to spend until the payday
import type { ReactNode } from "react";
import { answerMoney, dayMonth, rowMoney } from "../../format.ts";
import { rangeText } from "../../format-range.ts";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { KindChip } from "../KindChip.tsx";
import { LowPoint } from "./LowPoint.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
type KnownRunway = Extract<NonNullable<Data["home"]["runway"]>["leftOnPayday"], { known: true }>;

/** Laskut at its table, where the bills the figure takes off stand by month. */
const billsHref = hashOf({ page: "bills", params: new URLSearchParams(), anchor: "laskut-taulukko" });

/** The payday the figure counts to (the day the balance picture marks), when the page has one. */
export function paydayOf(data: Data): string | null {
  const runway = data.home.runway?.leftOnPayday;
  const { left } = data.nyt;
  return runway?.known ? runway.payday.date : left.known ? left.payday.date : null;
}

/** Why there is no sum left to the payday, in a line's words. */
function leftUnknown(left: Extract<Data["nyt"]["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.tile_late");
  if (left.reason === "no-balance") return t("home.tile_no_balance");
  if (left.reason === "no-card-balance") return t("home.tile_no_card_balance");
  return t("home.tile_no_payday");
}

/**
 * The answer card while the sum left on the payday is known: the verdict (enough, or the sum that is missing), then the figure
 * told in its parts as rows that are always open. Each row is a field of `runway.parts`, to the cent and with its sign, as every
 * row that adds up to a shown sum is; the card adds nothing up. The facts carry the Nyt chip, the two estimates (the spending,
 * with its range, and the sum left) the Arvio chip. The card debt whose bill falls on the payday or later takes nothing off the sum
 * and is one quiet line under the rows.
 */
function AnswerCard({ runway, lowLine }: { runway: KnownRunway; lowLine: ReactNode }) {
  const { parts } = runway;
  const short = runway.leftCents < 0;
  const date = dayMonth(runway.payday.date);
  // the range is of the spending taken off, so its ends are the spending as a positive sum, the least first
  const range = Math.round(parts.spending.lowCents / 100) === Math.round(parts.spending.highCents / 100) ? null : rangeText(-parts.spending.highCents, -parts.spending.lowCents);
  return (
    <section className={`card home-now home-card${short ? " home-short" : ""}`} aria-labelledby="home-now-h">
      <h2 id="home-now-h" className="home-verdict">
        {short ? t("home.verdict_short", { sum: answerMoney(-runway.leftCents) }) : t("home.verdict_enough", { date })}
      </h2>
      <dl className="home-rows">
        <div data-row="balance">
          <dt>
            {t("home.row_balance")} <KindChip kind="now" />
          </dt>
          <dd className="num">{rowMoney(parts.balanceCents)}</dd>
        </div>
        <div data-row="bills">
          <dt>
            <a data-tile="bills" href={billsHref}>{t("home.ledger_payments")}</a> <span className="home-row-note">{t("home.row_count", { count: String(parts.bills.count) })}</span>
          </dt>
          <dd className="num">{rowMoney(parts.bills.cents)}</dd>
        </div>
        {parts.cardBills.count > 0 && (
          <div data-row="cards">
            <dt>
              {t("home.row_cards")} <span className="home-row-note">{t("home.row_count", { count: String(parts.cardBills.count) })}</span>
            </dt>
            <dd className="num">{rowMoney(parts.cardBills.cents)}</dd>
          </div>
        )}
        <div data-row="spending">
          <dt>
            {t("home.row_spending", { days: String(runway.days) })} <KindChip kind="estimate" />
            {range && <span className="home-row-note">{t("home.row_range", { range })}</span>}
          </dt>
          <dd className="num">{rowMoney(parts.spending.cents)}</dd>
        </div>
        <div data-row="left">
          <dt>
            {t("home.tile_runway", { date })} <KindChip kind="estimate" />
          </dt>
          <dd data-tile="left">
            <Figure text={answerMoney(runway.leftCents)} size="l" />
            {runway.days === 0 && <span className="home-row-note">{t("home.tile_left_today")}</span>}
          </dd>
        </div>
      </dl>
      {parts.laterCards.count > 0 && <p className="home-later-cards">{t("home.later_cards", { sum: answerMoney(parts.laterCards.cents), date })}</p>}
      {lowLine}
    </section>
  );
}

/**
 * Nyt: what is left on the payday (`home.runway.leftOnPayday`, Jää palkkapäivänä), the one figure of the page that is a payday
 * period and not the month: the answer card (AnswerCard). While the everyday spending cannot be expected (under three complete
 * months, a card's purchases missing) the figure is `nyt.left` (Käytettävissä palkkapäivään), the money after the payments
 * alone, with its sum a day; it leads to Laskut, whose list holds the bills it takes off. Under either stands the lowest balance of
 * the next days (`home.lowPoint`) when that comes after the payday: a lowest balance on or before it is the figure above (core
 * takes the payday's own bills off before the pay lands), and a reason the figure's own line gives is not told twice. Nothing is added up here.
 */
export function Now({ data }: { data: Data }) {
  const { left } = data.nyt;
  const { lowPoint } = data.home;
  const runway = data.home.runway?.leftOnPayday;
  const payday = paydayOf(data);
  // the reason the figure's own line gives while it has no sum: an unknown lowest balance for the same reason says nothing more
  const ownReason = runway?.known || left.known ? null : left.reason;
  const lowHidden = lowPoint?.known ? payday !== null && lowPoint.date <= payday : lowPoint?.reason === ownReason;
  const lowLine = <LowPoint lowPoint={lowHidden ? null : lowPoint} />;
  if (runway?.known) return <AnswerCard runway={runway} lowLine={lowLine} />;
  // a sum a day below zero says nothing the sum does not: the line tells what is missing
  const line = !left.known ? leftUnknown(left) : left.leftCents < 0 ? t("home.tile_left_short", { sum: answerMoney(-left.leftCents) }) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) });
  const leftCents = left.known ? left.leftCents : null;
  return (
    <section className="card home-now" aria-labelledby="home-now-h">
      <div className="home-answer home-wide">
        <h2 id="home-now-h" className="home-fig-label">{t("home.tile_left")}</h2>
        <a className={`home-left${leftCents !== null && leftCents < 0 ? " home-short" : ""}`} data-tile="left" href={billsHref} aria-describedby="home-now-h">
          {/* the space keeps the words apart in the text a screen reader reads; the grid draws none */}
          <Figure text={leftCents === null ? "–" : answerMoney(leftCents)} size="l" />{" "}
          {line && <span className="home-fig-line">{line}</span>}
        </a>
        {lowLine}
      </div>
    </section>
  );
}
