// Decision: which category to cut or watch, read against the comparison the page is set to and the last twelve months, fixed costs apart
import { useState } from "react";
import { addMonths, type CategoryPart, type CompareKind, type SpendingTableRow, type TableOneOff } from "@banking/core";
import { query } from "../../../api.ts";
import { date, dateRange, language, money, plural, signedMoney } from "../../../format.ts";
import { Estimate, Why } from "../../../components/Why.tsx";
import { DeltaChip } from "../../../components/table/Cells.tsx";
import { DrillRows } from "../../../components/table/DrillRows.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { chosenKind } from "../Compare.tsx";
import { inSpan, negativeTotalNote } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

/** A row whose spending is mostly fixed costs. */
const FIXED = 0.5;
const eur = (cents: number) => money(cents, true);

/** A share that is nothing in this row is a dimmed dash: most categories are all fixed or all variable, and a column of 0,00 € hides the rows that have one. The sum and the CSV still read the cents. */
const part = (cents: number) => (cents === 0 ? <span className="muted">–</span> : eur(cents));

/** The comparison the table reads: the page's choice when rows exist for it (an expected level or a budget has none per category), else the period before. */
function tableKind(kind: CompareKind | null): "previous" | "yearAgo" {
  return kind === "yearAgo" ? "yearAgo" : "previous";
}

/** The parts the server gives under a category, in its order, each its own figure: nothing is added up here. A part that rests on a guessed tie wears "≈". */
function PartsTable({ parts, label }: { parts: CategoryPart[]; label: string }) {
  const columns: Column<CategoryPart>[] = [
    { key: "label", label: t("rpt.st_part"), kind: "text", rowHead: true, cell: (x) => x.label },
    { key: "amount", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (x) => x.cents, cell: (x) => <Estimate when={x.estimated}>{eur(x.cents)}</Estimate> },
  ];
  return <Table<CategoryPart> caption={t("rpt.st_parts", { label })} rows={parts} rowKey={(x) => x.id} columns={columns} toolbar={false} />;
}

