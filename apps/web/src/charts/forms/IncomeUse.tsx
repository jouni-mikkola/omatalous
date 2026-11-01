// Decision: which month let the money run out, and on what: spending, paying debt or saving
import { KeyValue } from "../../components/table/KeyValue.tsx";
import { Table } from "../../components/table/Table.tsx";
import type { CashflowReport, PeriodTotals } from "@banking/core";
import { money, monthLong, percent } from "../../format.ts";
import { t } from "../../text.ts";
import { color } from "../../design/tokens.ts";
import { css } from "../../css.ts";

/** The flows in the order income is used, each in a fixed slot of its own (never picked by rank, VD0). */
const PARTS = [
  { key: "consumptionCents", get label() { return t("rep.consumption"); }, color: color["series-2"] },
  // the word of the bridge on Yhteenveto (r3a), so a flow has one name on every page
  { key: "debtCents", get label() { return t("rpt.iu_debt"); }, color: color["series-7"] },
  { key: "savedCents", get label() { return t("rep.to_savings"); }, color: color["series-3"] },
  { key: "leftCents", get label() { return t("rep.result"); }, color: color["series-5"] },
] as const;

type Flows = Pick<PeriodTotals, (typeof PARTS)[number]["key"]>;

// The month bars share one scale: the largest month's money in, with room past it for a month that spent more than came in.
const HEADROOM = 1.15;

/** A segment's fill: the series softened on the panel (critic 8), so four hues side by side do not glare. */
const soft = (base: string) => `color-mix(in srgb, ${base} 72%, ${color.surface})`;

/** The bar of one row: each segment is one server field laid end to end; the hatch marks what was taken from the accounts. */
function UseBar({ f, inCents, scale }: { f: Flows; inCents: number; scale: number }) {
  const w = (cents: number) => `${(Math.max(0, cents) / scale) * 100}%`;
  return (
    <div className="use-bar" role="img" aria-label={PARTS.map((p) => `${p.label} ${money(f[p.key], false)}`).join(", ")}>
      {PARTS.filter((p) => p.key !== "leftCents" || f.leftCents > 0).map((p) => (
        <i key={p.key} ref={css({ width: w(f[p.key]), background: soft(p.color) })} />
      ))}
      {f.leftCents < 0 && <i className="use-over" ref={css({ left: w(inCents), width: w(-f.leftCents) })} />}
    </div>
  );
}

/**
 * One row per month: money in, then where it went as one bar on a scale the month rows share, so a long bar is a big
 * month and the parts read as the split. The last row is the whole period on a scale of its own (its money in is the
 * full width), the figures of the old bridge. The table adds up nothing. A row opens to the figure of each flow of its
 * month, so the month is one row here and nowhere else on the page.
 */
export function IncomeUse({ rows, total, totalLabel }: { rows: CashflowReport["rows"]; total: (PeriodTotals & { inCents: number }) | null; totalLabel: string }) {
  const scale = Math.max(...rows.map((r) => r.stack.inCents), 1) * HEADROOM;
  return (
    <>
      <p className="use-key" aria-hidden="true">
        {PARTS.map((p) => (
          <span key={p.key}>
            <i className="swatch" ref={css({ background: soft(p.color) })} />
            {p.label}
          </span>
        ))}
        <span>
          <i className="swatch use-over-key" />
          {t("rpt.iu_drawn")}
        </span>
      </p>
      <Table<CashflowReport["rows"][number]>
        caption={t("rpt.iu_monthly_caption")}
        className="use-table"
        rows={rows}
        rowKey={(r) => r.month}
        search={false}
        csv={false}
        drill={(r) => (
          <KeyValue
            items={[
              ...(r.borrowedCents > 0 ? ([[t("rpt.cf_b_borrowed"), money(r.borrowedCents)]] as const) : []),
              ...PARTS.filter((p) => p.key !== "leftCents").map((p) => [p.label, money(r[p.key])] as const),
              // the column is hidden on a phone, so the rate is read here
              [t("rpt.cf_rate"), r.savingsRate === null ? "–" : percent(r.savingsRate)] as const,
            ]}
          />
        )}
        drillLabel={(r) => t("rpt.iu_flows", { month: monthLong(r.month) })}
        columns={[
          {
            key: "month",
            label: t("rpt.month_col"),
            kind: "text",
            rowHead: true,
            cell: (r) => `${monthLong(r.month)}${r.complete ? "" : t("rpt.partial_suffix")}`,
          },
          { key: "income", label: t("rep.income"), kind: "money", precision: "cents", cents: (r) => r.incomeCents },
          { key: "use", label: t("rpt.iu_where"), kind: "text", className: () => "use-cell", cell: (r) => <UseBar f={r} inCents={r.stack.inCents} scale={scale} /> },
          { key: "left", label: t("rep.result"), kind: "money", main: true, precision: "cents", cents: (r) => r.leftCents },
          { key: "rate", label: t("rpt.cf_rate"), kind: "share", phone: "hide", cell: (r) => (r.savingsRate === null ? "–" : percent(r.savingsRate)) },
        ]}
        total={
          total
            ? {
                label: totalLabel,
                cells: {
                  income: money(total.incomeCents),
                  use: <UseBar f={total} inCents={total.inCents} scale={Math.max(total.inCents, 1) * HEADROOM} />,
                  left: money(total.leftCents),
                  rate: total.savingsRate === null ? "–" : percent(total.savingsRate),
                },
              }
            : undefined
        }
      />
    </>
  );
}
