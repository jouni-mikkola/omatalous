/**
 * Decision: what the home costs a month, and whether the household has a home loan to add. Kiinteät ja muuttuvat shows it as the
 * block Asuminen, a statement: the table Lainat with the terms the household typed, one row a loan; under it the table
 * Asumiskulut, one row a charge, beside the sums. Every figure is the one in `housing` (the housing report); nothing here adds anything up. With no loan the charges stand alone and the total is the foot of their
 * table. Whether a household with no home loan has one is asked in Tarkistettavat, never here.
 */
import { query } from "../../api.ts";
import { money } from "../../format.ts";
import { t } from "../../text.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import type { ReportsData } from "../../types.ts";
import { type Column, Table } from "../table/Table.tsx";
import { DASH, housingView, LOAN_COLUMNS } from "./housing.ts";
import "../../styles/statement.css";
import "../../styles/housing.css";

const SETTINGS_LOANS = settingsCardHash(SETTINGS_ANCHOR.loans);
const paymentsOf = (payee: string) => `#/transactions${query({ merchant: payee })}`;

type View = ReturnType<typeof housingView>;
type Row = View["loans"][number];

/**
 * The table Lainat: one row a loan, the terms after its name. The three columns of the next payment stand under the group
 * head "Seuraava maksuerä", and on a phone each carries it in its name.
 */
function Loans({ rows, reportAnchor }: { rows: View["loans"]; reportAnchor: string }) {
  // the column of the links is there only when a row has one: without it the months stand on the block's right edge
  const linked = rows.some((row) => row.link !== null);
  const next = LOAN_COLUMNS.filter((c) => c.next);
  const before = LOAN_COLUMNS.filter((c) => !c.next && c.key !== "month");
  const loanColumn = (c: (typeof LOAN_COLUMNS)[number]): Column<Row> => ({
    key: c.key,
    label: t(c.head),
    text: c.next ? `${t("rpt.ho_next")}: ${t(c.head).toLowerCase()}` : t(c.head),
    kind: c.figure ? "money" : "text",
    main: c.key === "month",
    className: () => `housing-${c.key}`,
    cell: (row) => row.cells[c.key],
  });
  const columns: Column<Row>[] = [
    {
      key: "name",
      label: t("rpt.ho_loan"),
      kind: "text",
      rowHead: true,
      className: () => "housing-name",
      title: (row) => row.name,
      cell: (row) => (
        <>
          <a href={row.saved ? `#/reports#${reportAnchor}` : paymentsOf(row.name)}>{row.name}</a>
          {row.lender && <span className="sub">{row.lender}</span>}
          {row.part && <span className="sub">{row.part}</span>}
        </>
      ),
    },
    ...LOAN_COLUMNS.map(loanColumn),
    ...(linked
      ? [{ key: "link", label: t("rpt.ho_actions"), headHidden: true, kind: "text" as const, className: () => "housing-link", cell: (row: Row) => (row.link ? <a href={SETTINGS_LOANS}>{t(row.link === "complete" ? "rpt.ho_complete" : "rpt.ho_add_loan")}</a> : null) }]
      : []),
  ];
  const figureHead = (c: { figure: boolean }) => (c.figure ? "num" : undefined);
  return (
    <div className="st-part">
      <h3 className="st-cap" id="housing-loans-h">
        {t("rpt.ho_loans")}
      </h3>
      <Table<Row>
        caption={t("rpt.ho_loans")}
        rows={rows}
        rowKey={(row) => row.key}
        columns={columns}
        className="housing-loans"
        headTop={{
          covered: ["name", ...before.map((c) => c.key), "group", "month", ...(linked ? ["link"] : [])],
          cells: [
            { key: "name", label: t("rpt.ho_loan"), rowSpan: 2 },
            ...before.map((c) => ({ key: c.key, label: t(c.head), rowSpan: 2, className: figureHead(c) })),
            { key: "next", label: t("rpt.ho_next"), colSpan: next.length },
            { key: "month", label: t("rpt.fc_per_month"), rowSpan: 2, className: "num" },
            ...(linked ? [{ key: "link", label: t("rpt.ho_actions"), rowSpan: 2, hidden: true }] : []),
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
      label: t("rpt.ho_charge"),
      kind: "text",
      rowHead: true,
      cell: (row) => (
        <>
          {row.kind}
          {row.part && <span className="sub">{row.part}</span>}
        </>
      ),
    },
    {
      key: "payee",
      label: t("rpt.ho_payee"),
      kind: "text",
      title: (row) => row.payee,
      cell: (row) => <a href={paymentsOf(row.payee)}>{row.payee}</a>,
    },
    {
      key: "cents",
      label: t("rpt.fc_per_month"),
      kind: "money",
      main: true,
      className: (row) => `sum${row.share ? " share" : ""}`,
      style: (row) => (row.share ? { "--from": row.share.from, "--part": row.share.part } : { "--from": undefined, "--part": undefined }),
      cell: (row) => money(row.cents),
    },
  ];
  return (
    <>
      <h3 className="st-cap" id="housing-charges-h">
        {t("rpt.ho_charges")}
      </h3>
      <Table<ChargeRowView>
        caption={t("rpt.ho_charges")}
        rows={rows}
        rowKey={(row) => row.key}
        columns={columns}
        className="housing-charges"
        sums={addsUp ? ["cents"] : undefined}
        total={total && { label: total.label, cells: { cents: total.cents === null ? DASH : money(total.cents) } }}
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
export function Housing({ housing, reportAnchor }: { housing: NonNullable<ReportsData["housing"]>; reportAnchor: string }) {
  const view = housingView(housing);
  if (view.sums.length === 0) return null;
  // with no loan the one sum is the charges' own total: the foot of their table, in one column
  const alone = view.loans.length === 0 && view.charges.length > 0;

  return (
    <section className="card st-block housing" aria-labelledby="housing-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="housing-h">{t("rpt.ho_title")}</h2>
        </div>
        {/* the block's one total, as its last sum row has it */}
        {view.sums.at(-1)?.cents != null && <div className="card-datum">{t("rpt.ln_per_month", { amount: money(view.sums.at(-1)!.cents!, false) })}</div>}
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
