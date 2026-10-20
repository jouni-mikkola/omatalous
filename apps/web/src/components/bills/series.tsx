import { useState } from "react";
import { CADENCE_LABEL, date, money, monthYear } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { DataTable, type Column } from "../table/DataTable.tsx";
import { ContractPanel } from "./ContractPanel.tsx";

/** "kuukausittain", or "11 kertaa vuodessa" for a monthly fee with a summer break. */
function frequency(s: Series): string {
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? `${perYear} kertaa vuodessa` : CADENCE_LABEL[s.cadence] ?? "–";
}

/** One table of series, widest columns hidden on a phone. A contract's lines open under its row from the start under the name. */
export function SeriesTable({ rows, label, ended, contract }: { rows: readonly Series[]; label: (id: string) => string; ended?: boolean; contract?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const contractOf = (s: Series) => (contract ? s.contract : undefined);
  const columns: Column<Series>[] = [
    {
      key: "merchant",
      label: "Saaja",
      kind: "text",
      cell: (s) => {
        const c = contractOf(s);
        return (
          <>
            <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
            {s.priceChange && (
              <span className={`badge ${s.priceChange.toCents > s.priceChange.fromCents ? "warn" : "good"}`}>
                {money(s.priceChange.fromCents)} → {money(s.priceChange.toCents)}
              </span>
            )}
            <div className="sub">{label(s.category)}</div>
            {c && (
              <button type="button" className="contract-toggle" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                {monthYear(c.startDate)} alkaen
              </button>
            )}
          </>
        );
      },
    },
    { key: "frequency", label: "Tiheys", kind: "text", phone: "hide", cell: frequency },
    { key: "typical", label: "Summa", kind: "money", phone: "hide", cell: (s) => money(s.typicalAmountCents) },
    { key: "month", label: "Kuussa", kind: "money", className: () => "sum", cell: (s) => <strong>{money(s.monthlyCents, false)}</strong> },
    { key: "year", label: "Vuodessa", kind: "money", phone: "hide", cell: (s) => money(s.yearlyCents, false) },
    {
      key: "next",
      label: ended ? "Viimeksi" : "Seuraava",
      kind: "date",
      className: () => "next",
      cell: (s) =>
        ended ? (
          date(s.lastDate)
        ) : s.overdue ? (
          <span className="badge warn" title={`Odotettiin ${date(s.nextDate)}`}>
            Myöhässä
          </span>
        ) : (
          date(s.nextDate)
        ),
    },
  ];
  return (
    <div className="table-wrap">
      <DataTable<Series>
        id={ended ? "series-ended" : "series"}
        caption={ended ? "Päättyneet sopimukset ja tilaukset" : "Sopimukset ja tilaukset"}
        rows={[...rows]}
        rowKey={(s) => s.id}
        columns={columns}
        phone="none"
        plain
        className="series-table"
        open={open}
        onOpen={setOpen}
        drillButton={false}
        drill={(s) => {
          const c = contractOf(s);
          return c ? <ContractPanel contract={c} /> : null;
        }}
      />
    </div>
  );
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
