// Decision: which category takes the most of the period, and which one is above or under its usual month
import { css } from "../../css.ts";
import { money, signedMoney } from "../../format.ts";
import { useSelect } from "../../components/table/selection.tsx";
import "../../styles/category-bars.css";

interface CategoryBar {
  key: string;
  label: string;
  /** The category's sum over the period, as the report gives it. */
  cents: number;
  /** The newest complete month less the usual month, as the report gives it; null without a usual month. */
  diffCents: number | null;
}

/**
 * One bar a category, longest first, all on the scale of the largest. The row carries its own comparison: the figure is
 * the period's sum and the signed figure under it is the newest month against the usual one, red above and green
 * under. A click or Enter on a row keeps its row in the table under the chart (`rowKey` of that table is `key`).
 * Every figure is a field of the report: only the order is decided here.
 */
export function CategoryBars({ bars, diffLabel, label }: { bars: readonly CategoryBar[]; diffLabel: string; label: string }) {
  const pick = useSelect();
  const ordered = [...bars].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const max = Math.max(1, ...ordered.map((b) => b.cents));
  const hasDiff = ordered.some((b) => b.diffCents !== null);
  return (
    <div className="category-bars">
      {hasDiff && <p className="cb-head">{diffLabel}</p>}
      <ul className="cb-list" aria-label={label}>
        {ordered.map((b) => {
          const on = pick?.selected === b.key;
          return (
            <li key={b.key}>
              <button type="button" className="cb-row" aria-pressed={pick ? on : undefined} onClick={() => pick?.select(b.key)}>
                <span className="cb-name">{b.label}</span>
                <span className="cb-sum">{money(b.cents, false)}</span>
                <span className="cb-track" aria-hidden="true">
                  <span ref={css({ width: `${(Math.min(1, Math.max(0, b.cents) / max) * 100).toFixed(1)}%` })} />
                </span>
                {b.diffCents !== null && (
                  <span className="cb-diff" data-dir={b.diffCents > 0 ? "up" : b.diffCents < 0 ? "down" : "flat"} aria-label={`${diffLabel}: ${signedMoney(b.diffCents)}`}>
                    {signedMoney(b.diffCents)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
