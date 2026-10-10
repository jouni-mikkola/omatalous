/** Round axis: max 1234 → ticks 0, 500, 1000, 1500. */
export function niceTicks(maxValue: number, target = 4): { ticks: number[]; max: number } {
  if (maxValue <= 0) return { ticks: [0, 1], max: 1 };
  const rough = maxValue / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return { ticks, max };
}

/** Column with a 4px rounded data-end and a square base. */
export function roundedTop(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
