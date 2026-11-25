// Decision: how much of the money in the accounts is free to spend until the payday
import { answerMoney, dayMonth, rowMoney } from "../../format.ts";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { LowPoint } from "./LowPoint.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

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
 * The working of the sum left on the payday, one row to a part of it: the accounts today, the payments before the payday, the debt the
 * cards hold beyond their bills, the everyday spending expected on the days to the payday and the card purchases a bill before it takes.
 * Each is a field of `home.runway` taken off with its sign, to the cent as every row that adds up to a shown sum is (the figure
 * above is in whole euros); a part that is 0 has no row. Only while the figure is known, as the rows are the figure's own parts.
 */
function Ledger({ runway, sum }: { runway: Extract<NonNullable<Data["home"]["runway"]>["leftOnPayday"], { known: true }>; sum: NonNullable<NonNullable<Data["home"]["runway"]>["sum"]> }) {
  const rows: { key: string; label: string; cents: number }[] = [
    { key: "balance", label: t("home.ledger_balance"), cents: sum.balanceCents },
    { key: "payments", label: t("home.ledger_payments"), cents: -sum.paymentsCents },
    { key: "cards", label: t("home.ledger_cards"), cents: -sum.cardDebtCents },
    { key: "everyday", label: t("home.ledger_everyday", { days: String(runway.days) }), cents: -runway.everydayCents },
    { key: "billed", label: t("home.ledger_billed"), cents: -runway.billedCents },
  ];
  return (
    <dl className="home-ledger">
      {rows.filter((r) => r.key === "balance" || r.cents !== 0).map((r) => (
        <div key={r.key} data-row={r.key}>
          <dt>{r.label}</dt>
          <dd className="num">{rowMoney(r.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Nyt: what is left on the payday (`home.runway.leftOnPayday`, Jää palkkapäivänä): the accounts less the payments before it and
 * the everyday spending of the days to it, the one figure of the page that is a payday period and not the month. It leads
 * to Laskut, whose list holds the bills it takes off; the question is the section's heading and names it. While the everyday
 * spending cannot be expected (under three complete months, a card's purchases missing) the figure is `nyt.left`
 * (Käytettävissä palkkapäivään), the money after the payments alone, with its sum a day. Under it stands the lowest balance of
 * the next days (`home.lowPoint`) when that comes after the payday: a lowest balance on or before it is the figure above (core
 * takes the payday's own bills off before the pay lands), and a reason the figure's own line gives is not told twice. Beside it
 * (under it on a phone) stands its ledger (Ledger). Nothing is added up here.
 */
export function Now({ data }: { data: Data }) {
  const { left } = data.nyt;
  const { lowPoint } = data.home;
  const runway = data.home.runway?.leftOnPayday;
  // a sum a day below zero says nothing the sum does not: the line tells what is missing
  // the payday stands in the question of the known figure, so that figure has a line only when the payday is today
  const line = runway?.known
    ? runway.days === 0 ? t("home.tile_left_today") : null
    : !left.known ? leftUnknown(left) : left.leftCents < 0 ? t("home.tile_left_short", { sum: answerMoney(-left.leftCents) }) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) });
  const label = runway?.known ? t("home.tile_runway", { date: dayMonth(runway.payday.date) }) : t("home.tile_left");
  const leftCents = runway?.known ? runway.leftCents : left.known ? left.leftCents : null;
  const payday = paydayOf(data);
  const sum = data.home.runway?.sum;
  // the reason the figure's own line gives while it has no sum: an unknown lowest balance for the same reason says nothing more
  const ownReason = runway?.known || left.known ? null : left.reason;
  const lowHidden = lowPoint?.known ? payday !== null && lowPoint.date <= payday : lowPoint?.reason === ownReason;
  return (
    <section className="card home-now" aria-labelledby="home-now-h">
      <div className="home-answer">
        <h2 id="home-now-h" className="home-fig-label">{label}</h2>
        <a className={`home-left${leftCents !== null && leftCents < 0 ? " home-short" : ""}`} data-tile="left" href={billsHref} aria-describedby="home-now-h">
          {/* the space keeps the words apart in the text a screen reader reads; the grid draws none */}
          <Figure text={leftCents === null ? "–" : answerMoney(leftCents)} size="l" />{" "}
          {line && <span className="home-fig-line">{line}</span>}
        </a>
        <LowPoint lowPoint={lowHidden ? null : lowPoint} />
      </div>
      {runway?.known && sum && <Ledger runway={runway} sum={sum} />}
    </section>
  );
}
