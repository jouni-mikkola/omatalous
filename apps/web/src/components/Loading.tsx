import { useEffect, useState } from "react";

/**
 * Placeholder while a page's data is on its way. Silent for the first moment so a fast
 * answer does not flash, a hint when the wait gets long.
 */
export function Loading() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setStage(1), 250);
    const b = window.setTimeout(() => setStage(2), 6000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  return (
    <div className="stack" role="status" aria-live="polite" style={{ visibility: stage ? "visible" : "hidden" }}>
      <div className="grid kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card skeleton" />
        ))}
      </div>
      <div className="card skeleton skeleton-tall" aria-hidden="true" />
      <div className="empty">{stage === 2 ? "Tämä kestää tavallista kauemmin. Odota hetki tai lataa sivu uudelleen." : "Ladataan…"}</div>
    </div>
  );
}
