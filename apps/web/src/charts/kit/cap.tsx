import { answerMoney } from "../../format.ts";

/** How far a clipped column runs past the end of the plot. */
export const CAP_OVERSHOOT = 6;

/** The sum written at a clipped column: whole euros, and "21 t€" on a narrow chart. */
export function capSum(cents: number, narrow: boolean): string {
  const size = Math.abs(cents);
  if (!narrow || size < 100_000) return answerMoney(cents);
  return `${cents < 0 ? "−" : ""}${Math.round(size / 100_000)} t€`;
}

/** `y` kept inside the plot and the overshoot past each end, where a clipped column stops. */
export function capY(y: number, innerH: number): number {
  return Math.min(innerH + CAP_OVERSHOOT, Math.max(-CAP_OVERSHOOT, y));
}

/** The two-stroke break across a clipped column, `end` being the y of its cut end and `dir` -1 for a top end, 1 for a bottom one. */
export function CapBreak({ x, width, end, dir }: { x: number; width: number; end: number; dir: -1 | 1 }) {
  const at = (n: number) => end - dir * n;
  return <path className="cap-break" d={`M${x - 1},${at(10)}L${x + width + 1},${at(14)}M${x - 1},${at(15)}L${x + width + 1},${at(19)}`} />;
}

/** The sum of a clipped column, past its cut end. */
export function CapSum({ x, end, dir, anchor = "middle", text }: { x: number; end: number; dir: -1 | 1; anchor?: "start" | "middle" | "end"; text: string }) {
  return (
    <text className="cap-sum" x={x} y={dir === -1 ? end - 4 : end + 12} textAnchor={anchor}>
      {text}
    </text>
  );
}
