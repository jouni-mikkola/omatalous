import type { ReactNode } from "react";

/**
 * The card around one section of a page: a region named by its heading for screen readers. Its head is a title
 * block of up to three ruled cells: the name (with an optional line under it), a datum and the actions. `datum` is
 * the day or range of days the panel covers or its own total, passed from a real field; without one no cell is drawn.
 * `half` is a panel that takes six of the twelve columns on a wide screen, when the one beside it is a half too (base.css).
 * `id` is the anchor the page links to.
 */
export function Section({ id, title, sub, datum, actions, half, children }: { id: string; title: string; sub?: string; datum?: ReactNode; actions?: ReactNode; half?: boolean; children: ReactNode }) {
  return (
    <section className={half ? "card half" : "card"} id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head tb">
        <div className="card-name">
          <h2 id={`${id}-h`}>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {datum != null && datum !== false && datum !== "" && <div className="card-datum">{datum}</div>}
        {actions && <div className="card-tool"><div className="form-row" style={{ margin: 0 }}>{actions}</div></div>}
      </div>
      {children}
    </section>
  );
}
