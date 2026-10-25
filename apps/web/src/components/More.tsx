/**
 * The cut of a long list: the first `page` items, then "Näytä lisää" adds as many again. A list the household grows
 * (merchants, rules, the security log) would otherwise make its page metres long. Table's `page` draws the same
 * buttons under a table.
 */
import { type ReactNode, useState } from "react";

/** The count and the buttons under a cut list; nothing when the list was short enough to show whole. */
export function MoreButtons({ shown, total, step, onMore, onLess }: { shown: number; total: number; step: number; onMore: () => void; onLess: () => void }) {
  if (total <= step) return null;
  return (
    <div className="rt-more">
      <span className="muted small">{`${shown} / ${total}`}</span>
      {shown < total && (
        <button className="btn btn-small" type="button" onClick={onMore}>
          {`Näytä lisää (${Math.min(step, total - shown)})`}
        </button>
      )}
      {shown > step && (
        <button className="btn btn-small" type="button" onClick={onLess}>
          Näytä vähemmän
        </button>
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
