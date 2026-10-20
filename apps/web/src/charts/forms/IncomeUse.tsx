// Decision: which month let the money run out, and on what: spending, paying debt or saving
import { DataTable } from "../../components/table/DataTable.tsx";
import type { CashflowReport, PeriodTotals } from "@banking/core";
import { money, monthLabel, monthLong, percent } from "../../format.ts";

/** The flows in the order income is used, each in a fixed slot of its own (never picked by rank, VD0). */
const PARTS = [
  { key: "consumptionCents", label: "Kulutus", color: "var(--series-2)" },
  // the word of the bridge on Yhteenveto (r3a), so a flow has one name on every page
  { key: "debtCents", label: "Maksettu velanhoito", color: "var(--series-7)" },
  { key: "savedCents", label: "Säästöön", color: "var(--series-3)" },
  { key: "leftCents", label: "Yli jäi", color: "var(--series-5)" },
] as const;

type Flows = Pick<PeriodTotals, (typeof PARTS)[number]["key"]>;

// The month bars share one scale: the largest month's money in, with room past it for a month that spent more than came in.
const HEADROOM = 1.15;

/** A segment's fill: the series softened on the panel (critic 8), so four hues side by side do not glare at night. */
const soft = (color: string) => `color-mix(in srgb, ${color} 72%, var(--surface))`;

/** The bar of one row: each segment is one server field laid end to end; the hatch marks what was taken from the accounts. */
function UseBar({ f, inCents, scale }: { f: Flows; inCents: number; scale: number }) {
  const w = (cents: number) => `${(Math.max(0, cents) / scale) * 100}%`;
  return (
    <div className="use-bar" role="img" aria-label={PARTS.map((p) => `${p.label} ${money(f[p.key], false)}`).join(", ")}>
      {PARTS.filter((p) => p.key !== "leftCents" || f.leftCents > 0).map((p) => (
        <i key={p.key} style={{ width: w(f[p.key]), background: soft(p.color) }} />
      ))}
      {f.leftCents < 0 && <i className="use-over" style={{ left: w(inCents), width: w(-f.leftCents) }} />}
    </div>
  );
}

/**
 * One row per month: money in, then where it went as one bar on a scale the month rows share, so a long bar is a big
 * month and the parts read as the split. The last row is the whole period on a scale of its own (its money in is the
 * full width), the figures of the old bridge. The table adds up nothing.
 */
export function IncomeUse({ rows, total, totalLabel }: { rows: CashflowReport["rows"]; total: (PeriodTotals & { inCents: number }) | null; totalLabel: string }) {
  const scale = Math.max(...rows.map((r) => r.stack.inCents), 1) * HEADROOM;
  return (
    <>
      <p className="use-key" aria-hidden="true">
        {PARTS.map((p) => (
          <span key={p.key}>
            <i className="swatch" style={{ background: soft(p.color) }} />
            {p.label}
          </span>
        ))}
        <span>
          <i className="swatch use-over-key" />
          Tileiltä otettu
        </span>
      </p>
      <div className="table-wrap">
        <table className="ruled use-table">
          <thead>
            <tr>
              <th>Kuukausi</th>
              <th className="num">Tulot</th>
              <th>
                <span className="sr-only">Mihin tulot menivät</span>
              </th>
              <th className="num">Yli jäi</th>
              <th className="num use-hide">Säästöaste</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="use-month">
                  <span className="month-name">
                    <span className="month-long">{monthLong(r.month)}</span>
                    <span className="month-short">{monthLabel(r.month, true)}</span>
                  </span>
                  {r.complete ? "" : " (vajaa)"}
                </td>
                <td className="num">{money(r.incomeCents, false)}</td>
                <td className="use-cell">
                  <UseBar f={r} inCents={r.stack.inCents} scale={scale} />
                </td>
                <td className="num">{money(r.leftCents, false)}</td>
                <td className="num use-hide">{r.savingsRate === null ? "–" : percent(r.savingsRate)}</td>
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr className="foot-row">
                <td>{totalLabel}</td>
                <td className="num">{money(total.incomeCents, false)}</td>
                <td className="use-cell">
                  <UseBar f={total} inCents={total.inCents} scale={Math.max(total.inCents, 1) * HEADROOM} />
                </td>
                <td className="num">
                  <strong>{money(total.leftCents, false)}</strong>
                </td>
                <td className="num use-hide">{total.savingsRate === null ? "–" : percent(total.savingsRate)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/** The table view: every flow of every month as a figure. */
export function IncomeUseTable({ rows, total, totalLabel }: { rows: CashflowReport["rows"]; total: PeriodTotals | null; totalLabel: string }) {
  const drew = rows.some((r) => r.borrowedCents > 0);
  type Row = CashflowReport["rows"][number];
  const rate = (f: PeriodTotals | Row) => (f.savingsRate === null ? "–" : percent(f.savingsRate));
  return (
    <DataTable
      id="tulojen-kaytto"
      caption="Tulot ja niiden käyttö kuukausittain"
      rows={rows}
      rowKey={(r) => r.month}
      columns={[
        { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (r) => `${monthLong(r.month)}${r.complete ? "" : " (vajaa)"}` },
        { key: "income", label: "Tulot", kind: "money", cents: (r) => r.incomeCents },
        ...(drew ? [{ key: "borrowed", label: "Luotonnostot", kind: "money" as const, cents: (r: Row) => r.borrowedCents }] : []),
        ...PARTS.map((p) => ({ key: p.key, label: p.label, kind: "money" as const, cents: (r: Row) => r[p.key] })),
        { key: "rate", label: "Säästöaste", kind: "share" as const, cell: rate, sortValue: (r: Row) => r.savingsRate },
      ]}
      total={
        total
          ? {
              label: totalLabel,
              cells: {
                income: money(total.incomeCents, false),
                borrowed: money(total.borrowedCents, false),
                ...Object.fromEntries(PARTS.map((p) => [p.key, money(total[p.key], false)])),
                rate: rate(total),
              },
            }
          : undefined
      }
    />
  );
}
