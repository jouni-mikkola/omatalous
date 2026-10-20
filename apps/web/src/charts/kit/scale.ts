import { niceTicks } from "../scale.ts";

/**
 * A linear scale: a value in data units (cents, a share, a count) to a pixel. `ticks` are the round values the axis
 * labels; the domain runs from the first to the last of them, so no mark is drawn outside the frame.
 */
export interface Linear {
  (v: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly ticks: readonly number[];
  readonly step: number;
  invert(px: number): number;
}

export interface LinearOptions {
  /** Keep zero inside the domain (bars and cumulative lines: a length is read from zero). Default true. */
  zero?: boolean;
  /** About how many tick steps the axis should have. */
  target?: number;
}

/**
 * The scale of a value axis. With `zero` (the default) the ticks are those of `valueAxis` in `../scale.ts`, so a chart
 * that moves onto this scale keeps its axis. Without it the domain hugs the values (a balance that moves between 10 000
 * and 12 000 €), still on round steps. `range` is `[bottom, top]` in pixels for a vertical axis.
 */
export function linear(values: readonly number[], range: readonly [number, number], { zero = true, target = 4 }: LinearOptions = {}): Linear {
  const finite = values.filter(Number.isFinite);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 0;
  if (zero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const step = niceTicks(Math.max(hi - lo, 1), target).ticks[1]!;
  const min = Math.floor(lo / step) * step || 0; // no "−0" tick
  const max = Math.max(Math.ceil(hi / step) * step, min + step);
  const ticks: number[] = [];
  // twelve at most: a bad step can never make an endless axis
  for (let v = min; v <= max + step / 2 && ticks.length < 12; v += step) ticks.push(v);
  const [r0, r1] = range;
  const scale = ((v: number) => r0 + ((v - min) / (max - min)) * (r1 - r0)) as Linear;
  return Object.assign(scale, {
    domain: [min, max] as const,
    range: [r0, r1] as const,
    ticks,
    step,
    invert: (px: number) => min + ((px - r0) / (r1 - r0)) * (max - min),
  });
}

/** Evenly spaced slots (a month's column, a day's cell): slot `i` starts at `x(i)` and is `step` wide, the mark `width` of it. */
export interface Band {
  readonly step: number;
  readonly width: number;
  x(i: number): number;
  centre(i: number): number;
  /** The slot under a pixel, clamped to the slots. */
  index(px: number): number;
}

/** `n` slots over `length` pixels; `inner` is the share of a slot the mark takes (the rest is air between marks). */
export function band(n: number, length: number, inner = 0.66): Band {
  const step = n > 0 ? length / n : 0;
  const width = step * inner;
  return {
    step,
    width,
    x: (i) => step * i + (step - width) / 2,
    centre: (i) => step * i + step / 2,
    index: (px) => (n > 0 ? Math.max(0, Math.min(n - 1, Math.floor(px / step))) : 0),
  };
}

/** Points spread from edge to edge (a line's days or months): one point sits in the middle. */
export function points(n: number, length: number): (i: number) => number {
  return (i) => (n > 1 ? (i / (n - 1)) * length : length / 2);
}

const DAY_MS = 86_400_000;

/** "2026-10-19" → days since 1970-01-01, by the calendar alone (UTC), so no time zone moves a day. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / DAY_MS;
}

/** The inverse of `dayNumber`. */
export function isoDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** A time axis over calendar days: `x(iso)` in pixels, `day(px)` the nearest day. */
export interface TimeScale {
  x(iso: string): number;
  day(px: number): string;
  readonly days: number;
}

export function time(from: string, to: string, length: number): TimeScale {
  const a = dayNumber(from);
  const span = Math.max(dayNumber(to) - a, 0);
  const at = points(span + 1, length);
  return {
    days: span + 1,
    x: (iso) => at(dayNumber(iso) - a),
    day: (px) => isoDay(a + Math.max(0, Math.min(span, span > 0 ? Math.round((px / length) * span) : 0))),
  };
}

/** The first days of the months a time axis crosses, `from` included when it is one. */
export function monthStarts(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  if (!from.endsWith("-01")) [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  for (let s = `${y}-${String(m).padStart(2, "0")}-01`; s <= to; ) {
    out.push(s);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
    s = `${y}-${String(m).padStart(2, "0")}-01`;
  }
  return out;
}
