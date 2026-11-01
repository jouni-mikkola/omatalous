/**
 * The cut of a long list: the first `page` items, then "Näytä lisää" adds as many again. A list the household grows
 * (merchants, rules, the security log) would otherwise make its page metres long. Table's `page` draws the same
 * buttons under a table.
 */
import { type ReactNode, useState } from "react";
import { Button } from "./ui/Button.tsx";
import { t } from "../text.ts";
/** The count and the buttons under a cut list; nothing when the list was short enough to show whole. */
export function MoreButtons({ shown, total, step, onMore, onLess }: { shown: number; total: number; step: number; onMore: () => void; onLess: () => void }) {
  if (total <= step) return null;
  return (
    <div className="rt-more">
      <span className="muted small">{`${shown} / ${total}`}</span>
      {shown < total && (
        <Button onClick={onMore}>
          {t("more.show_n", { count: Math.min(step, total - shown) })}
        </Button>
      )}
      {shown > step && (
        <Button variant="link" onClick={onLess}>
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
