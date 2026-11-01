/**
 * Decision: none of its own. The windowing of a long grouped table: only the groups near the screen are drawn, two
 * spacers stand in for the rest, so a year of rows is a few dozen in the page. The page scrolls (no inner box). Heights
 * are measured as groups are drawn; a group never drawn is estimated from the rows measured so far. Pure but for the hook.
 */
import { type FocusEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";

/** A table with more rows than this is windowed. */
export const WINDOW_MIN_ROWS = 200;
/** How far past the screen, in px, groups are drawn. */
export const OVERSCAN_PX = 200;
/** A group's height per row before any is measured (its head counts as one row). */
export const UNIT_PX = 44;
/** The groups kept around the one that holds the focus, so a Tab finds the next row. */
const PIN_GROUPS = 2;
/** How far the spacers may stand from the measured heights before the table is drawn again for them. */
const SPACER_SLACK_PX = 2 * UNIT_PX;

export type Viewport = { top: number; bottom: number };
export type WindowSpan = { from: number; to: number; before: number; after: number };

/** The groups to draw: [from, to) around the viewport, with the height of what is left out before and after. */
export function windowSpan(
  heights: ReadonlyMap<string, number>,
  keys: readonly string[],
  weights: readonly number[],
  view: Viewport,
  pin: { from: number; to: number } | null = null,
): WindowSpan {
  let measured = 0;
  let measuredWeight = 0;
  keys.forEach((k, i) => {
    const h = heights.get(k);
    if (h !== undefined) {
      measured += h;
      measuredWeight += weights[i] ?? 1;
    }
  });
  const unit = measuredWeight > 0 ? measured / measuredWeight : UNIT_PX;
  const size = keys.map((k, i) => heights.get(k) ?? (weights[i] ?? 1) * unit);
  const lo = view.top - OVERSCAN_PX;
  const hi = view.bottom + OVERSCAN_PX;
  let from = keys.length;
  let to = 0;
  let at = 0;
  size.forEach((h, i) => {
    if (at + h > lo && at < hi) {
      from = Math.min(from, i);
      to = Math.max(to, i + 1);
    }
    at += h;
  });
  // the viewport is past the end or before the start: keep the nearest group so the table is never empty
  if (from >= to) {
    from = view.top > 0 ? Math.max(0, keys.length - 1) : 0;
    to = Math.min(keys.length, from + 1);
  }
  if (pin && pin.from < to && from < pin.to) {
    from = Math.min(from, pin.from);
    to = Math.max(to, pin.to);
  }
  const sum = (a: number, b: number) => size.slice(a, b).reduce((n, h) => n + h, 0);
  return { from, to, before: sum(0, from), after: sum(to, keys.length) };
}

export type TableWindow = WindowSpan & {
  /** On the wrap: keeps the groups around a focused row drawn. */
  onFocus: (e: FocusEvent) => void;
};

/** The window of a table whose groups are the `<tbody data-vkey>` elements inside `wrap`; null while `enabled` is false. */
export function useWindow(wrap: RefObject<HTMLElement | null>, keys: readonly string[], weights: readonly number[], enabled: boolean): TableWindow | null {
  const heights = useRef(new Map<string, number>());
  // the first draw assumes the table starts at the top of the screen, so that the layout effect below seldom has to draw again
  const viewport = useRef<Viewport>({ top: 0, bottom: typeof window === "undefined" ? 0 : window.innerHeight });
  const pin = useRef<{ from: number; to: number } | null>(null);
  const [, redraw] = useState(0);
  const latest = useRef({ keys, weights });
  latest.current = { keys, weights };
  const span = windowSpan(heights.current, keys, weights, viewport.current, pin.current);
  const drawn = useRef(span);
  drawn.current = span;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!enabled || !el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const top = -el.getBoundingClientRect().top;
      viewport.current = { top, bottom: top + window.innerHeight };
      if (pin.current && !el.contains(document.activeElement)) pin.current = null;
      const next = windowSpan(heights.current, latest.current.keys, latest.current.weights, viewport.current, pin.current);
      if (next.from !== drawn.current.from || next.to !== drawn.current.to) redraw((n) => n + 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const resized = () => {
      heights.current.clear();
      schedule();
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resized);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resized);
    };
  }, [enabled, wrap]);

  // after every draw: the heights of the groups on the screen, so the spacers and the estimate follow the truth
  useLayoutEffect(() => {
    if (!enabled) return;
    let changed = false;
    for (const body of wrap.current?.querySelectorAll<HTMLElement>("tbody[data-vkey]") ?? []) {
      const key = body.dataset.vkey!;
      const h = body.offsetHeight;
      if (Math.abs((heights.current.get(key) ?? -1) - h) >= 1) {
        heights.current.set(key, h);
        changed = true;
      }
    }
    if (!changed) return;
    // the spacers follow the measured heights, but a draw for a few pixels of them would only repeat the work of the rows
    const next = windowSpan(heights.current, latest.current.keys, latest.current.weights, viewport.current, pin.current);
    const was = drawn.current;
    if (next.from !== was.from || next.to !== was.to || Math.abs(next.before - was.before) + Math.abs(next.after - was.after) >= SPACER_SLACK_PX) redraw((n) => n + 1);
  });

  if (!enabled) return null;
  const onFocus = (e: FocusEvent) => {
    const key = (e.target as Element).closest<HTMLElement>("tbody[data-vkey]")?.dataset.vkey;
    const at = key === undefined ? -1 : latest.current.keys.indexOf(key);
    if (at < 0) return;
    const next = { from: Math.max(0, at - PIN_GROUPS), to: at + PIN_GROUPS + 1 };
    if (pin.current?.from === next.from && pin.current.to === next.to) return;
    pin.current = next;
    redraw((n) => n + 1);
  };
  return { ...span, onFocus };
}
