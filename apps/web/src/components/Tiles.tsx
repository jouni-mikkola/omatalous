// Decision: what the page's key figures come to, and whether each is better or worse than what it is set against
import { Figure } from "./Figure.tsx";
import "../styles/tiles.css";

/** A signed difference the caller wrote (for example "+120 €") and whether it is good news; the tile computes neither. */
interface TileDelta {
  text: string;
  good: boolean;
}

/** One tile: its name, the figure as the answer wrote it, an optional delta chip and one line that sets it against something. `tone` colours a figure that is itself the good or bad news. */
export interface TileItem {
  label: string;
  figure: string;
  tone?: "good" | "bad";
  delta?: TileDelta;
  note?: string;
  /** Where the figure's rows are; the figure is then a link. */
  href?: string;
  /** What the figure leaves out, said beside it in figure size; a link when `href` is set (for example "+ 4 lainaa ilman saldoa"). */
  gap?: { text: string; href?: string };
}

/**
 * The two or three key figures of a page in one row separated by hairlines. The labels, figures and notes of the tiles
 * each stand on one line across the row; on a phone each tile is a row. The figures, deltas and their colours are the
 * caller's own: the tiles add up and compare nothing.
 */
export function Tiles({ items }: { items: readonly TileItem[] }) {
  return (
    <ul className="strip" data-count={items.length}>
      {items.map((item) => (
        <li key={item.label} className="strip-item">
          <span className="strip-label">{item.label}</span>
          <span className={item.tone ? `strip-figure ${item.tone}` : "strip-figure"}>
            {item.href ? (
              <a href={item.href}>
                <Figure text={item.figure} size="l" />
              </a>
            ) : (
              <Figure text={item.figure} size="l" />
            )}
            {item.gap && (item.gap.href ? <a href={item.gap.href}><Figure text={item.gap.text} size="m" /></a> : <Figure text={item.gap.text} size="m" />)}
            {item.delta && <span className={`strip-delta ${item.delta.good ? "good" : "bad"}`}>{item.delta.text}</span>}
          </span>
          {item.note && <span className="strip-note">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}
