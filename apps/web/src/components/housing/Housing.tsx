/**
 * Decision: what the home costs a month, and whether the household has a home loan to add. Yhteenveto shows it as the
 * block Asuminen, a statement: the table Lainat with the terms the household typed, one row a loan; under it the table
 * Asumiskulut, one row a charge, beside the sums. Every figure is the one in `housing` (the answer Yhteenveto already
 * loads); nothing here adds anything up. With no loan the charges stand alone and the total is the foot of their
 * table. Whether a household with no home loan has one is asked in Tarkistettavat, never here.
 */
import type { CSSProperties } from "react";
import { query } from "../../api.ts";
import { money } from "../../format.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import type { DashboardData } from "../../types.ts";
import { type Column, DataTable } from "../table/DataTable.tsx";
import { DASH, housingView, LOAN_COLUMNS } from "./housing.ts";
import "../../styles/statement.css";
import "../../styles/housing.css";

const SETTINGS_LOANS = `#/settings#${SETTINGS_ANCHOR.loans}`;
const NEXT_PAYMENT = "Seuraava maksuerä";
const paymentsOf = (payee: string) => `#/transactions${query({ merchant: payee })}`;

type View = ReturnType<typeof housingView>;
type Row = View["loans"][number];

/**
 * The table Lainat. From 1040 px it is a table with a head; below that each loan is a grid of the same labels and
 * values (housing.css), so every cell carries its label and the group head of the next payment for that form.
 */
function Loans({ rows, reportAnchor }: { rows: View["loans"]; reportAnchor: string }) {
  // the column of the links is there only when a row has one: without it the months stand on the block's right edge
  const linked = rows.some((row) => row.link !== null);
  const next = LOAN_COLUMNS.filter((c) => c.next);
  const before = LOAN_COLUMNS.filter((c) => !c.next && c.key !== "month");
  const loanColumn = (c: (typeof LOAN_COLUMNS)[number]): Column<Row>[] => [
    // the group head of the next payment stands in the first cell of that group, for the form of a phone (housing.css)
    ...(c.key === "due" ? [{ key: "group", label: NEXT_PAYMENT, kind: "text" as const, className: () => "housing-group", cell: () => NEXT_PAYMENT }] : []),
    {
      key: c.key,
      label: c.head,
      kind: c.figure ? "money" : "text",
      className: () => `housing-${c.key}${c.figure ? " st-num" : ""}`,
      cell: (row) => (
        <>
          <span className="housing-label">{c.head}</span>
          <span>{row.cells[c.key]}</span>
        </>
      ),
    },
  ];
  const columns: Column<Row>[] = [
    {
      key: "name",
      label: "Laina",
      kind: "text",
      rowHead: true,
      className: () => "housing-name",
      title: (row) => row.name,
      cell: (row) => (
        <>
          <a href={row.saved ? `#/reports#${reportAnchor}` : paymentsOf(row.name)}>{row.name}</a>
          {row.lender && <span className="st-sub">{row.lender}</span>}
          {row.part && <span className="st-sub">{row.part}</span>}
        </>
      ),
    },
    ...LOAN_COLUMNS.flatMap(loanColumn),
    ...(linked
      ? [{ key: "link", label: "", kind: "text" as const, className: () => "housing-link", cell: (row: Row) => (row.link ? <a href={SETTINGS_LOANS}>{row.link}</a> : null) }]
      : []),
  ];
  const figureHead = (c: { figure: boolean }) => (c.figure ? "st-num" : undefined);
  return (
    <div className="st-part">
      <h3 className="st-cap" id="housing-loans-h">
        Lainat
      </h3>
      <DataTable<Row>
        id="housing-loans"
        caption="Lainat"
        rows={rows}
        rowKey={(row) => row.key}
        columns={columns}
        phone="none"
        plain
        className="st-table housing-loans"
        headTop={{
          covered: ["name", ...before.map((c) => c.key), "group", "month", ...(linked ? ["link"] : [])],
          cells: [
            { key: "name", label: "Laina", rowSpan: 2 },
            ...before.map((c) => ({ key: c.key, label: c.head, rowSpan: 2, className: figureHead(c) })),
            { key: "next", label: NEXT_PAYMENT, colSpan: next.length },
            { key: "month", label: "Kuussa", rowSpan: 2, className: "st-num" },
            ...(linked ? [{ key: "link", label: "", rowSpan: 2, empty: true }] : []),
          ],
        }}
      />
    </div>
  );
}

