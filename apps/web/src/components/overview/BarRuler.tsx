import type { CSSProperties } from "react";
import type { Ruler } from "./ruler.ts";

/** The `--bar-step` a table with a ruler carries: the lines of its bar column repeat at this distance. */
export const rulerStyle = (ruler: Ruler | null): CSSProperties | undefined => (ruler ? ({ "--bar-step": ruler.step } as CSSProperties) : undefined);

/** The head cell of the bar column: the ruler with its first and last value, or the empty cell where there is no ruler. */
export function BarRuler({ ruler, className = "" }: { ruler: Ruler | null; className?: string }) {
  if (!ruler) return <td className={`category-bar ${className}`.trim()} />;
  return (
    <th className={`category-bar bar-ruler ${className}`.trim()} aria-hidden="true">
      {ruler.ticks.map((t) => t.label !== null && <i key={t.at} style={{ left: `${t.at}%` }}>{t.label}</i>)}
    </th>
  );
}
