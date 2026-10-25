// Decision: which month let the money run out, and on what: spending, paying debt or saving
import { Table } from "../../components/table/Table.tsx";
import type { CashflowReport, PeriodTotals } from "@banking/core";
import { money, monthLong, percent } from "../../format.ts";

/** The flows in the order income is used, each in a fixed slot of its own (never picked by rank, VD0). */
const PARTS = [
  { key: "consumptionCents", label: "Kulutus", color: "var(--series-2)" },
  // the word of the bridge on Yhteenveto (r3a), so a flow has one name on every page
  { key: "debtCents", label: "Maksettu velanhoito", color: "var(--series-7)" },
  { key: "savedCents", label: "Säästöön", color: "var(--series-3)" },
  { key: "leftCents", label: "Tulos", color: "var(--series-5)" },
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
      <Table<CashflowReport["rows"][number]>
        caption="Mihin tulot menivät kuukausittain"
        className="use-table"
        rows={rows}
        rowKey={(r) => r.month}
        columns={[
          {
            key: "month",
            label: "Kuukausi",
            kind: "text",
            rowHead: true,
            cell: (r) => `${monthLong(r.month)}${r.complete ? "" : " (vajaa)"}`,
          },
          { key: "income", label: "Tulot", kind: "money", cell: (r) => money(r.incomeCents, false) },
          { key: "use", label: "Mihin tulot menivät", kind: "text", className: () => "use-cell", cell: (r) => <UseBar f={r} inCents={r.stack.inCents} scale={scale} /> },
          { key: "left", label: "Tulos", kind: "money", main: true, cell: (r) => money(r.leftCents, false) },
          { key: "rate", label: "Säästöaste", kind: "share", phone: "hide", cell: (r) => (r.savingsRate === null ? "–" : percent(r.savingsRate)) },
        ]}
        total={
          total
            ? {
                label: totalLabel,
                cells: {
                  income: money(total.incomeCents, false),
                  use: <UseBar f={total} inCents={total.inCents} scale={Math.max(total.inCents, 1) * HEADROOM} />,
                  left: money(total.leftCents, false),
                  rate: total.savingsRate === null ? "–" : percent(total.savingsRate),
                },
              }
            : undefined
        }
      />
    </>
  );
}

/** The table view: every flow of every month as a figure. */
export function IncomeUseTable({ rows, total, totalLabel }: { rows: CashflowReport["rows"]; total: PeriodTotals | null; totalLabel: string }) {
  const drew = rows.some((r) => r.borrowedCents > 0);
  type Row = CashflowReport["rows"][number];
  const rate = (f: PeriodTotals | Row) => (f.savingsRate === null ? "–" : percent(f.savingsRate));
  return (
    <Table
      caption="Tulot ja niiden käyttö kuukausittain"
      rows={rows}
      rowKey={(r) => r.month}
      columns={[
        { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (r) => `${monthLong(r.month)}${r.complete ? "" : " (vajaa)"}` },
        { key: "income", label: "Tulot", kind: "money", cents: (r) => r.incomeCents },
        ...(drew ? [{ key: "borrowed", label: "Luotonnostot", kind: "money" as const, cents: (r: Row) => r.borrowedCents }] : []),
        ...PARTS.map((p) => ({ key: p.key, label: p.label, kind: "money" as const, cents: (r: Row) => r[p.key] })),
        { key: "rate", label: "Säästöaste", kind: "share" as const, cell: rate },
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
