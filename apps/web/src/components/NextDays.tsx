// Decision: do I have enough on the account until the pay comes
import { useState } from "react";
import { query } from "../api.ts";
import { LineChart } from "../charts/LineChart.tsx";
import { completeMonths, dayMonth, money, plural } from "../format.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import "../styles/ahead.css";
import { type Ahead, figures, footnote, heading, listCaption, payLine, warning } from "./next-days.ts";

type Row = Ahead["rows"][number];

const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents));

/**
 * What the household has to know before the next pay: the payday, the payments before it, the usual everyday spending,
 * what is left on the last day, and with a checking balance its line. The pay is the last line, apart from the rows.
 * Laskut > Tulossa lists the same payments and lets a bill be added.
 */
export function NextDays({ ahead }: { ahead: Ahead }) {
  const { rows, balance } = ahead;
  const head = heading(ahead);
  const low = warning(ahead);
  const pay = payLine(ahead);
  const bills = rows.filter((r) => r.cents < 0);
  // bills first, each in date order; other pay that lands before the payday comes after them
  const listed = [...bills, ...rows.filter((r) => r.cents > 0)];

  return (
    <>
      <div className="card-head">
        <div>
          <h2>{head.title}</h2>
          <div className="card-sub">{head.sub}</div>
        </div>
      </div>
      {low && <div className="notice warning ahead-verdict">{low}</div>}
      <dl className="ahead-figures">
        {figures(ahead).map((f) => (
          <div key={f.key} className={f.key === "left" ? "ahead-figure ahead-figure-left" : "ahead-figure"}>
            <dt>
              {f.label}
              {f.note && <span className="small muted">{f.note}</span>}
            </dt>
            <dd>{money(f.cents, false)}</dd>
          </div>
        ))}
      </dl>
      {balance && <BalanceChart ahead={ahead} balance={balance} />}
      {listed.length === 0 && !pay && <p className="small muted">Laskut ja palkkapäivät näkyvät, kun sama maksu on tullut kahdesti.</p>}
      {listed.length > 0 && (
        <table className="compact">
          <caption className="sr-only">{listCaption(ahead)}</caption>
          <tbody>
            {listed.map((r, i) => (
              <tr key={`${r.date}-${r.name}-${i}`}>
                <td>
                  <a href={`#/transactions${query({ merchant: r.name })}`}>{r.name}</a>
                </td>
                <td className="num muted">{dayMonth(r.date)}</td>
                <td className={r.cents > 0 ? "num ahead-in" : "num"}>{r.cents > 0 ? signed(r.cents) : money(-r.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pay && (
        <div className="ahead-pay">
          <a href={`#/transactions${query({ merchant: pay.name })}`}>{pay.name}</a>
          <span className="muted">{pay.when}</span>
          <span className="num ahead-in">{signed(pay.cents)}</span>
        </div>
      )}
      {bills.length > 0 && (
        <p className="small ahead-more">
          {plural(bills.length, "maksu", "maksua")} · <a href="#/bills">Laskut</a>
        </p>
      )}
      {ahead.missing === "balance" && (
        <p className="small muted ahead-note">
          Lisää saldo kohdassa <a href={`#/settings#${SETTINGS_ANCHOR.accounts}`}>Asetukset &gt; Tilit</a>, niin näet saldon päivittäin.
        </p>
      )}
      {ahead.missing === "history" && <p className="small muted ahead-note">{`Saldon kehitys näkyy, kun historiassa on ${completeMonths(1)}.`}</p>}
      {balance && <p className="small muted ahead-note">{footnote(balance)}</p>}
    </>
  );
}

/** The balance by day as a line, and the same days as a table. The chart cannot mark a day, so the payday is not drawn on it. */
function BalanceChart({ ahead, balance }: { ahead: Ahead; balance: NonNullable<Ahead["balance"]> }) {
  const [table, setTable] = useState(false);
  const byDay = new Map<string, Row[]>();
  for (const r of ahead.rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);

  return (
    <div className="ahead-balance">
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
    </div>
  );
}
