// Decision: does the money on the accounts cover the months ahead, or is a saving or a cut needed now
import { money, oneDecimal } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

type Direction = DashboardData["home"]["direction"];

/**
 * The buffer line at the foot of Varat ja velat: "Puskuri 1,4 kk", core's `bufferMonths`, and a drill with the two sums
 * the months divide (`bufferNetCents` by `bufferSpendCents`). While core has no figure it gives the reason
 * (`bufferGap`) and the line says it: "Ei saldoa" or "Liian lyhyt historia". Nothing is added up or guessed here.
 */
export function Buffer({ direction }: { direction: Direction }) {
  const { bufferMonths, bufferNetCents, bufferSpendCents, bufferGap } = direction;
  if (bufferMonths === null || bufferNetCents === null || bufferSpendCents === null) {
    if (bufferGap === null) return null;
    return (
      <div className="home-buffer" data-buffer="none">
        <span className="home-buffer-label">{t("home.buffer_label")}</span>
        {" "}
        <span className="home-buffer-status">{bufferGap === "no-balance" ? t("home.buffer_no_balance") : t("home.buffer_history")}</span>
      </div>
    );
  }
  return (
    <details className="home-buffer" data-buffer="months">
      <summary>{t("home.buffer", { months: oneDecimal(bufferMonths) })}</summary>
      <dl className="st-rows">
        <div className="st-row">
          <dt className="st-name">{t("home.buffer_net")}</dt>
          <dd className="st-num">{money(bufferNetCents)}</dd>
        </div>
        <div className="st-row">
          <dt className="st-name">{t("home.buffer_spend")}</dt>
          <dd className="st-num">{money(bufferSpendCents)}</dd>
        </div>
      </dl>
    </details>
  );
}
