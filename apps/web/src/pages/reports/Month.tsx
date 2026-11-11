// Decision: which category explains this month or an earlier one, read against what each usually costs to the same day
import { addMonths, type GapRow, MIN_COMPARE_MONTHS, monthEnd, spentRows, type ThisMonthReport } from "@banking/core";
import { query } from "../../api.ts";
import { css } from "../../css.ts";
import { ErrorCard } from "../../components/ErrorCard.tsx";
import { type Column, Table } from "../../components/table/Table.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { Why } from "../../components/Why.tsx";
import { dateRange, money, signedMoney } from "../../format.ts";
import { navigate, useApi, useHashRoute } from "../../hooks.ts";
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

/** The address's month (`?month=2026-10`) when it names one before the running month, else null: the running month has no parameter. */
function earlierMonth(params: URLSearchParams, today: string): string | null {
  const asked = params.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < today.slice(0, 7) ? asked : null;
}

/** What the view shows of a month: the days it reads, the total against its usual and the categories that make the gap. */
interface Shown {
  month: string;
  days: { from: string; to: string };
  spentCents: number;
  expectedCents: number | null;
  gapCents: number | null;
  gapReason: ThisMonthReport["gapReason"];
  categories: GapRow[];
}

/**
 * An earlier month whole, from the report of the change against the usual (`spendingChange`, its usual view of the month the
 * range ends in): a category's spending, its usual level and their difference, which add up to the total's. Without enough
 * history before the month there is only what was spent.
 */
function earlier(data: ReportsData, month: string): Shown {
  const change = data.spendingChange.views.find((v) => v.view === "expected" && v.change.target.months.join() === month)?.change;
  if (!change) return { month, days: { from: `${month}-01`, to: monthEnd(month) }, spentCents: data.categories.totalCents, expectedCents: null, gapCents: null, gapReason: "history", categories: [] };
  const categories = change.categories.map((c): GapRow => ({ category: c.category, day: null, label: c.label, spentCents: c.nowCents, expectedCents: c.baseCents, gapCents: c.changeCents }));
  return { month, days: { from: change.target.from, to: change.target.to }, spentCents: change.nowCents, expectedCents: change.baseCents, gapCents: change.changeCents, gapReason: null, categories };
}

/**
 * Kuukausi: a month's spending by category, each against its usual to the same day, the list in the order of the gap. It
 * opens on the running month to today; the arrows step a month back and forward, and an earlier month is in the address
 * (`?month=`) and read whole. A category opens the rows its sum is made of. Income is one line under the list.
 */
export function Month({ meta, range, scope }: { meta: Meta; range: ReportRange; scope: Scope }) {
  const past = earlierMonth(useHashRoute().params, meta.today);
  const path = past ? query({ from: `${past}-01`, to: monthEnd(past), scope, reports: "spendingChange,categories,income" }) : query({ ...range, scope, reports: "thisMonth,income" });
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${path}`);
  // under three months of rows there is no usual: the running month's categories are asked for with their sums alone
  const young = !past && !!data && Object.hasOwn(data, "thisMonth") && data.thisMonth.gapReason === "history";
  const sums = useApi<ReportsData>(young ? `/api/reports${query({ from: `${meta.today.slice(0, 7)}-01`, to: meta.today, scope, reports: "categories" })}` : null);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  // the answer kept while the next month loads is of the other kind: it is shown again only when it has this month's reports
  if (!data || !Object.hasOwn(data, past ? "spendingChange" : "thisMonth")) return <div className="stack" aria-busy="true"><span className="sk sk-title" aria-hidden="true" /><span className="sk sk-line" aria-hidden="true" /></div>;
  const r: Shown = past ? earlier(data, past) : { ...data.thisMonth, days: { from: `${data.thisMonth.month}-01`, to: meta.today } };
  const days = r.days;
  const step = (n: number) => {
    const to = addMonths(past ?? meta.today.slice(0, 7), n);
    navigate("reports", { month: to < meta.today.slice(0, 7) ? to : undefined }, true);
  };
  const noUsual = r.gapReason === "history";
  const rows = noUsual ? spentRows((past ? data.categories : sums.data?.categories)?.groups ?? []) : byGap(r.categories);
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
      <div className="km-head">
        <IconButton label={t("range.prev_month")} onClick={() => step(-1)}>
          ‹
        </IconButton>
        <h2 className="km-title">{dateRange(days.from, days.to)}</h2>
        <IconButton label={t("range.next_month")} disabled={!past} onClick={() => step(1)}>
          ›
        </IconButton>
      </div>
      <p className="km-total">
        {t("rpt.tm_spent")} <strong>{money(r.spentCents, false)}</strong>
        {r.expectedCents !== null && r.gapCents !== null && (
          <>
            , {t("rpt.tm_expected").toLowerCase()} {money(r.expectedCents, false)} ({signedMoney(r.gapCents)})
          </>
        )}
        {noUsual && <>, {t("rpt.tm_needs_months", { count: MIN_COMPARE_MONTHS })}</>}
      </p>
      {!noUsual && <GapReasonNote reason={r.gapReason} className="km-note" />}
      {young && sums.error && !sums.data && <ErrorCard message={sums.error} onRetry={sums.reload} />}
      {(noUsual || r.gapCents !== null) && rows.length > 0 && (
        <Table<GapRow> caption={t(noUsual ? "rpt.tm_sums_caption" : "rpt.tm_cats_caption")} rows={rows} rowKey={(x) => `${x.category ?? ""}:${x.label}`} columns={noUsual ? columns.slice(0, 2) : columns} drillButton={false} />
      )}
      {income !== undefined && (
        <p className="km-income">
          {t("rep.income")} {money(income, false)}
          {usualIncome !== undefined && `, ${t("inc.usual_month").toLowerCase()} ${money(usualIncome, false)}`}
        </p>
      )}
    </div>
  );
}
