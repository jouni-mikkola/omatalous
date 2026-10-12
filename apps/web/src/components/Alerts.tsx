import type { MarkKind } from "@banking/core";
import { query } from "../api.ts";
import type { DashboardData } from "../types.ts";
import "../styles/overview.css";

type Alert = DashboardData["alerts"][number];

/** What the household said about an alert: the alert it hides, and the mark to store (`alert:<id>`, or the subject of the series the question is about). */
type OnMark = (alertId: string, subject: string, mark: MarkKind) => void;

/**
 * Cost traps worth a look, above the insights. A row with a merchant or a
 * category opens those transactions; the tone shows as the left edge. Each row
 * can be dismissed, and the question about a forgotten service is answered
 * with Käytössä or Lopetettu.
 */
export function Alerts({ alerts, range, onMark, busy }: { alerts: Alert[]; range: { from: string; to: string }; onMark: OnMark; busy: boolean }) {
  if (!alerts.length) return null;
  // a merchant's whole history shows a double charge or a forgotten subscription in context;
  // a category is about the selected period
  const target = (a: Alert): Record<string, string> | null =>
    a.merchant ? { merchant: a.merchant } : a.category ? { category: a.category, from: range.from, to: range.to } : null;
  return (
    <ul className="alerts" aria-label="Huomiot">
      {alerts.map((a) => {
        const to = target(a);
        // an answer to the question about a forgotten service is a mark on that one series
        const subject = a.kind === "forgotten" ? a.markSubject : undefined;
        const body = (
          <>
            <span className="sr-only">{a.tone === "warning" ? "Huomio" : "Tiedoksi"}: </span>
            <span className="alert-title">{a.title}</span>
            {a.detail && <span className="alert-detail">{a.detail}</span>}
          </>
        );
        return (
          <li key={a.id} className={`alert ${a.tone}`}>
            {to ? <a href={`#/transactions${query(to)}`}>{body}</a> : <span className="alert-body">{body}</span>}
            <div className="alert-actions">
              {subject && a.merchant && (
                <>
                  <button className="btn btn-small" type="button" disabled={busy} aria-label={`Käytössä: ${a.merchant}`} onClick={() => onMark(a.id, subject, "in_use")}>
                    Käytössä
                  </button>
                  <button className="btn btn-small" type="button" disabled={busy} aria-label={`Lopetettu: ${a.merchant}`} onClick={() => onMark(a.id, subject, "cancelled")}>
                    Lopetettu
                  </button>
                </>
              )}
              <button className="btn btn-small" type="button" disabled={busy} aria-label={`Kuittaa: ${a.title}`} onClick={() => onMark(a.id, `alert:${a.id}`, "dismissed")}>
                Kuittaa
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
