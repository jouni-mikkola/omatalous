import { type Insight, insightDismissSubject } from "@banking/core";
import { query } from "../api.ts";
import "../styles/overview.css";

/** The tone shows as the card's left edge; screen readers get it as a word. */
const TONE: Record<Insight["tone"], string> = { good: "Hyvä", warning: "Huomio", info: "Tiedoksi" };

/** The mark subject of a dismissed insight; core decides when a changed figure brings it back. */
const dismissSubject = (i: Insight): string => insightDismissSubject(i);

export function Insights({ insights, onDismiss, busy }: { insights: Insight[]; onDismiss: (id: string, subject: string) => void; busy: boolean }) {
  if (!insights.length) return null;
  return (
    <div className="insights">
      {insights.map((i) => (
        <div key={i.id} className={`insight ${i.tone}`}>
          <span className="sr-only">{TONE[i.tone]}: </span>
          <div className="insight-title">{i.merchant ? <a href={`#/transactions${query({ merchant: i.merchant })}`}>{i.title}</a> : i.title}</div>
          {i.detail && <div className="insight-detail">{i.detail}</div>}
          <div className="insight-actions">
            <button className="btn btn-small" type="button" disabled={busy} aria-label={`Kuittaa: ${i.title}`} onClick={() => onDismiss(i.id, dismissSubject(i))}>
              Kuittaa
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
