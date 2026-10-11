import type { MarkKind, UserMark } from "@banking/core";
import { money, plural } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";
import { COLUMNS, SeriesHead, SeriesRow } from "./series.tsx";

/** What one subscription row can do next to the mark it already has. */
export interface MarkControls {
  /** The mark on this merchant that still counts today, or null. */
  markOf: (merchant: string) => UserMark | null;
  busy: string | null;
  set: (merchant: string, mark: MarkKind | null) => void;
}

/**
 * The subscriptions the household chose and may drop. The header total is the one in the line on top of the page. Rows
 * that are asked about come first; a merchant marked as cancelled is listed below, outside the total, until its charges
 * stop. A price change is a badge on its row; the table of them is the Hinnanmuutokset card below this one.
 */
export function Subscriptions({
  subs,
  stopped,
  total,
  controls,
  label,
}: {
  subs: Series[];
  stopped: Series[];
  total: number;
  controls: MarkControls;
  label: (id: string) => string;
}) {
  if (!subs.length && !stopped.length) return null;
  const asked = subs.filter((s) => s.review && !controls.markOf(s.merchant));
  const groups = [
    { key: "asked", title: "Tarkista nämä", sub: "Pieniä palveluja, joita on maksettu yli puoli vuotta", rows: asked },
    { key: "rest", title: asked.length ? "Muut tilaukset" : null, sub: undefined, rows: subs.filter((s) => !asked.includes(s)) },
    { key: "stopped", title: "Merkitty lopetetuksi", sub: "Ei mukana summassa.", rows: stopped },
  ].filter((g) => g.rows.length);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Tilaukset</h2>
          {subs.length > 0 && (
            <div className="card-sub">
              {plural(subs.length, "tilaus", "tilausta")} · {money(total * 12, false)} vuodessa
            </div>
          )}
        </div>
        <strong>{money(total, false)}/kk</strong>
      </div>
      <div className="table-wrap">
        <table className="series-table">
          <SeriesHead />
          {groups.map((g) => (
            <tbody key={g.key}>
              {g.title && (
                <tr className="group-head">
                  <th colSpan={COLUMNS} scope="colgroup">
                    {g.title}
                    {g.sub && <span className="group-sub">{g.sub}</span>}
                  </th>
                </tr>
              )}
              {g.rows.map((s) => (
                <SeriesRow key={s.id} s={s} label={label} actions={<MarkButtons s={s} controls={controls} />} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/** The saving, and what to say about this subscription. A mark that counts shows as a badge with an undo. */
function MarkButtons({ s, controls }: { s: Series; controls: MarkControls }) {
  const mark = controls.markOf(s.merchant);
  const off = controls.busy !== null;
  if (mark) {
    return (
      <div className="sub-actions">
        <span className={`badge ${mark.mark === "cancelled" ? "warn" : "good"}`}>{mark.mark === "cancelled" ? "Lopetettu" : "Käytössä"}</span>
        <button className="btn btn-small" type="button" disabled={off} aria-label={`Kumoa: ${s.merchant}`} onClick={() => controls.set(s.merchant, null)}>
          Kumoa
        </button>
      </div>
    );
  }
  return (
    <div className="sub-actions">
      <span className="sub-saving">Lopettamalla säästät {money(s.yearlyCents, false)} vuodessa</span>
      <button className="btn btn-small" type="button" disabled={off} aria-label={`Käytössä: ${s.merchant}`} onClick={() => controls.set(s.merchant, "in_use")}>
        Käytössä
      </button>
      <button className="btn btn-small" type="button" disabled={off} aria-label={`Lopetettu: ${s.merchant}`} onClick={() => controls.set(s.merchant, "cancelled")}>
        Lopetettu
      </button>
    </div>
  );
}
