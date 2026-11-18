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
 * Nyt: what is left to the payday (`nyt.left`) with its sum a day. It is the one figure of the page that is a payday
 * period and not the month, and it leads to Laskut, whose list holds the bills it takes off. On the payday the sum a day
 * is the whole sum, so the line says only that the payday is today. Under it stands the lowest balance of the next days
 * (`home.lowPoint`). Nothing is added up here.
 */
export function Now({ data }: { data: Data }) {
  const { left } = data.nyt;
  const line = !left.known ? leftUnknown(left) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) });
  return (
    <section className="card home-now" aria-label={t("home.tile_left")}>
      <a className={`home-left${left.known && left.leftCents < 0 ? " home-short" : ""}`} data-tile="left" href={billsHref}>
        {/* the spaces keep the words apart in the text a screen reader reads; the grid draws none */}
        <span className="home-fig-label">{t("home.tile_left")}</span>{" "}
        <Figure text={left.known ? answerMoney(left.leftCents) : "–"} size="m" />{" "}
        <span className="home-fig-line">{line}</span>
      </a>
      <LowPoint lowPoint={data.home.lowPoint} />
    </section>
  );
}
