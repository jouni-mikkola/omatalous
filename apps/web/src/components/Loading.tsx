import { useEffect, useState } from "react";

/**
 * Placeholder while a page's data is on its way. Silent for the first moment so a fast
 * answer does not flash, a hint when the wait gets long. The frames are the page's own panels at their final size,
 * with grey bars where the name, the figures and the rows will stand, so nothing moves when the answer lands (VD0).
 * `shape` "overview" adds the key figures strip above them and puts the chart first, as Yhteenveto has it.
 */
export function Loading({ shape }: { shape?: "overview" } = {}) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setStage(1), 250);
    const b = window.setTimeout(() => setStage(2), 6000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  const plotCard = (
    <div className="card skeleton skeleton-tall" aria-hidden="true">
      <span className="sk-bar sk-head" />
      <span className="sk-bar sk-plot" />
    </div>
  );
  return (
    <div className="stack" role="status" aria-live="polite" style={{ visibility: stage ? "visible" : "hidden" }}>
      {shape === "overview" && (
        <div className="key-figures sk-strip" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kf">
              <span className="sk-bar sk-label" />
              <span className="sk-bar sk-fig" />
              <span className="sk-bar sk-sub" />
            </div>
          ))}
        </div>
      )}
      {/* Yhteenveto opens on its pace chart, then the panels of rows */}
      {shape === "overview" && plotCard}
      <div className="card skeleton" aria-hidden="true">
        <span className="sk-bar sk-head" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sk-row">
            <span className="sk-bar sk-name" />
            <span className="sk-bar sk-num" />
          </span>
        ))}
      </div>
      {shape !== "overview" && plotCard}
      <div className="empty">{stage === 2 ? "Lataus kestää tavallista kauemmin. Odota tai lataa sivu uudelleen." : "Ladataan…"}</div>
    </div>
  );
}
