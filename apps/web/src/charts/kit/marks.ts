/**
 * Decision: how a chart made of separate marks (a line of a slope, a month column, a cell) is read like every other chart.
 *
 * `ReadoutLayer` covers a plot with one hit area. A form whose marks are shapes of their own uses `useMarks` instead:
 * one tab stop (the others are reached with the arrows), the pointer or focus puts the readout on a mark, arrows,
 * Home, End and the Page keys move from mark to mark, Enter, Space or a click sends the mark's key to the table under
 * the chart, Escape lets go of the readout and then of the pick. The readout sentence goes to a `LiveReadout`.
 */
import { type KeyboardEvent, useRef, useState } from "react";
import { useSelect } from "../../components/table/selection.tsx";
import { stepIndex } from "./readout.ts";

/**
 * What a key does on mark `i` of `n`: Enter and Space pick it, Escape lets go of the pick, the move keys of `stepIndex`
 * focus another mark (`focusAt`). True when the key was the chart's, and the default action is then stopped.
 */
export function markKey(e: KeyboardEvent<Element>, i: number, n: number, act: { pick?: () => void; unpick?: () => void; focusAt: (next: number) => void }): boolean {
  if (act.pick && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    act.pick();
    return true;
  }
  if (e.key === "Escape" && act.unpick) {
    e.preventDefault();
    act.unpick();
    return true;
  }
  const next = stepIndex(e.key, i, n);
  if (next === undefined || next === null) return false;
  e.preventDefault();
  act.focusAt(next);
  return true;
}

export interface MarkProps {
  ref: (el: Element | null) => void;
  tabIndex: number;
  onFocus: () => void;
  onBlur: () => void;
  onPointerEnter: () => void;
  onPointerLeave: (e: { pointerType: string }) => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<Element>) => void;
}

export function useMarks(keys: readonly string[], onSelect?: (key: string) => void) {
  const scope = useSelect();
  const [at, setAt] = useState<number | null>(null);
  const els = useRef<(Element | null)[]>([]);
  const send = onSelect ?? (scope ? (key: string) => scope.select(key) : undefined);
  /** The props of mark `i`: spread them on the focusable element of the mark. */
  const mark = (i: number): MarkProps => ({
    ref: (el) => {
      els.current[i] = el;
    },
    // the one tab stop is the mark the readout is on, the first one before it
    tabIndex: i === (at ?? 0) ? 0 : -1,
    onFocus: () => setAt(i),
    onBlur: () => setAt(null),
    onPointerEnter: () => setAt(i),
    onPointerLeave: (e) => e.pointerType === "mouse" && setAt(null),
    onClick: () => keys[i] !== undefined && send?.(keys[i]!),
    onKeyDown: (e) =>
      markKey(e, i, keys.length, {
        pick: send && keys[i] !== undefined ? () => send(keys[i]!) : undefined,
        unpick: scope?.selected ? () => scope.select(null) : undefined,
        focusAt: (next) => (els.current[next] as HTMLElement | SVGElement | null)?.focus(),
      }),
  });
  return { at, setAt, mark, picked: scope?.selected ?? null, selectable: send !== undefined };
}
