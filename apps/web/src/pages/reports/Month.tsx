// Decision: which category explains this month or an earlier one, read against what each usually costs to the same day
import { useState } from "react";
import { addMonths, type GapRow, MIN_COMPARE_MONTHS, monthEnd, spentRows, type ThisMonthReport } from "@banking/core";
import { query } from "../../api.ts";
import { css } from "../../css.ts";
import { ErrorCard } from "../../components/ErrorCard.tsx";
import { type Column, Table } from "../../components/table/Table.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { Why } from "../../components/Why.tsx";
import { dateRange, money, monthLong, signedMoney } from "../../format.ts";
import { navigate, useApi, useHashRoute } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Meta, ReportsData, Scope } from "../../types.ts";
import { GapReasonNote } from "./sections/ThisMonth.tsx";
import type { ReportRange } from "./types.ts";
import "../../styles/report-month.css";

/** The rows with the largest gap over the usual first, so the category that explains the month leads; the rest row is last. */
function byGap(rows: readonly GapRow[]): GapRow[] {
  return [...rows].sort((a, b) => Number(a.category === null) - Number(b.category === null) || Number(b.gapCents > a.gapCents) - Number(b.gapCents < a.gapCents));
}

/** A row of the list; `child` marks a category listed under the rest row. */
type TableRow = GapRow & { child?: true };

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

/** The heading of a month, "Lokakuu 2026", and the days read when they are not the whole month (the running month to today), else null. */
function monthHeading(month: string, days: { from: string; to: string }): { title: string; days: string | null } {
  const name = monthLong(month);
  const whole = days.from === `${month}-01` && days.to === monthEnd(month);
  return { title: name.charAt(0).toUpperCase() + name.slice(1), days: whole ? null : dateRange(days.from, days.to) };
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
 * range ends in): a category's spending, its usual level and their difference, which add up to the total's. Without a
 * usual there is only what was spent, and the report's reason for it when it has one.
 */
function earlier(data: ReportsData, month: string): Shown {
  const change = data.spendingChange.views.find((v) => v.view === "expected" && v.change.target.months.join() === month)?.change;
  if (!change) return { month, days: { from: `${month}-01`, to: monthEnd(month) }, spentCents: data.categories.totalCents, expectedCents: null, gapCents: null, gapReason: data.spendingChange.gapReason, categories: [] };
  const categories = change.categories.map((c): GapRow => ({ category: c.category, day: null, label: c.category === null ? t("rep.other_categories") : c.label, spentCents: c.nowCents, expectedCents: c.baseCents, gapCents: c.changeCents }));
  return { month, days: { from: change.target.from, to: change.target.to }, spentCents: change.nowCents, expectedCents: change.baseCents, gapCents: change.changeCents, gapReason: null, categories };
}

/**
 * Kuukausi: a month's spending by category, each against its usual to the same day, the list in the order of the gap. It
 * opens on the running month to today; the arrows step a month back and forward, and an earlier month is in the address
 * (`?month=`) and read whole. A category opens the rows its sum is made of. Income is one line under the list.
 */
