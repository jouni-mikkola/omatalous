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
import type { Scope } from "../types.ts";
import { type Column, DataTable } from "./table/DataTable.tsx";
import { Why } from "./Why.tsx";
import { type Ahead, figures, incoming, payNote, payments, paymentsCaption, shortIsEstimate, warning, windowLine } from "./next-days.ts";

type Line = ReturnType<typeof payments>[number];

/**
 * What is due before the next pay, as a statement of two groups: at the left the balance, the payments of the window
 * and what is left, under the line that names the window; at the right the days to the pay with a dot for each payment,
 * the payments one by one and the pay that is to arrive. A dot and its row light each other. Nothing is modelled.
 * Laskut lists the same payments for 30 days and lets a bill be added.
 */
/** `scope` gives the pay the window waits for its door to its basis; without it the sum is printed as it is. */
export function NextDays({ ahead, scope }: { ahead: Ahead; scope?: Scope }) {
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
        {/* the window's one total: what leaves the accounts before the pay */}
        <div className="card-datum">{money(-ahead.totals.dueCents, false)}</div>
      </div>
      {short && <p className={shortIsEstimate(ahead) ? "notice ahead-warning" : "notice warning ahead-warning"}>{short}</p>}
      <div className="st-cols st-cols-3">
        <div>
          <h3 className="st-cap ahead-window">{windowLine(ahead)}</h3>
          {three ? (
            <dl className="st-rows">
              {three.map((f) => (
                <div key={f.key} className={f.key === "free" ? "st-row st-total" : "st-row"}>
                  <dt className="st-name">
                    {f.label}
                  </dt>
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
          {coming.length > 0 && <Lines caption="Saapuvat maksut" head={["Päivä", "Maksaja"]} lines={coming} kind="pay" active={active} onActive={setActive} door={scope ? { range: { from: ahead.from, to: ahead.payday?.date ?? ahead.to }, scope } : undefined} />}
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
  /** The days and view of the pay's basis: the pay the window waits for opens it from its sum. */
  door?: { range: { from: string; to: string }; scope: Scope };
}

/**
 * One of the two tables: the day, the name with the line under it, the sum. A caption the block's heading already says
 * is for a screen reader only. A table with no line says so in its one row. A row is lit when its dot is, and lights it.
 */
function Lines({ caption, hidden = false, head, lines, kind, active, onActive, door }: LinesProps) {
  const columns: Column<Line>[] = [
    {
      key: "day",
      label: head[0],
      kind: "text",
      cell: (l) => (
        <>
          {(kind === "bill" || l.estimate) && <span className={l.estimate ? "src src-est" : "src"} aria-hidden="true" />}
          {l.day}
        </>
      ),
    },
    {
      key: "payee",
      label: head[1],
      kind: "text",
      title: (l) => l.name,
      cell: (l) => {
        const payee = l.merchant ? <a href={`#/transactions${query({ merchant: l.merchant })}`}>{l.name}</a> : l.name;
        return (
          <>
            {l.pending ? <PendingPayee>{payee}</PendingPayee> : payee}
            {l.note && <div className="st-sub">{l.note}</div>}
          </>
        );
      },
    },
    {
      key: "sum",
      label: "Summa",
      kind: "money",
      className: () => "st-num",
      cell: (l) =>
        door && l.payday ? (
          <Why figure="ahead.pay" title={`Palkka, ${l.name}`} range={door.range} scope={door.scope} text={l.payday} estimate="approx">
            {l.payday}
          </Why>
        ) : l.sum !== undefined ? (
          (l.sum ?? "–")
        ) : l.cents === null ? (
          "–"
        ) : (
          money(l.cents)
        ),
    },
  ];
  return (
    <DataTable
      id={`ahead-${kind}`}
      caption={caption}
      captionVisible={!hidden}
      captionClass="st-cap"
      rows={lines}
      rowKey={(l) => String(lines.indexOf(l))}
      columns={columns}
      phone="none"
      className="st-table ahead-table"
      colgroup={["ahead-day", "", "ahead-sum"]}
      empty="Ei erääntyviä maksuja."
      rowClassName={(l) => (active?.kind === kind && active.row === lines.indexOf(l) ? "on" : undefined)}
      rowProps={(l) => {
        const row = lines.indexOf(l);
        return {
          onPointerEnter: () => onActive({ kind, row }),
          onPointerLeave: () => onActive(null),
          onFocus: () => onActive({ kind, row }),
          onBlur: () => onActive(null),
        };
      }}
    />
  );
}
