// Decision: do the accounts dip below what the household can live with before the money after the next payday arrives
import { answerMoney, dayMonth } from "../../format.ts";
import { LOAN_TERMS_HASH, SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../../routes.ts";
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
  if (reason === "bills") return t("home.low_bills");
  return t("home.tile_no_payday");
}

/** The reasons that a fetch of the balances mends: Asetukset > Pankit ja tilit tells when each account was last fetched. */
const FETCH_REASONS: readonly string[] = ["no-balance", "no-card-balance"];

/**
 * Where a reason is mended: a fetch of the balances, the cards' rows of Täydennä lainat while one is open (core says so),
 * else the statement's upload, or the bill that has no sum. Other reasons have no page.
 */
function linkOf({ reason, cardRowOpen }: Extract<Low, { known: false }>): string | undefined {
  if (FETCH_REASONS.includes(reason)) return settingsHash("banks");
  if (reason === "cards") return cardRowOpen === false ? settingsCardHash(SETTINGS_ANCHOR.statement) : LOAN_TERMS_HASH;
  if (reason === "bills") return "#/bills";
  return undefined;
}

/**
 * The line under the sum left on the payday: "Alin saldo 60 pv: 13.12., arviolta 120 €", core's `lowPoint` (the day
 * and the sum of the lowest balance, whose range stays in the answer). While core has no figure it gives the reason and the line says it. Nothing is
 * added up or guessed here.
 */
export function LowPoint({ lowPoint }: { lowPoint: DashboardData["home"]["lowPoint"] }) {
  if (!lowPoint) return null;
  if (!lowPoint.known) {
    return (
      <p className="home-low" data-low="none">
        <span className="home-low-label">{t("home.low_label", { days: String(lowPoint.days) })}</span>
        {" "}
        <span className="home-low-status">
          {linkOf(lowPoint) ? <a href={linkOf(lowPoint)}>{reasonText(lowPoint.reason)}</a> : reasonText(lowPoint.reason)}
        </span>
      </p>
    );
  }
  return (
    <p className="home-low" data-low="known">
      {t("home.low", { days: String(lowPoint.days), date: dayMonth(lowPoint.date), sum: answerMoney(lowPoint.cents) })}
    </p>
  );
}
