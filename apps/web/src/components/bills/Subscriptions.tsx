import { type MarkKind, seriesOfMarkSubject, type UserMark } from "@banking/core";
import { money } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";
import { COLUMNS, SeriesHead, SeriesRow, SeriesTotal } from "./series.tsx";

/** What one subscription row can do next to the mark it already has. */
export interface MarkControls {
  /** The mark on this series that still counts today, or null: its own, or an old one on its merchant. */
  markOf: (s: Series) => UserMark | null;
  busy: boolean;
  /** Marks this one series. */
  set: (s: Series, mark: MarkKind) => void;
  /** Takes a mark away under the subject it was stored with: an old mark on a merchant goes for every series of it. */
  clear: (mark: UserMark) => void;
}

/**
 * The subscriptions the household chose and may drop, in one list. The header total is the one in the row on top of the
 * page, and the row "Yhteensä" under the list adds the columns Kuussa and Vuodessa. Rows that are asked about come
 * first; a subscription marked as cancelled is listed below that row, outside it, until its charges stop. A mark is on
 * one row. When a merchant has several rows, each says its price after the name and in its
 * buttons, so the household sees which one it answers. A price change is a badge on its row; the table of them is the
 * Hinnanmuutokset card below this one.
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
  const asked = subs.filter((s) => s.review && !controls.markOf(s));
  const rows = [...subs, ...stopped];
  const priced = (s: Series) => rows.some((o) => o !== s && o.merchant === s.merchant);
  const row = (s: Series) => <SeriesRow key={s.id} s={s} label={label} priced={priced(s)} actions={<MarkButtons s={s} controls={controls} priced={priced(s)} />} />;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tilaukset</h2>
        <strong>{money(total, false)}/kk</strong>
      </div>
      <div className="table-wrap">
        <table className="series-table">
          <SeriesHead />
          {subs.length > 0 && (
            <tbody>
              {[...asked, ...subs.filter((s) => !asked.includes(s))].map(row)}
              <SeriesTotal rows={subs} />
            </tbody>
          )}
          {stopped.length > 0 && (
            <tbody>
              <tr className="group-head">
                <th colSpan={COLUMNS} scope="colgroup">
                  Merkitty lopetetuksi
                </th>
              </tr>
              {stopped.map(row)}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

/** The saving, and what to say about this subscription. A mark that counts shows as a badge with an undo. */
function MarkButtons({ s, controls, priced }: { s: Series; controls: MarkControls; priced: boolean }) {
  const mark = controls.markOf(s);
  const name = priced ? `${s.merchant} ${money(s.typicalAmountCents)}` : s.merchant;
  if (mark) {
    // a mark from before marks named one subscription is on the merchant: it covers every row of it, and Kumoa takes it from all
    const onMerchant = seriesOfMarkSubject(mark.subject) === null;
    return (
      <div className="sub-actions">
        <span className={`badge ${mark.mark === "cancelled" ? "warn" : "good"}`}>{mark.mark === "cancelled" ? "Lopetettu" : "Käytössä"}</span>
        {priced && onMerchant && <span className="muted small">Koskee kaikkia kauppiaan tilauksia.</span>}
        <button className="btn btn-small" type="button" disabled={controls.busy} aria-label={`Kumoa: ${onMerchant ? s.merchant : name}`} onClick={() => controls.clear(mark)}>
          Kumoa
        </button>
      </div>
    );
  }
  return (
    <div className="sub-actions">
      <button className="btn btn-small" type="button" disabled={controls.busy} aria-label={`Käytössä: ${name}`} onClick={() => controls.set(s, "in_use")}>
        Käytössä
      </button>
      <button className="btn btn-small" type="button" disabled={controls.busy} aria-label={`Lopetettu: ${name}`} onClick={() => controls.set(s, "cancelled")}>
        Lopetettu
      </button>
    </div>
  );
}
