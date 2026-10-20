/**
 * Asetukset > Tilit, under an account: "Täsmää pankin saldoon". A tick when the newest stretch of the bank's balances
 * is the sum of the account's rows to the cent, else the reason. Opened, the stretches that match, with the days, and
 * where the walk back from the newest day stopped. The server works it out (`reconcile`, core); this only draws it.
 */
import type { ReconcileResult } from "@banking/core";
import { periodText, reconcileView } from "./reconcile-text.ts";
import "../../styles/reconcile.css";

export function Reconcile({ result }: { result: ReconcileResult }) {
  const view = reconcileView(result);
  // one flow of text: the tick before the words, or the reason after them, so it wraps as a sentence
  const line = (
    <>
      {view.proved && (
        <span role="img" aria-label="täsmää">
          ✓{" "}
        </span>
      )}
      {view.headline}
    </>
  );
  if (!view.rows.length) return <div className="acc-rec acc-rec-plain">{line}</div>;
  return (
    <details className="acc-rec">
      <summary>{line}</summary>
      <ul className="acc-rec-rows">
        {view.rows.map((r) => (
          <li key={`${r.from}-${r.to}`} className={r.stop ? "stop" : undefined}>
            {`${periodText(r)}, ${r.days}, ${r.text}`}
          </li>
        ))}
        {view.after && <li className="stop">{view.after}</li>}
      </ul>
    </details>
  );
}
