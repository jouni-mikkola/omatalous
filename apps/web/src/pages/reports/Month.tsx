// Decision: which category explains this month, read against what each usually costs to the same day
import type { GapRow } from "@banking/core";
import { query } from "../../api.ts";
import { css } from "../../css.ts";
import { ErrorCard } from "../../components/ErrorCard.tsx";
import { type Column, Table } from "../../components/table/Table.tsx";
import { Why } from "../../components/Why.tsx";
import { dateRange, money, signedMoney } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Meta, ReportsData, Scope } from "../../types.ts";
import { GapReasonNote } from "./sections/ThisMonth.tsx";
import type { ReportRange } from "./types.ts";
import "../../styles/report-month.css";

/** The rows with the largest gap over the usual first, so the category that explains the month leads; the rest row is last. */
export function byGap(rows: readonly GapRow[]): GapRow[] {
  return [...rows].sort((a, b) => Number(a.category === null) - Number(b.category === null) || Number(b.gapCents > a.gapCents) - Number(b.gapCents < a.gapCents));
}

/** The bar of a row: what was spent as its length and the usual to the same day as a tick, both on the scale of the largest figure of the list. */
function Bar({ row, scale }: { row: GapRow; scale: number }) {
  const share = (cents: number) => `${Math.round((Math.max(0, cents) / scale) * 1000) / 10}%`;
  return (
    <span className="km-bar" aria-hidden="true">
      <span className="km-fill" ref={css({ "inline-size": share(row.spentCents) })} />
      <span className="km-tick" ref={css({ "inset-inline-start": share(row.expectedCents) })} />
    </span>
  );
}

/**
 * Kuukausi: the running month's spending to today by category, each against its usual to the same day, the list in the
 * order of the gap. A category opens the rows its sum is made of. Income is one line under the list.
 */
export function Month({ meta, range, scope }: { meta: Meta; range: ReportRange; scope: Scope }) {
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${query({ ...range, scope, reports: "thisMonth,income" })}`);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <div className="stack" aria-busy="true"><span className="sk sk-title" aria-hidden="true" /><span className="sk sk-line" aria-hidden="true" /></div>;
  const r = data.thisMonth;
  const days = { from: `${r.month}-01`, to: meta.today };
  const rows = byGap(r.categories);
  const scale = Math.max(1, ...rows.flatMap((x) => [x.spentCents, x.expectedCents]));
  const income = data.income.months.find((m) => m.month === r.month)?.totalCents;
  const usualIncome = data.income.stability?.medianCents;
  const columns: Column<GapRow>[] = [
    { key: "name", label: t("rpt.tm_cat"), kind: "text", rowHead: true, cell: (x) => x.label },
    {
      key: "spent",
      label: t("rpt.tm_spent"),
      kind: "money",
      main: true,
      cell: (x) =>
        x.category === null ? (
          money(x.spentCents)
        ) : (
          <Why figure="spend.category" title={x.label} range={days} scope={scope} category={x.category} text={money(x.spentCents)}>
            {money(x.spentCents)}
          </Why>
        ),
    },
    {
      key: "usual",
      label: t("rpt.tm_expected"),
      kind: "money",
      cell: (x) => (
        <span className="km-usual">
          <Bar row={x} scale={scale} />
          {money(x.expectedCents)}
        </span>
      ),
    },
    { key: "gap", label: t("rpt.tm_gap"), kind: "money", cell: (x) => signedMoney(x.gapCents) },
  ];
  return (
    <div className={loading ? "km stack loading" : "km stack"}>
      <h2 className="km-title">{dateRange(days.from, days.to)}</h2>
      <p className="km-total">
        {t("rpt.tm_spent")} <strong>{money(r.spentCents, false)}</strong>
        {r.expectedCents !== null && r.gapCents !== null && (
          <>
            , {t("rpt.tm_expected").toLowerCase()} {money(r.expectedCents, false)} ({signedMoney(r.gapCents)})
          </>
        )}
      </p>
      <GapReasonNote reason={r.gapReason} className="km-note" />
      {r.gapCents !== null && rows.length > 0 && <Table<GapRow> caption={t("rpt.tm_cats_caption")} rows={rows} rowKey={(x) => `${x.category ?? ""}:${x.label}`} columns={columns} drillButton={false} />}
      {income !== undefined && (
        <p className="km-income">
          {t("rep.income")} {money(income, false)}
          {usualIncome !== undefined && `, ${t("inc.usual_month").toLowerCase()} ${money(usualIncome, false)}`}
        </p>
      )}
    </div>
  );
}
