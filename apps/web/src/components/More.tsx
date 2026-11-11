/**
 * The cut of a long list: the first `page` items, then "Näytä lisää" adds as many again. A list the household grows
 * (merchants, rules, the security log) would otherwise make its page metres long. Table's `page` draws the same
 * buttons under a table.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button.tsx";
import { t } from "../text.ts";
/**
 * The count and the buttons under a cut list; nothing when the list was short enough to show whole. The press that
 * shows the last items removes "Näytä lisää" and the press that folds the list removes "Näytä vähemmän": the focus
 * then moves to the button that is left. The count is spoken after a press, never when the list is first drawn.
 */
export function MoreButtons({ shown, total, step, onMore, onLess }: { shown: number; total: number; step: number; onMore: () => void; onLess: () => void }) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const lessRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<"more" | "less" | null>(null);
  const [spoken, setSpoken] = useState(false);
  // after the render a press caused: the pressed button is gone, so the one that is left takes the focus
  useEffect(() => {
    const was = pressed.current;
    if (!was) return;
    pressed.current = null;
    const [gone, left] = was === "more" ? [moreRef.current, lessRef.current] : [lessRef.current, moreRef.current];
    if (!gone) left?.focus();
  }, [shown]);
  if (total <= step) return null;
  const press = (which: "more" | "less", act: () => void) => () => {
    pressed.current = which;
    setSpoken(true);
    act();
  };
  return (
    <div className="rt-more">
      <span className="muted small">{`${shown} / ${total}`}</span>
      {/* empty until a press, so the first drawing of the list says nothing */}
      <span className="sr-only" role="status" aria-live="polite">
        {spoken ? t("table.shown", { count: shown, total }) : ""}
      </span>
      {shown < total && (
        <Button ref={moreRef} onClick={press("more", onMore)}>
          {t("more.show_n", { count: Math.min(step, total - shown) })}
        </Button>
      )}
      {shown > step && (
        <Button ref={lessRef} variant="link" onClick={press("less", onLess)}>
          {t("more.show_less")}
        </Button>
      )}
    </div>
  );
}

/** The items to draw now and the buttons to put under them. */
export function useMore<T>(items: readonly T[], step: number): { shown: readonly T[]; more: ReactNode } {
  const [limit, setLimit] = useState(step);
  const shown = items.length > step ? items.slice(0, limit) : items;
  return {
    shown,
    more: <MoreButtons shown={shown.length} total={items.length} step={step} onMore={() => setLimit((n) => n + step)} onLess={() => setLimit(step)} />,
  };
}
