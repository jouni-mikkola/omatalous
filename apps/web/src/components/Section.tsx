import { createContext, type ReactNode, useContext } from "react";

/** Set by a page that folds its sections: each one shuts under its name and datum, `open` says which starts open. Outside it a section is a plain card. */
export const FoldContext = createContext<{ open: boolean } | null>(null);

/** True inside a folded section: a part that folds its own body has no need to when the section already does. */
export const useFolded = (): boolean => useContext(FoldContext) !== null;

/**
 * The card around one section of a page: a region named by its heading for screen readers. Its head is a title
 * block of up to three ruled cells: the name (with an optional line under it), a datum and the actions. `datum` is
 * the day or range of days the panel covers or its own total, passed from a real field; without one no cell is drawn.
 * `half` is a panel that takes six of the twelve columns on a wide screen, when the one beside it is a half too (base.css).
 * `id` is the anchor the page links to. Under a `FoldContext` the card is a fold: the name and the datum are what stands
 * shut, the actions and the body what opens.
 */
export function Section({ id, title, sub, datum, actions, half, children }: { id: string; title: string; sub?: string; datum?: ReactNode; actions?: ReactNode; half?: boolean; children: ReactNode }) {
  const fold = useContext(FoldContext);
  const hasDatum = datum != null && datum !== false && datum !== "";
  if (fold)
    return (
      <details className="card" id={id} open={fold.open}>
        <summary className="card-head tb">
          <div className="card-name">
            <h2 id={`${id}-h`}>{title}</h2>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {hasDatum && <div className="card-datum">{datum}</div>}
        </summary>
        {actions && (
          <div className="card-tool">
            <div className="form-row flush">{actions}</div>
          </div>
        )}
        {children}
      </details>
    );
  return (
    <section className={half ? "card half" : "card"} id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head tb">
        <div className="card-name">
          <h2 id={`${id}-h`}>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {hasDatum && <div className="card-datum">{datum}</div>}
        {actions && <div className="card-tool"><div className="form-row flush">{actions}</div></div>}
      </div>
      {children}
    </section>
  );
}
