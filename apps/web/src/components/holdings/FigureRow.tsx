/** One line of a `<dl>` of figures: its label and its value. `warn` colours both, for what has gone over. */
import type { ReactNode } from "react";

export function FigureRow({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className={warn ? "holding-figure-warn" : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
