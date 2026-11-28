/**
 * Decision: which stretch of a chart's marks (the days after payday, the dear months) the household looks at, chosen by
 * dragging across them or with Shift and the arrows.
 *
 * A span is two mark indexes, the one where it began (`anchor`) and the one it reaches (`head`), either side of the
 * other. The pointer presses on a mark, drags and lets go; the keys move the head from the focused mark. The chart turns
 * the bounds into keys or dates and sends them on (`onSpan`): the table under it, or the address of the page. Escape
 * lets go (`onRelease`). A press and release on one mark is a span of one mark, sent on only when the chart asks for it (`tap`); bounds show only once the pointer has left the pressed mark or a key moved the span.
 */
import { type KeyboardEvent, type PointerEvent, useCallback, useRef, useState } from "react";

export interface Span {
  anchor: number;
  head: number;
}

/** The first and last mark of a span, whichever way it was drawn. */
export const spanBounds = (s: Span): [number, number] => (s.anchor <= s.head ? [s.anchor, s.head] : [s.head, s.anchor]);

/** The mark under an x position of a plot `width` wide that starts at `left`, for `n` equal slices; the ends take what lies outside. */
export function indexAtX(x: number, left: number, width: number, n: number): number {
  if (n <= 0 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor(((x - left) / width) * n)));
}

/** What a key does to the span while the focus is on mark `at` of `n`. `span` is the new span (null: none), `moved` the mark the focus goes to, `commit` that the span is to be sent on, `release` that Escape let go. */
export interface SpanKey {
  span: Span | null;
  moved: number | null;
  commit: boolean;
  release: boolean;
}

const STEP: Record<string, (head: number, n: number) => number> = {
  ArrowLeft: (h) => h - 1,
  ArrowRight: (h) => h + 1,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * Shift with an arrow, Home or End widens or narrows the span from the focused mark; Enter or Space sends a span on
 * (`commit`); Escape lets go. Null when the key is none of these, so the chart's own keys go on working.
 */
export function spanKey(key: string, shift: boolean, span: Span | null, at: number, n: number, taken = false): SpanKey | null {
  if (key === "Escape") return span || taken ? { span: null, moved: null, commit: false, release: true } : null;
  if ((key === "Enter" || key === " ") && span) return { span, moved: null, commit: true, release: false };
  const step = STEP[key];
  if (!shift || !step || n <= 0) return null;
  const from = span ?? { anchor: at, head: at };
  const head = Math.min(n - 1, Math.max(0, step(from.head, n)));
  return { span: { anchor: from.anchor, head }, moved: head, commit: false, release: false };
}

interface SpanHandlers {
  onPointerDown: (e: PointerEvent<Element>) => void;
  onPointerMove: (e: PointerEvent<Element>) => void;
  onPointerUp: (e: PointerEvent<Element>) => void;
  onPointerCancel: () => void;
}

/**
 * The span of one chart. `indexOf` turns a pointer event into a mark index; `onSpan` gets the bounds when the pointer is
 * let go over the chart or a key commits; `live` sends them at every change of the span too (a chart whose table
 * follows in the browser), where a chart whose change reloads the page waits for the release. `onRelease` is Escape; `taken` says a span
 * is held outside the chart (the table's), so Escape has something to let go of with none in progress. `tap` false: a press and release on one mark sends nothing (the mark is a link).
 */
export function useSpan({ n, indexOf, onSpan, onRelease, live = false, taken = false, tap = true }: { n: number; indexOf: (e: PointerEvent<Element>) => number; onSpan: (from: number, to: number) => void; onRelease?: () => void; live?: boolean; taken?: boolean; tap?: boolean }) {
  const [span, setSpan] = useState<Span | null>(null);
  /** The mark the press began on; null while the pointer is up. */
  const down = useRef<number | null>(null);
  /** True from a drag over more than one mark until the click that ends it, so the chart can leave that click alone. */
  const dragged = useRef(false);
  const clear = useCallback(() => setSpan(null), []);
  const change = (next: Span | null) => {
    setSpan(next);
    if (live && next) onSpan(...spanBounds(next));
  };
  const handlers: SpanHandlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const i = indexOf(e);
      down.current = i;
      dragged.current = false;
      setSpan({ anchor: i, head: i });
    },
    onPointerMove: (e) => {
      if (down.current === null) return;
      if (e.buttons === 0) {
        // the button was let go outside the chart before the pointer was captured
        down.current = null;
        setSpan(null);
        return;
      }
      const head = indexOf(e);
      // once on another mark the pointer is held, so a drag that leaves the plot still ends on the chart; held from the press it would take the click of a tap from its link
      if (head !== down.current && !e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.setPointerCapture?.(e.pointerId);
      setSpan((now) => {
        if (!now || now.head === head) return now;
        if (head !== now.anchor) dragged.current = true;
        return { anchor: now.anchor, head };
      });
    },
    onPointerUp: (e) => {
      if (down.current === null) return;
      const head = indexOf(e);
      const next = { anchor: down.current, head };
      down.current = null;
      if (next.anchor !== head) dragged.current = true;
      // once let go the span belongs to whoever took it (the table, the address), the chart draws that one
      setSpan(null);
      if (tap || next.anchor !== head) onSpan(...spanBounds(next));
    },
    onPointerCancel: () => {
      down.current = null;
      setSpan(null);
    },
  };
  /** The keys of the span; true when the key was one of its own and its default action is stopped. */
  const keys = (e: KeyboardEvent<Element>, at: number, focusAt?: (i: number) => void): boolean => {
    // a press whose release was missed leaves a span that no key may commit
    if (down.current !== null) return false;
    const k = spanKey(e.key, e.shiftKey, span, at, n, taken);
    if (!k) return false;
    e.preventDefault();
    if (k.release) {
      setSpan(null);
      onRelease?.();
    } else if (k.commit && k.span) {
      // the span now belongs to whoever took it; kept, its indexes would outlive the marks of the new period
      setSpan(null);
      onSpan(...spanBounds(k.span));
    } else change(k.span);
    if (k.moved !== null) focusAt?.(k.moved);
    return true;
  };
  // a press with no drag is a tap: nothing of a span to show until the pointer leaves its mark or a key moves it
  const shown = span && (span.anchor !== span.head || down.current === null) ? span : null;
  return { span, bounds: shown ? spanBounds(shown) : null, handlers, keys, dragged, clear };
}