export function Month({ meta, scope }: { meta: Meta; range?: ReportRange; scope: Scope }) {
  const past = earlierMonth(useHashRoute().params, meta.today);
  const path = past ? query({ from: `${past}-01`, to: monthEnd(past), scope, reports: "spendingChange,categories,income" }) : query({ from: `${meta.today.slice(0, 7)}-01`, to: meta.today, scope, reports: "thisMonth,income,categories" });
  const { data, error, loading, reload } = useApi<ReportsData>(`/api/reports${path}`);
  const [restOpen, setRestOpen] = useState(false);
  // with no usual (too short a history, or a card's purchases missing before) the running month's categories are asked for with their sums alone
  const young = !past && !!data && Object.hasOwn(data, "thisMonth") && data.thisMonth.gapReason !== null;
  const sums = useApi<ReportsData>(young ? `/api/reports${query({ from: `${meta.today.slice(0, 7)}-01`, to: meta.today, scope, reports: "categories" })}` : null);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  // the answer kept while the next month loads is of the other kind: it is shown again only when it has this month's reports
  if (!data || !Object.hasOwn(data, past ? "spendingChange" : "thisMonth")) return <div className="stack" aria-busy="true"><span className="sk sk-title" aria-hidden="true" /><span className="sk sk-line" aria-hidden="true" /></div>;
  const r: Shown = past ? earlier(data, past) : { ...data.thisMonth, days: { from: `${data.thisMonth.month}-01`, to: meta.today } };
  const days = r.days;
  const heading = monthHeading(r.month, days);
  const step = (n: number) => {
    const to = addMonths(past ?? meta.today.slice(0, 7), n);
    navigate("reports", { month: to < meta.today.slice(0, 7) ? to : undefined }, true);
  };
  // no usual level: a reason, or none when the month's rows end before the month does
  const noUsual = r.expectedCents === null;
  const rows = noUsual ? spentRows((past ? data.categories : sums.data?.categories)?.groups ?? []) : byGap(r.categories);
  const scale = Math.max(1, ...rows.flatMap((x) => [x.spentCents, x.expectedCents]));
  // the categories the rest row holds: the month's spending categories that are not a row above it
  const hasRest = !noUsual && rows.some((x) => x.category === null);
  const shownIds = new Set(rows.flatMap((x) => (x.category === null ? [] : [x.category])));
  const inRest: TableRow[] = hasRest ? spentRows(data.categories?.groups ?? []).filter((x) => x.category !== null && !shownIds.has(x.category)).map((x) => ({ ...x, child: true })) : [];
  const tableRows: TableRow[] = restOpen ? rows.flatMap((x): TableRow[] => (x.category === null ? [x, ...inRest] : [x])) : rows;
  // the earned income and its usual level, the two figures of Yhteenveto's income tile (the income report takes both from `earnedIncome` and `expectedIncome`)
  const incomeMonth = data.income.months.find((m) => m.month === r.month);
  const columns: Column<TableRow>[] = [
    {
      key: "name",
      label: t("rpt.tm_cat"),
      kind: "text",
      rowHead: true,
      cell: (x) =>
        x.category === null && hasRest ? (
          <button type="button" className="km-rest" aria-expanded={restOpen} onClick={() => setRestOpen(!restOpen)}>
            {x.label}
          </button>
        ) : x.child ? (
          <span className="km-child">{x.label}</span>
        ) : (
          x.label
        ),
    },
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
      cell: (x) =>
        x.child ? null : (
          <span className="km-usual">
            <Bar row={x} scale={scale} />
            {money(x.expectedCents)}
          </span>
        ),
    },
    { key: "gap", label: t("rpt.tm_gap"), kind: "money", cell: (x) => (x.child ? null : signedMoney(x.gapCents)) },
  ];
  return (
    <div className={loading ? "km stack loading" : "km stack"}>
      <div className="km-head">
        <IconButton label={t("range.prev_month")} onClick={() => step(-1)}>
          ‹
        </IconButton>
        <div className="km-name">
          <h2 className="km-title">{heading.title}</h2>
          {heading.days && <p className="km-days">{heading.days}</p>}
        </div>
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
        {r.gapReason === "history" && <>, {t("rpt.tm_needs_months", { count: MIN_COMPARE_MONTHS })}</>}
      </p>
      {r.gapReason === "cards" && <GapReasonNote reason={r.gapReason} className="km-note" />}
      {young && sums.error && !sums.data && <ErrorCard message={sums.error} onRetry={sums.reload} />}
      {(noUsual || r.gapCents !== null) && rows.length > 0 && (
        <Table<TableRow> caption={t(noUsual ? "rpt.tm_sums_caption" : "rpt.tm_cats_caption")} rows={tableRows} rowKey={(x) => `${x.child ? "in:" : ""}${x.category ?? ""}:${x.label}`} columns={noUsual ? columns.slice(0, 2) : columns} drillButton={false} />
      )}
      {incomeMonth && (
        <p className="km-income">
          {t("rep.income")} {money(incomeMonth.earnedCents, false)}
          {incomeMonth.usualCents !== null && `, ${t("rpt.tm_usual_income", { sum: money(incomeMonth.usualCents, false) })}`}
        </p>
      )}
    </div>
  );
}
