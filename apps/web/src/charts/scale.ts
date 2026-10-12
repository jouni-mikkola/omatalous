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

/**
 * Value axis of a line chart: round ticks from zero, or from the lowest value when it is below zero, to the highest.
 * `at` is the place of a value on it as a share of the height, 0 on the bottom line and 1 on the top one: the lowest
 * value is on the axis, so no line is drawn outside the frame.
 */
export function valueAxis(values: readonly number[], target = 4): { ticks: number[]; at: (v: number) => number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  // one step for the whole span: a step taken from the positive side alone becomes tiny when
  // everything is negative (a credit card only) and the tick loop never ends
  const step = niceTicks(Math.max(hi - lo, 1), target).ticks[1]!;
  const min = Math.floor(lo / step) * step || 0; // avoid a "−0 €" tick
  const max = Math.max(Math.ceil(hi / step) * step, min + step);
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2 && ticks.length < 12; v += step) ticks.push(v);
  return { ticks, at: (v) => (v - min) / (max - min) };
}

/** Column with a 4px rounded data-end and a square base. */
export function roundedTop(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
