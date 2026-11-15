import type { ReactNode } from "react";
import "../styles/estimate.css";

/** How an estimate shows: "≈" before the figure (`approx`), or a dotted underline (`line`) where the sign does not fit. */
export type EstimateMark = "approx" | "line";

/**
 * An estimate's figure, the one mark the app has: "≈" before it, or the dotted underline in a narrow cell. An exact
 * figure, a zero above all, wears neither, so `when` false gives the figure as it is. A chart draws an estimate's
 * line with `est-line` (estimate.css, the token `--estimate-edge`).
 */
export function Estimate({ when = true, mark = "approx", children }: { when?: boolean; mark?: EstimateMark; children: ReactNode }) {
  if (!when) return <>{children}</>;
  if (mark === "line") return <span className="fig-est">{children}</span>;
  return (
    <span className="fig-approx">
      <span className="fig-approx-sign">≈</span>
      {children}
    </span>
  );
}

/** The same mark where the figure is plain text (a datum, a cell, a sentence a screen reader reads): "≈ 12,40 €". */
export { approxText } from "../approx.ts";
