// Decision: how much of the money in the accounts is free to spend until the payday
import { type MoneyEnds, moneyEnds } from "@banking/core";
import type { ReactNode } from "react";
import { answerMoney, dayMonth, plural, rowMoney } from "../../format.ts";
import { rangeText } from "../../format-range.ts";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { FigurePanel } from "../FigurePanel.tsx";
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
 * The answer card while the sum left on the payday is known: the verdict (enough, or the sum that is missing), then the figure,
 * which opens its parts as rows, and while the money runs out before the payday the day it does and the payment that takes it there (core's `moneyEnds`).
 * Each row is a field of `runway.parts`, to the cent and with its sign, as every row that adds up to a shown sum is; the big figure is the same sum in whole euros, as the verdict says it; the card adds nothing up. The spending row is an estimate
 * and names its usual range. The card debt whose bill falls on the payday or later takes nothing off the sum
 * and is one quiet line under the rows.
 */
function AnswerCard({ runway, lowLine, ends }: { runway: KnownRunway; lowLine: ReactNode; ends: MoneyEnds | null }) {
  const short = runway.leftCents < 0;
  const date = dayMonth(runway.payday.date);
  return (
    <section className={`card home-now home-card${short ? " home-short" : ""}`} aria-labelledby="home-now-h">
      <h2 id="home-now-h" className="home-verdict">
        {short ? t("home.verdict_short", { sum: -runway.leftCents < 50 ? rowMoney(-runway.leftCents) : answerMoney(-runway.leftCents) }) : t("home.verdict_enough", { date })}
      </h2>
      <div data-tile="left" className="home-left-figure">
        <FigurePanel label={t("home.tile_runway", { date })} figure={<Figure text={Math.abs(runway.leftCents) < 50 ? rowMoney(runway.leftCents) : answerMoney(runway.leftCents)} size="l" />}>
          <RunwayParts runway={runway} date={date} />
        </FigurePanel>
        {runway.days === 0 && <span className="home-row-note">{t("home.tile_left_today")}</span>}
      </div>
      {ends && <p className="home-ends">{ends.payee === null ? t("home.ends_on_spending", { date: dayMonth(ends.date) }) : t("home.ends_on_payment", { date: dayMonth(ends.date), payee: ends.payee })}</p>}
      {lowLine}
    </section>
  );
}

/** The rows of the panel behind the figure: the parts of the sum left, then the card debt that takes nothing off. */
function RunwayParts({ runway, date }: { runway: KnownRunway; date: string }) {
  const { parts } = runway;
  // the range is of the spending taken off, so its ends are the spending as a positive sum, the least first
  const range = Math.round(parts.spending.lowCents / 100) === Math.round(parts.spending.highCents / 100) ? null : rangeText(-parts.spending.highCents, -parts.spending.lowCents);
  return (
    <>
      <dl className="home-rows">
        <div data-row="balance">
          <dt>{t("home.row_balance")}</dt>
          <dd className="num">{rowMoney(parts.balanceCents)}</dd>
        </div>
        <div data-row="bills">
          <dt>
            <a data-tile="bills" href={billsHref}>{t(parts.cardBills.count > 0 ? "rpt.buf_due" : "home.ledger_payments")}</a>
            {parts.bills.count > 0 && (
              <>
                {" "}
                <span className="home-row-note">{t("home.row_count", { count: plural(parts.bills.count, t("bills.u_bill"), t("bills.u_bills")) })}</span>
              </>
            )}
          </dt>
          <dd className="num">{rowMoney(parts.bills.cents)}</dd>
        </div>
        {parts.cardBills.count > 0 && (
          <div data-row="cards">
            <dt>
              {t("home.row_cards")} <span className="home-row-note">{t("home.row_count", { count: plural(parts.cardBills.count, t("bills.u_bill"), t("bills.u_bills")) })}</span>
            </dt>
            <dd className="num">{rowMoney(parts.cardBills.cents)}</dd>
          </div>
        )}
        <div data-row="spending">
          <dt>
            {t("home.row_spending", { days: String(runway.days) })}
            {range && " "}
            {range && <span className="home-row-note">{t("home.row_range", { range })}</span>}
          </dt>
          <dd className="num">{rowMoney(parts.spending.cents)}</dd>
        </div>
        <div data-row="left">
          <dt>{t("home.tile_runway", { date })}</dt>
          <dd className="num">{Math.abs(runway.leftCents) < 50 ? rowMoney(runway.leftCents) : answerMoney(runway.leftCents)}</dd>
        </div>
      </dl>
      {parts.laterCards.count > 0 && <p className="home-later-cards">{t("home.later_cards", { sum: answerMoney(parts.laterCards.cents), date })}</p>}
    </>
  );
}

/**
 * Nyt: what is left on the payday (`home.runway.leftOnPayday`, Jää palkkapäivänä), the one figure of the page that is a payday
 * period and not the month: the answer card (AnswerCard). While the everyday spending cannot be expected (under three complete
 * months, a card's purchases missing) the figure is `nyt.left` (Käytettävissä palkkapäivään), the money after the payments
 * alone, with its sum a day; it leads to Laskut, whose list holds the bills it takes off. Under either stands the lowest balance of
 * the days to the payday (`home.lowPoint`) while that figure is not known: the walk ends on the payday and never rises before it, so a known lowest balance is the figure above and has no line, and a reason the figure's own line gives is not told twice. Nothing is added up here.
 */
export function Now({ data }: { data: Data }) {
  const { left } = data.nyt;
  const { lowPoint } = data.home;
  const runway = data.home.runway?.leftOnPayday;
  // the reason the figure's own line gives while it has no sum: an unknown lowest balance for the same reason says nothing more
  const ownReason = runway?.known || left.known ? null : left.reason;
  const lowHidden = lowPoint?.known ? runway?.known === true : lowPoint?.reason === ownReason;
  const lowLine = <LowPoint lowPoint={lowHidden ? null : lowPoint} />;
  if (runway?.known) return <AnswerCard runway={runway} lowLine={lowLine} ends={lowPoint?.known ? moneyEnds(lowPoint, runway.payday.date) : null} />;
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
