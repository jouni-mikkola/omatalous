import type { ReactNode } from "react";
import { CADENCE_LABEL, date, money, plural } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";

/** "kuukausittain", or "11 kertaa vuodessa" for a monthly fee with a summer break. */
function frequency(s: Series): string {
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? `${perYear} kertaa vuodessa` : CADENCE_LABEL[s.cadence] ?? "–";
}

/** Columns of a series table: a group heading row spans all of them. */
export const COLUMNS = 7;

/** The head of a series table. The last column is the next charge, or for series that ended the last one. */
export function SeriesHead({ ended }: { ended?: boolean }) {
  return (
    <thead>
      <tr>
        <th>Kauppias</th>
        <th className="hide-phone">Tiheys</th>
        <th className="num hide-phone">Summa</th>
        <th className="num">Kuussa</th>
        <th className="num hide-phone">Vuodessa</th>
        <th className="num hide-phone">Jatkunut</th>
        <th>{ended ? "Viimeksi" : "Seuraava"}</th>
      </tr>
    </thead>
  );
}

/** `priced` says the price after the name: the merchant has several rows in the table, and a phone hides the Summa column. */
export function SeriesRow({ s, label, ended, actions, priced }: { s: Series; label: (id: string) => string; ended?: boolean; actions?: ReactNode; priced?: boolean }) {
  return (
    <tr>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
        {priced && <span className="muted"> {money(s.typicalAmountCents)}</span>}
        {s.priceChange && (
          <span className={`badge ${s.priceChange.toCents > s.priceChange.fromCents ? "warn" : "good"}`}>
            {money(s.priceChange.fromCents)} → {money(s.priceChange.toCents)}
          </span>
        )}
        <div className="sub">
          {label(s.category)} · {s.occurrences} kertaa {date(s.firstDate)} alkaen
        </div>
        {actions}
      </td>
      <td className="hide-phone">{frequency(s)}</td>
      <td className="num hide-phone">{money(s.typicalAmountCents)}</td>
      <td className="num">
        <strong>{money(s.monthlyCents, false)}</strong>
      </td>
      <td className="num hide-phone">{money(s.yearlyCents, false)}</td>
      <td className="num hide-phone">{plural(s.monthsActive, "kuukausi", "kuukautta")}</td>
      <td className="next">
        {ended ? (
          date(s.lastDate)
        ) : s.overdue ? (
          <span className="badge warn" title={`Odotettiin ${date(s.nextDate)}`}>
            Myöhässä
          </span>
        ) : (
          date(s.nextDate)
        )}
      </td>
    </tr>
  );
}

/** One table of series, widest columns hidden on a phone. */
export function SeriesTable({ rows, label, ended }: { rows: readonly Series[]; label: (id: string) => string; ended?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="series-table">
        <SeriesHead ended={ended} />
        <tbody>
          {rows.map((s) => (
            <SeriesRow key={s.id} s={s} label={label} ended={ended} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What a list of series costs a month. */
export const monthlyOf = (rows: readonly Series[]): number => rows.reduce((sum, r) => sum + r.monthlyCents, 0);
