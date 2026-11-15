/**
 * Paths of the line forms. Values are `null` where there is no datum: the pen lifts there, so a gap is never drawn as
 * a slope. `keep` is the indices to draw (see `decimate`); without it every index is drawn.
 */
type Px = (i: number) => number;

export function linePath(values: readonly (number | null)[], x: Px, y: (v: number) => number, keep?: readonly number[]): string {
  let d = "";
  let pen = false;
  for (const i of keep ?? values.keys()) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** A step line: the value holds until the next one (a price, a payment), then changes at once. */
export function stepPath(values: readonly (number | null)[], x: Px, y: (v: number) => number): string {
  let d = "";
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      prev = null;
      return;
    }
    const px = x(i).toFixed(1);
    d += prev === null ? `M${px},${y(v).toFixed(1)}` : `H${px}V${y(v).toFixed(1)}`;
    prev = v;
  });
  return d;
}

/** The area between two lines (a stack's layer, a usual band): `lower` and `upper` index for index, a gap ends a piece. */
export function areaPath(lower: readonly (number | null)[], upper: readonly (number | null)[], x: Px, y: (v: number) => number): string {
  const pieces: number[][] = [];
  let run: number[] = [];
  upper.forEach((u, i) => {
    if (u === null || lower[i] === null || lower[i] === undefined) {
      if (run.length) pieces.push(run);
      run = [];
    } else run.push(i);
  });
  if (run.length) pieces.push(run);
  return pieces
    .map((p) => {
      const top = p.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(upper[i]!).toFixed(1)}`).join("");
      const bottom = [...p].reverse().map((i) => `L${x(i).toFixed(1)},${y(lower[i]!).toFixed(1)}`).join("");
      return `${top}${bottom}Z`;
    })
    .join("");
}
