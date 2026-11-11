/** One row of a `<dl>` of figures in the statement look: its label at the left and its value at the right; `bad` draws the value in the colour of what is wrong. */
import type { ReactNode } from "react";

export function FigureRow({ label, bad = false, children }: { label: string; bad?: boolean; children: ReactNode }) {
  return (
    <div className="st-row">
      <dt className="st-name holding-label">{label}</dt>
      <dd className={bad ? "st-num holding-bad" : "st-num"}>{children}</dd>
    </div>
  );
}
