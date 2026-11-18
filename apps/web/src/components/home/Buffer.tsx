// Decision: does the money on the accounts cover the months ahead, or is a saving or a cut needed now
import { money, oneDecimal } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

type Direction = DashboardData["home"]["direction"];

const GAP_TEXT = { "no-balance": "home.buffer_no_balance", history: "home.buffer_history", "no-spending": "home.buffer_no_spending" } as const;

/**
 * The buffer line at the foot of Varat ja velat: "Puskuri 1,4 kk", core's `bufferMonths`, and a drill with the two sums
 * the months divide (`bufferNetCents` by `bufferSpendCents`). While core has no figure it gives the reason
 * (`bufferGap`) and the line says it: "Ei saldoa", "Liian lyhyt historia" or "Ei menoja". Nothing is added up or guessed here.
 * A negative figure is shown as it is.
 */
export function Buffer({ direction }: { direction: Direction }) {
  const { bufferMonths, bufferNetCents, bufferSpendCents, bufferGap } = direction;
  if (bufferMonths === null || bufferNetCents === null || bufferSpendCents === null) {
    if (bufferGap === null) return null;
    return (
      <div className="home-buffer" data-buffer="none">
        <span className="home-buffer-label">{t("home.buffer_label")}</span>
        {" "}
        <span className="home-buffer-status">{t(GAP_TEXT[bufferGap])}</span>
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
