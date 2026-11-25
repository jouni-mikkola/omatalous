// Decision: what the page's figures come to, in one sentence and the few figures under it
import type { ReactNode } from "react";
import { Figure } from "../../components/Figure.tsx";
import "../../styles/reports.css";

/** The sentence a report page leads with: under the page's name, and nothing when the page has no sentence to say. */
export function Lead({ children }: { children?: ReactNode }) {
  return children ? <p className="q-lead">{children}</p> : null;
}

/** One figure of the strip: its name, the figure as the answer wrote it and one line that sets it against something. */
export interface StripItem {
  label: string;
  figure: string;
  note?: string;
}

/**
 * The two or three key figures of a page under its sentence, in one row separated by hairlines. The labels, figures and
 * notes of the items each stand on one line across the strip; on a phone each item is a row. The figures are the
 * answer's own: the strip adds up nothing.
 */
export function Strip({ items }: { items: readonly StripItem[] }) {
  return (
    <ul className="strip" data-count={items.length}>
      {items.map((item) => (
        <li key={item.label} className="strip-item">
          <span className="strip-label">{item.label}</span>
          <Figure text={item.figure} size="l" />
          {item.note && <span className="strip-note">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}
