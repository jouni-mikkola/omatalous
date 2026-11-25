// Decision: how much of the money in the accounts is free to spend until the payday
import { answerMoney, dayMonth } from "../../format.ts";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { LowPoint } from "./LowPoint.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

/** Laskut at its table, where the bills the figure takes off stand by month. */
const billsHref = hashOf({ page: "bills", params: new URLSearchParams(), anchor: "laskut-taulukko" });

/** Why there is no sum left to the payday, in a line's words. */
function leftUnknown(left: Extract<Data["nyt"]["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.tile_late");
  if (left.reason === "no-balance") return t("home.tile_no_balance");
  if (left.reason === "no-card-balance") return t("home.tile_no_card_balance");
  return t("home.tile_no_payday");
}

/**
 * Nyt: what is left on the payday (`home.runway.leftOnPayday`, Jää palkkapäivänä): the accounts less the payments before it and
 * the everyday spending of the days to it, the one figure of the page that is a payday period and not the month. It leads
 * to Laskut, whose list holds the bills it takes off. While the everyday spending cannot be expected (under three complete
 * months, a card's purchases missing) the figure is `nyt.left` (Käytettävissä palkkapäivään), the money after the payments
 * alone, with its sum a day. Under it stands the lowest balance of the next days (`home.lowPoint`) when that comes after the
 * payday: a lowest balance before it is the figure above. Nothing is added up here.
 */
export function Now({ data }: { data: Data }) {
  const { left } = data.nyt;
  const { lowPoint } = data.home;
  const runway = data.home.runway?.leftOnPayday;
  // a sum a day below zero says nothing the sum does not: the line tells what is missing
  const line = runway?.known
    ? runway.days === 0 ? t("home.tile_left_today") : t("home.tile_runway_line", { date: dayMonth(runway.payday.date) })
    : !left.known ? leftUnknown(left) : left.leftCents < 0 ? t("home.tile_left_short", { sum: answerMoney(-left.leftCents) }) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) });
  const label = t(runway?.known ? "home.tile_runway" : "home.tile_left");
  const leftCents = runway?.known ? runway.leftCents : left.known ? left.leftCents : null;
  const payday = runway?.known ? runway.payday.date : left.known ? left.payday.date : null;
  return (
    <section className="card home-now" aria-label={label}>
      <a className={`home-left${leftCents !== null && leftCents < 0 ? " home-short" : ""}`} data-tile="left" href={billsHref}>
        {/* the spaces keep the words apart in the text a screen reader reads; the grid draws none */}
        <span className="home-fig-label">{label}</span>{" "}
        <Figure text={leftCents === null ? "–" : answerMoney(leftCents)} size="m" />{" "}
        <span className="home-fig-line">{line}</span>
      </a>
      <LowPoint lowPoint={lowPoint?.known && payday !== null && lowPoint.date < payday ? null : lowPoint} />
    </section>
  );
}
