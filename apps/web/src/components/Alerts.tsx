import { query } from "../api.ts";
import type { DashboardData } from "../types.ts";
import "../styles/overview.css";

type Alert = DashboardData["alerts"][number];

/**
 * Cost traps worth a look, above the insights. A row with a merchant or a
 * category opens those transactions; the tone shows as the left edge.
 */
export function Alerts({ alerts, range }: { alerts: Alert[]; range: { from: string; to: string } }) {
  if (!alerts.length) return null;
  // a merchant's whole history shows a double charge or a forgotten subscription in context;
  // a category is about the selected period
  const target = (a: Alert): Record<string, string> | null =>
    a.merchant ? { merchant: a.merchant } : a.category ? { category: a.category, from: range.from, to: range.to } : null;
  return (
    <ul className="alerts" aria-label="Huomiot">
      {alerts.map((a) => {
        const to = target(a);
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
          </li>
        );
      })}
    </ul>
  );
}
