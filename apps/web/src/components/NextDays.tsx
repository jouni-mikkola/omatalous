// Decision: when to move money to the checking account before pay day
import { useState } from "react";
import { query } from "../api.ts";
import { LineChart } from "../charts/LineChart.tsx";
import { date, dayMonth, money } from "../format.ts";
import type { DashboardData } from "../types.ts";
import "../styles/ahead.css";

type Ahead = NonNullable<DashboardData["ahead"]>;
type Row = Ahead["rows"][number];

const SHOWN = 6;

const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents));

/** What the household has to know before the next pay day: the dated rows, and with a checking balance its line. */
export function NextDays({ ahead }: { ahead: Ahead }) {
  const [all, setAll] = useState(false);
  const { rows, balance } = ahead;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const incoming = rows.filter((r) => r.cents > 0).reduce((sum, r) => sum + r.cents, 0);
  const outgoing = rows.filter((r) => r.cents < 0).reduce((sum, r) => sum - r.cents, 0);
  const totals = [outgoing ? `Menoja ${money(outgoing, false)}` : null, incoming ? `${outgoing ? "tuloja" : "Tuloja"} ${money(incoming, false)}` : null].filter(Boolean).join(", ");

  return (
    <>
      <div className="card-head">
        <div>
          <h2>Seuraavat 30 päivää</h2>
          {totals && <div className="card-sub">{totals}</div>}
        </div>
      </div>
      {balance && <BalanceLine ahead={ahead} balance={balance} />}
      {rows.length === 0 ? (
        <p className="small muted">Laskut ja palkkapäivät näkyvät, kun sama maksu on tullut kahdesti.</p>
      ) : (
        <table className="compact">
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.date}-${r.name}-${i}`}>
                <td>
                  {r.source === "expected" ? (
                    <>
                      {r.name} <span className="muted">· lisätty käsin</span>
                    </>
                  ) : (
                    <a href={`#/transactions${query({ merchant: r.name })}`}>{r.name}</a>
                  )}
                </td>
                <td className="num muted">{dayMonth(r.date)}</td>
                <td className={r.cents > 0 ? "num ahead-in" : "num"}>{signed(r.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > SHOWN && (
        <button className="btn btn-small ahead-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${rows.length})`}
        </button>
      )}
      {ahead.missing === "balance" && (
        <p className="small muted ahead-note">
          Lisää saldo kohdassa <a href="#/settings">Asetukset &gt; Tilit</a>, niin näet saldon päivittäin.
        </p>
      )}
      {ahead.missing === "history" && <p className="small muted ahead-note">Saldon kehitys näkyy ensimmäisen kokonaisen kuukauden jälkeen.</p>}
    </>
  );
}

/** The lowest point in words, the balance as a line, and the same days as a table. */
function BalanceLine({ ahead, balance }: { ahead: Ahead; balance: NonNullable<Ahead["balance"]> }) {
  const [table, setTable] = useState(false);
  const { lowest } = balance;
  const negative = lowest.cents < 0;
  const byDay = new Map<string, Row[]>();
  for (const r of ahead.rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);

  return (
    <div className="ahead-balance">
      <div className={negative ? "notice warning ahead-verdict" : "ahead-verdict"}>
        {`Alin saldo ${money(lowest.cents, false)} (${dayMonth(lowest.date)})${negative ? ", tili jää miinukselle" : ""}.`}
      </div>
      <div className="ahead-chart-head">
        <span className="small muted">Tilin saldo päivän lopussa</span>
        <button className="btn btn-small" type="button" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? "Kaavio" : "Taulukko"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap ahead-table">
          <table className="compact">
            <thead>
              <tr>
                <th>Päivä</th>
                <th>Maksut</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {balance.days.map((d) => (
                <tr key={d.date}>
                  <td className="muted">{dayMonth(d.date)}</td>
                  <td>{(byDay.get(d.date) ?? []).map((r) => `${r.name} ${signed(r.cents)}`).join(", ")}</td>
                  <td className="num">{money(d.cents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart labels={balance.days.map((d) => dayMonth(d.date))} series={[{ key: "balance", label: "Saldo", color: "var(--series-1)", values: balance.days.map((d) => d.cents) }]} height={170} />
      )}
      <p className="small muted ahead-note">
        Lähtösaldo {money(balance.startCents, false)}
        {balance.balanceAt ? ` (${date(balance.balanceAt)})` : ""}. Ostokset ilman laskuja ja tilauksia: tavallisesti {money(ahead.everydayPerDayCents, false)} päivässä.
        Siirrot omien tilien välillä eivät ole mukana.
      </p>
    </div>
  );
}
