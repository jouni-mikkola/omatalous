/** The calculation behind one finding: its lines as one line, the monthly sums as a step line with a table view, and the rows it stands on. */
import { useState } from "react";
import { query } from "../../api.ts";
import { date, money, plural } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Scope } from "../../types.ts";
import { MarkCell } from "../table/Cells.tsx";
import { Table } from "../table/Table.tsx";
import { TableToggle } from "../TableToggle.tsx";
import { MonthSteps, MonthStepsTable } from "./MonthSteps.tsx";
import type { EvidenceResponse } from "@banking/core";

/** Rows shown before "Näytä kaikki": the newest, which is what a household checks first. */
const ROWS_SHOWN = 8;

/** What the tip measures, a month a step, the change it is about marked; Taulukko shows the same months as rows. */
function MonthlySums({ sums, change }: Pick<EvidenceResponse, "sums" | "change">) {
  const [table, setTable] = useState(false);
  if (!sums.some((s) => s.cents !== 0)) return null;
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>Kuukausittain</h4>
        <TableToggle table={table} onChange={setTable} />
      </div>
      {table ? (
        <MonthStepsTable sums={sums} change={change} label="Menot" />
      ) : (
        <MonthSteps sums={sums} change={change} label="Menot" />
      )}
    </div>
  );
}

function Rows({ rows, household }: { rows: EvidenceResponse["rows"]; household: boolean }) {
  const newest = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const showAccount = household && new Set(rows.map((r) => r.accountId)).size > 1;
  type Row = EvidenceResponse["rows"][number];
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>Tapahtumat</h4>
        {rows.some((r) => r.struck) && <span className="small muted">Yliviivattu rivi on kertaluonteinen eikä sitä lasketa mukaan.</span>}
      </div>
      <Table<Row>
        caption="Laskelman tapahtumat"
        className="evidence-rows"
        rows={newest}
        rowKey={(r) => r.id}
        page={ROWS_SHOWN}
        rowClassName={(r) => (r.struck ? "struck" : undefined)}
        columns={[
          { key: "date", label: "Päivä", kind: "date", className: () => "when", cell: (r) => date(r.date) },
          { key: "merchant", label: "Saaja", kind: "text", rowHead: true, cell: (r) => <MarkCell name={r.merchant} /> },
          ...(showAccount ? [{ key: "account", label: "Tili", kind: "text" as const, phone: "hide" as const, cell: (r: Row) => r.account }] : []),
          {
            key: "sum",
            label: "Summa",
            kind: "money",
            main: true,
            cell: (r) => (
              <>
                {r.struck ? <s>{money(r.amountCents)}</s> : money(r.amountCents)}
                {r.struck && <span className="sr-only"> (ei mukana laskennassa)</span>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

export function Evidence({ id, scope }: { id: string; scope: Scope }) {
  const { data, error } = useApi<EvidenceResponse>(`/api/optimise/evidence${query({ id, scope })}`);
  if (error && !data) return <div className="evidence error" role="alert">Laskelman haku epäonnistui. {error}</div>;
  if (!data) return <div className="evidence muted" role="status">Ladataan…</div>;
  const merchants = [...new Set(data.rows.map((r) => r.merchant))].slice(0, 4);
  return (
    <div className="evidence">
      <div className="evidence-part">
        <div className="evidence-head">
          <h4>Laskelma</h4>
        </div>
        {/* the calculation is one line: each figure with its name, the struck ones taken out */}
        <dl className="calc-line">
          {data.calc.map((line, i) => (
            <div key={i} className={line.struck ? "struck" : undefined}>
              <dt>{line.label}</dt>
              <dd>{line.struck ? <s>{line.value}</s> : line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <MonthlySums sums={data.sums} change={data.change} />
      {data.rows.length > 0 && <Rows rows={data.rows} household={scope === "household"} />}
      {merchants.length > 0 && (
        <p className="small muted evidence-check">
          Jos luokittelu on väärin, korjaa se tapahtumissa:{" "}
          {merchants.map((m, i) => (
            <span key={m}>
              {i > 0 && ", "}
              <a href={`#/transactions${query({ merchant: m })}`}>{m}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
