// Decision: do the accounts dip below what the household can live with before the money after the next payday arrives
import { answerMoney, dayMonth, language } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

type Low = NonNullable<DashboardData["home"]["lowPoint"]>;

/** Why there is no lowest balance, in a line's words: the reasons of the figure above it, and the two of the everyday spending. */
function reasonText(reason: Extract<Low, { known: false }>["reason"]): string {
  if (reason === "late") return t("home.tile_late");
  if (reason === "no-balance") return t("home.tile_no_balance");
  if (reason === "no-card-balance") return t("home.tile_no_card_balance");
  if (reason === "history") return t("home.buffer_history");
  if (reason === "cards") return t("home.low_cards");
  return t("home.tile_no_payday");
}

/** A range of sums as the page says one: the euro sign stands once, after the range, in Finnish ("120–480 €"). */
const range = (lowCents: number, highCents: number): string => {
  const low = answerMoney(lowCents);
  return `${language() === "en" ? low : low.replace(/\s*€$/, "")}–${answerMoney(highCents)}`;
};

/**
 * The line under the sum left to the payday: "Alin saldo 60 pv: 13.12., arviolta 120–480 €", core's `lowPoint` (the day
 * and the range of the lowest balance). While core has no figure it gives the reason and the line says it. Nothing is
 * added up or guessed here.
 */
export function LowPoint({ lowPoint }: { lowPoint: DashboardData["home"]["lowPoint"] }) {
  if (!lowPoint) return null;
  if (!lowPoint.known) {
    return (
      <p className="home-low" data-low="none">
        <span className="home-low-label">{t("home.low_label")}</span>
        {" "}
        <span className="home-low-status">{reasonText(lowPoint.reason)}</span>
      </p>
    );
  }
  return (
    <p className="home-low" data-low="known">
      {t("home.low", { days: String(lowPoint.days), date: dayMonth(lowPoint.date), range: range(lowPoint.lowCents, lowPoint.highCents) })}
    </p>
  );
}
