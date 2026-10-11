import type { ReactNode } from "react";

/**
 * The card around one section of a page: a region named by its heading for screen readers, an optional line under
 * the heading and optional actions beside it. `id` is the anchor the page links to. A `nested` section sits inside
 * another card (Tietojen laatu in Tilit): no card of its own and a smaller heading.
 */
export function Section({ id, title, sub, actions, nested, children }: { id: string; title: string; sub?: string; actions?: ReactNode; nested?: boolean; children: ReactNode }) {
  const Heading = nested ? "h3" : "h2";
  return (
    <section className={nested ? "section-nested" : "card"} id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <div>
          <Heading id={`${id}-h`} className={nested ? "subhead" : undefined}>
            {title}
          </Heading>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {actions && <div className="form-row" style={{ margin: 0 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
