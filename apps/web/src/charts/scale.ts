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

/** The axis a step gives over `lo`..`hi`: its bottom and top tick, the top at least one step up. */
function reach(lo: number, hi: number, step: number): { min: number; max: number } {
  const min = Math.floor(lo / step) * step || 0; // avoid a "−0 €" tick
  return { min, max: Math.max(Math.ceil(hi / step) * step, min + step) };
}

/**
 * The step of a value axis over `lo`..`hi`: the smallest round step that gives about `target` steps. When that axis
 * runs more than a third of the span past the values (2 023 600 on two steps gives a top of 4 000 000), the round
 * step with the shortest axis that has from `target` to `target` + 1 steps wins instead (a top of 3 000 000). One
 * step for the whole span: a step taken from the positive side alone becomes tiny when everything is negative (a
 * credit card only) and the tick loop never ends.
 */
export function axisStep(lo: number, hi: number, target = 4): number {
  const span = Math.max(hi - lo, 1);
  const usual = niceTicks(span, target).ticks[1]!;
  const length = (step: number) => {
    const { min, max } = reach(lo, hi, step);
    return max - min;
  };
  if (length(usual) - span <= span / 3) return usual;
  let best = usual;
  const power = Math.floor(Math.log10(usual));
  for (const exponent of [power - 1, power]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** exponent;
      const steps = Math.round(length(step) / step);
      if (steps < Math.max(2, target) || steps > target + 1) continue;
      if (length(step) < length(best) || (length(step) === length(best) && step > best)) best = step;
    }
  }
  return best;
}

/**
 * Value axis of a line chart: round ticks from zero, or from the lowest value when it is below zero, to the highest.
 * `at` is the place of a value on it as a share of the height, 0 on the bottom line and 1 on the top one: the lowest
 * value is on the axis, so no line is drawn outside the frame.
 */
export function valueAxis(values: readonly number[], target = 4): { ticks: number[]; at: (v: number) => number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = axisStep(lo, hi, target);
  const { min, max } = reach(lo, hi, step);
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2 && ticks.length < 12; v += step) ticks.push(v);
  return { ticks, at: (v) => (v - min) / (max - min) };
}

/**
 * The ticks that can be printed: whole cents. A tiny maximum (a cent, nothing) gives the axis a step of a quarter
 * of a cent, whose ticks would all be printed as the same amount.
 */
export function wholeTicks(ticks: readonly number[]): number[] {
  return ticks.filter((t) => Number.isInteger(t));
}

/** The ticks of a bar axis (see `niceTicks`): with nothing above zero to measure, the zero line alone. */
export function barTicks(dataMax: number, target = 4): { ticks: number[]; max: number } {
  const { ticks, max } = niceTicks(dataMax, target);
  return { ticks: dataMax > 0 ? wholeTicks(ticks) : [0], max };
}

/** Column with a square-cornered data-end (a 1 px radius) and a square base. */
export function roundedTop(x: number, y: number, w: number, h: number, r = 1): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
