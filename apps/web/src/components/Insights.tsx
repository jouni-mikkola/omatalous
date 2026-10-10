import type { Insight } from "@banking/core";

/** The tone shows as the card's left edge; screen readers get it as a word. */
const TONE: Record<Insight["tone"], string> = { good: "Hyvä", warning: "Huomio", info: "Tiedoksi" };

export function Insights({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <div className="insights">
      {insights.map((i) => (
        <div key={i.id} className={`insight ${i.tone}`}>
          <span className="sr-only">{TONE[i.tone]}: </span>
          <div className="insight-title">{i.title}</div>
          {i.detail && <div className="insight-detail">{i.detail}</div>}
        </div>
      ))}
    </div>
  );
}