type ChargeRowView = View["charges"][number];

/** `total` is the block's one sum, told as the table's foot where the charges stand alone. */
function Charges({ rows, addsUp, total }: { rows: View["charges"]; addsUp: boolean; total?: View["sums"][number] }) {
  const columns: Column<ChargeRowView>[] = [
    {
      key: "kind",
      label: "Kulu",
      kind: "text",
      cell: (row) => (
        <>
          {row.kind}
          {row.part && <span className="st-sub">{row.part}</span>}
        </>
      ),
    },
    {
      key: "payee",
      label: "Saaja",
      kind: "text",
      className: () => "st-cut",
      title: (row) => row.payee,
      cell: (row) => <a href={paymentsOf(row.payee)}>{row.payee}</a>,
    },
    {
      key: "cents",
      label: "Kuussa",
      kind: "money",
      className: (row) => `st-num sum${row.share ? " share" : ""}`,
      style: (row) => (row.share ? ({ "--from": row.share.from, "--part": row.share.part } as CSSProperties) : undefined),
      cell: (row) => money(row.cents),
    },
  ];
  return (
    <>
      <h3 className="st-cap" id="housing-charges-h">
        Asumiskulut
      </h3>
      <DataTable<ChargeRowView>
        id="housing-charges"
        caption="Asumiskulut"
        rows={rows}
        rowKey={(row) => row.key}
        columns={columns}
        phone="none"
        plain
        className="st-table housing-charges"
        sums={addsUp ? ["cents"] : undefined}
        total={total && { label: total.label, cells: { cents: <span className="st-num">{total.cents === null ? DASH : money(total.cents)}</span> } }}
      />
    </>
  );
}

function Sums({ view }: { view: View }) {
  return (
    <>
      <dl className={`st-rows housing-sums${view.sumsAddUp ? " adds-up" : ""}`}>
        {view.sums.map((sum, i) => (
          <div key={sum.label} className={sum.total ? "st-row st-total" : `st-row${view.sumsAddUp ? (i === 0 ? " part-first" : " part-last") : ""}`}>
            <dt className="st-name">{sum.label}</dt>
            <dd className="st-num">{sum.cents === null ? DASH : money(sum.cents)}</dd>
          </div>
        ))}
      </dl>
      {view.missing && <p className="st-note">{view.missing}</p>}
    </>
  );
}

/**
 * `housing` is the running month's answer and is null when there is nothing to show; `reportAnchor` is the section of
 * Raportit that tells a loan's payments, which the page that mounts the block names.
 */
export function Housing({ housing, reportAnchor }: { housing: NonNullable<DashboardData["housing"]>; reportAnchor: string }) {
  const view = housingView(housing);
  if (view.sums.length === 0) return null;
  // with no loan the one sum is the charges' own total: the foot of their table, in one column
  const alone = view.loans.length === 0 && view.charges.length > 0;

  return (
    <section className="card st-block housing" aria-labelledby="housing-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="housing-h">Asuminen</h2>
        </div>
        {/* the block's one total, as its last sum row has it */}
        {view.sums.at(-1)?.cents != null && <div className="card-datum">{money(view.sums.at(-1)!.cents!, false)}/kk</div>}
      </div>
      {view.loans.length > 0 && <Loans rows={view.loans} reportAnchor={reportAnchor} />}
      {alone ? (
        <Charges rows={view.charges} addsUp={view.chargesAddUp} total={view.sums.at(-1)} />
      ) : view.charges.length > 0 ? (
        <div className="st-cols st-cols-3">
          <div className="st-wide">
            <Charges rows={view.charges} addsUp={view.chargesAddUp} />
          </div>
          <div className="housing-total">
            <Sums view={view} />
          </div>
        </div>
      ) : (
        <div className="st-part">
          <Sums view={view} />
        </div>
      )}
    </section>
  );
}
