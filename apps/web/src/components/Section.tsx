import type { ReactNode } from "react";

/**
 * The card around one section of a page: a region named by its heading for screen readers, an optional line under
 * the heading and optional actions beside it. `id` is the anchor the page links to.
 */
export function Section({ id, title, sub, actions, children }: { id: string; title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {actions && <div className="form-row" style={{ margin: 0 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
