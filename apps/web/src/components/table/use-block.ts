import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** A table is a table from this much room; under it, or when its columns need more than there is, each row is a block. */
const BLOCK_BELOW = 600;
/** A table of this many columns or fewer (a day, a name, a sum) keeps its columns on a phone as long as they fit. */
export const SLIM = 3;

/**
 * Whether the wrap is too narrow for its table: under 600 px for a table of more than three columns, and for any table
 * whose columns want more than the wrap has. It asks the room the wrap has and the room the columns want, so a table
 * in a half-width card flips to blocks exactly when its figures would no longer fit, and flips back when they do. The
 * measure runs before the browser paints, so no one sees the wide table first.
 */
export function useBlock(slim: boolean): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [block, setBlock] = useState(false);
  const need = useRef(0);
  const state = useRef(false);
  const measure = () => {
    const el = ref.current;
    const table = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !table) return;
    const room = el.clientWidth;
    let next = state.current;
    if (!state.current) {
      if ((room < BLOCK_BELOW && !slim) || table.scrollWidth > room + 1) {
        need.current = Math.max(BLOCK_BELOW, table.scrollWidth);
        next = true;
      }
    } else if (room >= need.current) {
      next = false;
    }
    if (next !== state.current) {
      state.current = next;
      setBlock(next);
    }
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, block];
}
