/** The calculation behind one finding: its lines as one line, the monthly sums as a step line with a table view, and the rows it stands on. */
import { useState } from "react";
import { query } from "../../api.ts";
import { date, money, plural } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Scope } from "../../types.ts";
import { MarkCell } from "../table/Cells.tsx";
import { RichTable } from "../table/RichTable.tsx";
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
        <div className="table-wrap">
          <MonthStepsTable sums={sums} change={change} label="Menot" />
        </div>
      ) : (
        <MonthSteps sums={sums} change={change} label="Menot" />
      )}
    </div>
  );
}

function Rows({ rows, household }: { rows: EvidenceResponse["rows"]; household: boolean }) {
  const [all, setAll] = useState(false);
  const newest = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const shown = all ? newest : newest.slice(0, ROWS_SHOWN);
  const showAccount = household && new Set(rows.map((r) => r.accountId)).size > 1;
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>Tapahtumat</h4>
        {rows.some((r) => r.struck) && <span className="small muted">Yliviivattu rivi on kertaluonteinen eikä sitä lasketa mukaan.</span>}
      </div>
      <div className="table-wrap">
        <RichTable density="compact" className="evidence-rows">
          <thead>
            <tr>
              <th scope="col">Päivä</th>
              <th scope="col">Saaja</th>
              {showAccount && (
                <th scope="col" className="hide-phone">
                  Tili
                </th>
              )}
              <th scope="col" className="num">
                Summa
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.struck ? "struck" : undefined}>
                <td className="when">{date(r.date)}</td>
                <td>
                  <MarkCell name={r.merchant} />
                </td>
                {showAccount && <td className="hide-phone">{r.account}</td>}
                <td className="num">
                  {r.struck ? <s>{money(r.amountCents)}</s> : money(r.amountCents)}
                  {r.struck && <span className="sr-only"> (ei mukana laskennassa)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </RichTable>
      </div>
      {rows.length > ROWS_SHOWN && (
        <button className="link-btn small" type="button" onClick={() => setAll((a) => !a)}>
          {all ? "Näytä vain uusimmat" : `Näytä kaikki ${plural(rows.length, "tapahtuma", "tapahtumaa")}`}
        </button>
      )}
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
