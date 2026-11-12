// Decision: which open question to answer first, by the money it holds
import { hashOf } from "../../routes.ts";
import { t, tn } from "../../text.ts";

/** The rows shown: the first of the queue, in its order. */
export const NOTABLE_SHOWN = 3;

/** An open question as the block shows it: what kind of thing it is, what it is about and its sum. */
export interface NotableRow {
  id: string;
  kind: string;
  name: string;
  figure: string;
  unit?: string;
}

const reviewHref = hashOf({ page: "review", params: new URLSearchParams() });

/**
 * Huomioitavaa: the first open questions of Tarkistettavat, in the queue's own order (the money at stake), each as what
 * it is about and its sum, and the count of them all. It asks nothing itself: every row opens Tarkistettavat, where the
 * first row is the first question. With no open question the block is not drawn. The page reads the queue and hands
 * over its first rows and the count of all.
 */
export function Notable({ rows, count }: { rows: readonly NotableRow[]; count: number }) {
  if (count === 0 || rows.length === 0) return null;
  return (
    <section className="card home-notable" aria-labelledby="home-notable-h">
      <h2 id="home-notable-h">{t("home.notable")}</h2>
      <ul className="home-notes">
        {rows.map((row) => (
          <li key={row.id}>
            <a className="home-note" href={reviewHref}>
              <span className="home-note-text">
                <span className="home-note-kind">{row.kind}</span>
                <span className="home-note-title">{row.name}</span>
              </span>
              {row.figure && (
                <span className="home-note-effect num">
                  {row.figure}
                  {row.unit && <small> {row.unit}</small>}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <p className="home-more">
        <a href={reviewHref}>{tn(count, "home.notable_all_one", "home.notable_all_many")}</a>
      </p>
    </section>
  );
}
