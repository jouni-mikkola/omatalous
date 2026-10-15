// Decision: does the account cover what is due before the next pay
import { useState } from "react";
import { query } from "../api.ts";
import { dayMonth, money } from "../format.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import "../styles/ahead.css";
import "../styles/statement.css";
import { type Active, NextDaysLine } from "./NextDaysLine.tsx";
import { billLine } from "./next-days-line.ts";
import { PendingPayee } from "./PendingPayee.tsx";
import { type Ahead, figures, incoming, payNote, payments, paymentsCaption, warning, windowLine } from "./next-days.ts";

type Line = ReturnType<typeof payments>[number];

/**
 * What is due before the next pay, as a statement of two groups: at the left the balance, the payments of the window
 * and what is left, under the line that names the window; at the right the days to the pay with a dot for each payment,
 * the payments one by one and the pay that is to arrive. A dot and its row light each other. Nothing is modelled.
 * Laskut lists the same payments for 30 days and lets a bill be added.
 */
export function NextDays({ ahead }: { ahead: Ahead }) {
  const three = figures(ahead);
  const short = warning(ahead);
  const due = payments(ahead);
  const coming = incoming(ahead);
  const varies = payNote(ahead);
  const line = billLine(ahead);
  const [active, setActive] = useState<Active>(null);

  return (
    <section className="card st-block" aria-labelledby="ahead-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="ahead-h">Erääntyvät maksut</h2>
        </div>
        <div className="card-datum">
          {dayMonth(ahead.from)}–{dayMonth(ahead.to)}
        </div>
      </div>
      {short && <p className="notice warning ahead-warning">{short}</p>}
      <div className="st-cols st-cols-3">
        <div>
          <h3 className="st-cap ahead-window">{windowLine(ahead)}</h3>
          {three ? (
            <dl className="st-rows">
              {three.map((f) => (
                <div key={f.key} className={f.key === "free" ? "st-row st-total" : "st-row"}>
                  <dt className="st-name">{f.label}</dt>
                  <dd className="st-num">{money(f.cents)}</dd>
                  {f.notes.map((note) => (
                    <dd key={note} className="st-sub">
                      {note}
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          ) : (
            <p className="ahead-missing">
              Tilin saldo ei ole tiedossa. <a href={`#/settings#${SETTINGS_ANCHOR.accounts}`}>Lisää saldo</a>
            </p>
          )}
        </div>
        <div className="st-wide">
          {due.some((l) => l.estimate) && <p className="st-note ahead-estimates">Eräpäivät ja summat ovat arvioita.</p>}
          {line && <NextDaysLine line={line} active={active} onActive={setActive} />}
          <Lines caption={paymentsCaption(ahead)} hidden head={["Eräpäivä", "Saaja"]} lines={due} kind="bill" active={active} onActive={setActive} />
          {coming.length > 0 && <Lines caption="Saapuvat maksut" head={["Päivä", "Maksaja"]} lines={coming} kind="pay" active={active} onActive={setActive} />}
          {varies && <p className="st-note ahead-pay-note">{varies}</p>}
          <p className="st-links">
            <a href="#/bills">Laskut</a>
            <a href="#/bills">Lisää lasku</a>
          </p>
        </div>
      </div>
    </section>
  );
}

interface LinesProps {
  caption: string;
  hidden?: boolean;
  head: [string, string];
  lines: Line[];
  /** The dots of the line this table's rows go with. */
  kind: "bill" | "pay";
  active: Active;
  onActive: (a: Active) => void;
}

/**
 * One of the two tables: the day, the name with the line under it, the sum. A caption the block's heading already says
 * is for a screen reader only. A table with no line says so in its one row. A row is lit when its dot is, and lights it.
 */
function Lines({ caption, hidden = false, head, lines, kind, active, onActive }: LinesProps) {
  return (
    <table className="st-table ahead-table">
      <caption className={hidden ? "sr-only" : "st-cap"}>{caption}</caption>
      <colgroup>
        <col className="ahead-day" />
        <col />
        <col className="ahead-sum" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{head[0]}</th>
          <th scope="col">{head[1]}</th>
          <th scope="col" className="st-num">
            Summa
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => {
          const payee = l.merchant ? <a href={`#/transactions${query({ merchant: l.merchant })}`}>{l.name}</a> : l.name;
          return (
          <tr
            key={`${l.day}-${l.name}-${i}`}
            className={active?.kind === kind && active.row === i ? "on" : undefined}
            onPointerEnter={() => onActive({ kind, row: i })}
            onPointerLeave={() => onActive(null)}
            onFocus={() => onActive({ kind, row: i })}
            onBlur={() => onActive(null)}
          >
            <td>
              {(kind === "bill" || l.estimate) && <span className={l.estimate ? "src src-est" : "src"} aria-hidden="true" />}
              {l.day}
            </td>
            <td title={l.name}>
              {l.pending ? <PendingPayee>{payee}</PendingPayee> : payee}
              {l.note && <div className="st-sub">{l.note}</div>}
            </td>
            <td className="st-num">{l.sum === undefined ? money(l.cents) : (l.sum ?? "–")}</td>
          </tr>
          );
        })}
        {lines.length === 0 && (
          <tr>
            <td colSpan={3}>Ei erääntyviä maksuja.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
