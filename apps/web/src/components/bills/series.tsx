import type { CSSProperties, ReactNode } from "react";
import { CADENCE_LABEL, date, money } from "../../format.ts";
import { addsUp, shares } from "../../marks.ts";
import type { Recurring as Series } from "../../types.ts";
import { Figure } from "../Figure.tsx";

/** "kuukausittain", or "11 kertaa vuodessa" for a monthly fee with a summer break. */
function frequency(s: Series): string {
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? `${perYear} kertaa vuodessa` : CADENCE_LABEL[s.cadence] ?? "–";
}

/** Columns of a series table: a group heading row spans all of them. */
export const COLUMNS = 6;

/** The head of a series table. The last column is the next charge, or for series that ended the last one. */
export function SeriesHead({ ended }: { ended?: boolean }) {
  return (
    <thead>
      <tr>
        <th>Saaja</th>
        <th className="hide-phone">Tiheys</th>
        <th className="num hide-phone">Summa</th>
        <th className="num">Kuussa</th>
        <th className="num hide-phone">Vuodessa</th>
        <th>{ended ? "Viimeksi" : "Seuraava"}</th>
      </tr>
    </thead>
  );
}

/** `priced` says the price after the name: the merchant has several rows in the table, and a phone hides the Summa column. */
export function SeriesRow({
  s,
  label,
  ended,
  actions,
  priced,
  className,
  share,
}: {
  s: Series;
  label: (id: string) => string;
  ended?: boolean;
  actions?: ReactNode;
  priced?: boolean;
  /** `part-first` or `part-last` where the rows are the parts of a bracket. */
  className?: string;
  /** The row's slice of the share track in Kuussa. */
  share?: { from: number; part: number } | null;
}) {
  return (
    <tr className={className}>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
        {priced && <span className="muted"> {money(s.typicalAmountCents)}</span>}
        {s.priceChange && (
          <span className={`badge ${s.priceChange.toCents > s.priceChange.fromCents ? "warn" : "good"}`}>
            {money(s.priceChange.fromCents)} → {money(s.priceChange.toCents)}
          </span>
        )}
        <div className="sub">{label(s.category)}</div>
        {actions}
      </td>
      <td className="hide-phone">{frequency(s)}</td>
      <td className="num hide-phone">{money(s.typicalAmountCents)}</td>
      <td className={share ? "num share sum" : "num sum"} style={share ? ({ "--from": share.from, "--part": share.part } as CSSProperties) : undefined}>
        <strong>{money(s.monthlyCents, false)}</strong>
      </td>
      <td className="num hide-phone">{money(s.yearlyCents, false)}</td>
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

/** The row "Yhteensä" at the foot of a table of series: the sums of the columns Kuussa and Vuodessa, under the same heads. */
export function SeriesTotal({ rows }: { rows: readonly Series[] }) {
  return (
    <tr className="foot-row">
      <th scope="row">Yhteensä</th>
      <td className="hide-phone" />
      <td className="num hide-phone" />
      <td className="num">{money(monthlyOf(rows), false)}</td>
      <td className="num hide-phone">{money(rows.reduce((sum, r) => sum + r.yearlyCents, 0), false)}</td>
      <td />
    </tr>
  );
}

/** One table of series, widest columns hidden on a phone. */
export function SeriesTable({ rows, label, ended }: { rows: readonly Series[]; label: (id: string) => string; ended?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="series-table ruled">
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

/** A whole euro as the page prints it (`money(c, false)`): the nearest, halves away from zero. */
export const printedEuroCents = (cents: number): number => Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100;

/**
 * The marks of a table of series that ends in a row Yhteensä: the bracket when the euros printed in Kuussa add up to the
 * euros printed in Yhteensä (rounded rows can miss by a euro), and the cells of the share track from the exact cents.
 */
export function seriesMarks(rows: readonly Series[]): { bracket: boolean; tracks: ({ from: number; part: number } | null)[] | null } {
  const total = monthlyOf(rows);
  const bracket = addsUp(rows.map((r) => printedEuroCents(r.monthlyCents)), printedEuroCents(total));
  const parts = shares(rows.map((r) => r.monthlyCents), total);
  let from = 0;
  const tracks = parts ? parts.map((p) => { const t = { from, part: p ?? 0 }; from += p ?? 0; return t; }) : null;
  return { bracket, tracks };
}

/** The title block of a panel of series: the name and the panel's own total a month. */
export function TitleBlock({ title, total }: { title: string; total: number }) {
  return (
    <div className="card-head tb">
      <div className="card-name">
        <h2>{title}</h2>
      </div>
      <div className="card-datum">
        <Figure text={`${money(total, false)}/kk`} size="s" />
      </div>
    </div>
  );
}
