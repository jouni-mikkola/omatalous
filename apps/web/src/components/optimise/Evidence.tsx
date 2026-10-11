/** The calculation behind one finding: its lines, the monthly sums with a table view, and the rows it stands on. */
import { useState } from "react";
import { query } from "../../api.ts";
import { MonthColumns } from "../../charts/MonthColumns.tsx";
import { date, money, monthLong, plural } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Scope } from "../../types.ts";
import type { EvidenceResponse } from "./shared.tsx";

/** Rows shown before "Näytä kaikki": the newest, which is what a household checks first. */
const ROWS_SHOWN = 8;

function MonthlySums({ sums }: { sums: EvidenceResponse["sums"] }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState(-1);
  if (!sums.some((s) => s.cents !== 0)) return null;
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>Kuukausittain</h4>
        <button className="btn btn-small" type="button" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? "Kaavio" : "Taulukko"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>Kuukausi</th>
                <th className="num">Summa</th>
              </tr>
            </thead>
            <tbody>
              {sums.map((s) => (
                <tr key={s.month}>
                  <td>{monthLong(s.month)}</td>
                  <td className="num">{money(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <MonthColumns
          months={sums.map((s) => s.month)}
          values={sums.map((s) => s.cents)}
          average={null}
          inPeriod={() => true}
          complete={sums.map(() => true)}
          active={hover ?? pinned}
          pinned={pinned}
          onHover={setHover}
          onPick={(i) => setPinned((p) => (p === i ? -1 : i))}
          height={170}
        />
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
        {rows.some((r) => r.struck) && <span className="small muted">Yliviivattu rivi on kertaluonteinen eikä sitä ole laskettu mukaan.</span>}
      </div>
      <div className="table-wrap">
        <table className="compact evidence-rows">
          <thead>
            <tr>
              <th>Päivä</th>
              <th>Kauppias</th>
              {showAccount && <th className="hide-phone">Tili</th>}
              <th className="num">Summa</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.struck ? "struck" : undefined}>
                <td className="when">{date(r.date)}</td>
                <td>{r.merchant}</td>
                {showAccount && <td className="hide-phone">{r.account}</td>}
                <td className="num">
                  {r.struck ? <s>{money(r.amountCents)}</s> : money(r.amountCents)}
                  {r.struck && <span className="sr-only"> (ei mukana laskennassa)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <dl className="calc">
          {data.calc.map((line, i) => (
            <div key={i} className={line.struck ? "struck" : undefined}>
              <dt>{line.label}</dt>
              <dd>{line.struck ? <s>{line.value}</s> : line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <MonthlySums sums={data.sums} />
      {data.rows.length > 0 && <Rows rows={data.rows} household={scope === "household"} />}
      {merchants.length > 0 && (
        <p className="small muted evidence-check">
          Onko luokittelu väärin? Tarkista tapahtumat:{" "}
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