function SpendingTable({ ctx }: SectionProps) {
  const r = ctx.data.spendingTable;
  const { range } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  const conclusion = ctx.data.conclusions.menot;
  const asked = conclusion ? chosenKind(conclusion, ctx.compare ?? null) : null;
  const kind = tableKind(asked);
  const earlier = r.periods[kind];
  const name = kind === "yearAgo" ? t("rpt.st_year_ago") : t("rpt.st_previous");
  const comparison = (row: SpendingTableRow) => row[kind];
  const total = r.totals[kind];
  const negative = r.rows.some((x) => x.totalCents < 0);
  // a range that is the twelve months, or those months with the running one instead of the oldest, has the figures of the twelve-month column in its own: the second is left out
  const showYear = !!r.year && !(r.span.from >= r.year.from && r.span.from.slice(0, 7) <= addMonths(r.year.from.slice(0, 7), 1) && r.span.to >= r.year.to);
  const columns: Column<SpendingTableRow>[] = [
    {
      key: "label",
      label: t("rpt.category"),
      kind: "text",
      rowHead: true,
      sort: (x) => x.label,
      search: true,
      chips: [{ key: "fixed", label: t("rpt.st_fixed"), test: (x) => x.totalCents > 0 && x.fixedCents >= FIXED * x.totalCents }],
      csv: (x) => x.label,
      cell: (x) => <a href={`#/transactions${query({ category: x.category, from: range.from, to: range.to })}`}>{x.label}</a>,
    },
    {
      key: "total",
      label: t("rpt.total"),
      kind: "money",
      main: true,
      precision: "cents",
      cents: (x) => x.totalCents,
      sort: true,
      cell: (x) => (
        <Why figure="spend.category" title={x.label} range={range} scope={ctx.scope} category={x.category} text={eur(x.totalCents)}>
          {eur(x.totalCents)}
        </Why>
      ),
    },
    { key: "fixed", label: t("rpt.st_fixed"), kind: "money", precision: "cents", cents: (x) => x.fixedCents, sort: true, cell: (x) => part(x.fixedCents) },
    { key: "variable", label: t("rpt.st_variable"), kind: "money", precision: "cents", cents: (x) => x.variableCents, sort: true, cell: (x) => part(x.variableCents) },
    ...(earlier
      ? [
          { key: "then", label: name, kind: "money" as const, precision: "cents" as const, cents: (x: SpendingTableRow) => comparison(x)?.thenCents ?? null, sort: true as const },
          {
            key: "change",
            label: t("rpt.change"),
            kind: "money" as const,
            sort: (x: SpendingTableRow) => (comparison(x)?.deltaCents ?? 0),
            csv: (x: SpendingTableRow) => (comparison(x) ? comparison(x)!.deltaCents / 100 : null),
            cell: (x: SpendingTableRow) => {
              const c = comparison(x);
              return c && <DeltaChip delta={c.deltaCents} text={signedMoney(c.deltaCents)} meaning="spend" flat={99} />;
            },
          } satisfies Column<SpendingTableRow>,
        ]
      : []),
    ...(showYear ? [{ key: "year", label: t("rpt.st_12"), kind: "money" as const, precision: "cents" as const, cents: (x: SpendingTableRow) => x.yearCents, sort: true as const }] : []),
  ];
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, t("rpt.yoy_datum", { amount: eur(r.totalCents) }))}>
      {r.rows.length === 0 ? (
        <Empty>{t("rpt.st_none")}</Empty>
      ) : (
        <>
          <p className="qc-a">
            {rich("rpt.st_split", { fixed: eur(r.fixedCents), variable: eur(r.variableCents) })}
            {earlier ? ` ${t("rpt.st_compare", { name: language() === "fi" ? name.toLowerCase() : name, range: dateRange(earlier.from, earlier.to), now: total && total.nowCents !== r.totalCents ? t("rpt.st_now", { amount: eur(total.nowCents) }) : "" })}` : ` ${t("rpt.st_no_compare")}`}
            {showYear ? ` ${t("rpt.st_year", { months: plural(r.year!.months, t("rpt.u_month"), t("rpt.u_months")), range: dateRange(r.year!.from, r.year!.to) })}` : ""}
          </p>
          <Table<SpendingTableRow>
            caption={t("rpt.st_caption")}
            searchLabel={t("rpt.st_search")}
            rows={r.rows}
            rowKey={(x) => x.key}
            columns={columns}
            sums={["total", "fixed", "variable", ...(earlier ? ["then"] : []), ...(showYear ? ["year"] : [])]}
            open={open}
            onOpen={setOpen}
            drill={(x) =>
              x.count > 0 ? (
                <>
                  {x.parts?.length ? <PartsTable parts={x.parts} label={x.label} /> : null}
                  <DrillRows
                    name={x.label}
                    filter={{ category: x.category, from: range.from, to: range.to, scope: ctx.scope }}
                    summary={t("rpt.st_summary", { count: plural(x.count, t("rpt.u_event"), t("rpt.u_events")), total: eur(x.totalCents), oneoff: x.oneOffCents ? t("rpt.st_summary_oneoff", { amount: eur(x.oneOffCents) }) : "" })}
                  />
                </>
              ) : null
            }
            drillLabel={(x) => t("rpt.st_drill", { label: x.label })}
            total={{
              label: t("rpt.total"),
              cells: {
                total: (
                  <Why figure="spend.month" title={t("rpt.st_why")} range={range} scope={ctx.scope} text={eur(r.totalCents)}>
                    {eur(r.totalCents)}
                  </Why>
                ),
                fixed: eur(r.fixedCents),
                variable: eur(r.variableCents),
                ...(earlier ? { then: eur(total?.thenCents ?? 0), change: <DeltaChip delta={total?.deltaCents ?? 0} text={signedMoney(total?.deltaCents ?? 0)} meaning="spend" flat={99} /> } : {}),
                ...(showYear ? { year: eur(r.year!.totalCents) } : {}),
              },
            }}
          />
          {negative && <p className="small muted">{negativeTotalNote()}</p>}
          <OneOffs oneOffs={r.oneOffs} totalCents={r.oneOffCents} />
        </>
      )}
    </ReportPanel>
  );
}

/** The purchases made once, by name; they are inside the sums above. */
function OneOffs({ oneOffs, totalCents }: { oneOffs: TableOneOff[]; totalCents: number }) {
  const columns: Column<TableOneOff>[] = [
    { key: "date", label: t("rpt.tm_day"), kind: "date", cell: (x) => (language() === "fi" ? x.date.split("-").reverse().map(Number).join(".") : date(x.date)) },
    { key: "merchant", label: t("rpt.payee"), kind: "text", rowHead: true, cell: (x) => x.merchant },
    { key: "label", label: t("rpt.category"), kind: "text", cell: (x) => x.label },
    { key: "amount", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (x) => x.cents },
  ];
  // a period with none says nothing the household can act on
  if (oneOffs.length === 0) return null;
  return (
    <>
      <h3 className="qc-q rt-title">{t("rpt.st_oneoffs")}</h3>
      <p className="qc-a">{t("rpt.st_oneoff_sum", { count: plural(oneOffs.length, t("rpt.u_piece"), t("rpt.u_pieces")), total: eur(totalCents) })}</p>
      <Table<TableOneOff> caption={t("rpt.st_oneoffs")} rows={oneOffs} rowKey={(x) => x.id} columns={columns} sums={["amount"]} total={{ label: t("rpt.total"), cells: { amount: eur(totalCents) } }} />
    </>
  );
}

export const section: ReportSection = {
  id: "kategoriat",
  get title() {
    return t("rpt.sec_spendingtable");
  },
  order: 30,
  page: "reports",
  reports: ["spendingTable", "conclusions"],
  Component: SpendingTable,
};
