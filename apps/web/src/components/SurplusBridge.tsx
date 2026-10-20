// Decision: move money to savings
import { DataTable } from "./table/DataTable.tsx";
import { type ReactNode, useState } from "react";
import type { BridgeView } from "@banking/core";
import { money, percent, shareText } from "../format.ts";
import { type DrawnLine, type BridgePart, bridgeDraws, bridgeFigures, bridgeParts, bridgeRows, bridgeSources, bridgeText } from "./month-parts.ts";
import { TableToggle } from "./TableToggle.tsx";
import type { Scope } from "../types.ts";
import { Why } from "./Why.tsx";
import "../styles/charts.css";
import "../styles/month.css";

/** Money that came in without being income, each line with the colour it has in the strip. */
function Drawn({ lines }: { lines: DrawnLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <p key={l.key} className="bridge-drawn">
          <i className="swatch" style={{ background: l.color }} />
          {l.text}
          {l.stayed && ` ${l.stayed}`}
        </p>
      ))}
    </>
  );
}

function Segments({ parts }: { parts: BridgePart[] }) {
  return (
    <>
      {parts.filter((p) => p.cents > 0).map((p) => (
        <span key={p.key} className="bridge-seg" style={{ width: `${p.share * 100}%`, backgroundColor: p.color }} title={`${p.label} ${money(p.cents, false)}`} />
      ))}
    </>
  );
}

/**
 * Where the income went: one bar split into spending, debt service, saving and what stayed on the accounts, always in
 * that order. When the income was not all the money, a strip over the bar shows on the same axis where the rest came
 * from: credit, savings, the accounts or a card. A sentence says how a gap was paid, and credit drawn is named with
 * the period's debt service: it is never income. The table is the same sum row by row: what came in less what went
 * out is Yli jäi. A period with no income or with a part below zero has no bar and is told by the table alone
 * (`bridgeDraws`). The server gives the bar of months that are over (`CashflowReport.bridge`: the running month has its
 * bills but often not its salary).
 */
export function SurplusBridge({ view, title, heading: Heading = "h3", sub, leftWhy }: { view: BridgeView; title?: string; heading?: "h2" | "h3"; sub?: ReactNode; leftWhy?: { range: { from: string; to: string }; scope: Scope } }) {
  const [table, setTable] = useState(false);
  const { totals } = view;
  const draws = bridgeDraws(view);
  const rows = bridgeRows(view);
  const text = bridgeText(view);
  const head = title && (
    <div>
      <Heading className="bridge-title">{title}</Heading>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
  const none = totals.incomeCents <= 0 && <p className="muted small">Jaksolla ei ole tuloja.</p>;

  // a period with nothing in it
  if (rows.every((r) => r.cents === 0)) {
    return (
      <div className="bridge">
        {head && <div className="bridge-head">{head}</div>}
        {none}
      </div>
    );
  }

  const parts = bridgeParts(view);
  const sources = bridgeSources(view);
  const figures = bridgeFigures(view);
  // the server rounds the shares of the income together, so the table and the legend both add up to 100 %
  const share = (f: { incomeUnits: number | null; incomeShare: number | null }) => (f.incomeUnits === null ? percent(f.incomeShare ?? 0) : shareText(f.incomeUnits));
  const shares = rows.some((r) => r.ofIncome);
  const cell = (r: (typeof rows)[number], v: string) => (r.side === "stayed" ? <strong>{v}</strong> : v);
  const said = [
    `Tulot ${money(totals.incomeCents, false)}: ${parts
      .filter((p) => p.cents > 0)
      .map((p) => `${p.label} ${money(p.cents, false)}`)
      .join(", ")}.`,
    text.gap,
    ...text.drawn.flatMap((l) => [l.text, l.stayed]),
  ];

  return (
    <div className="bridge">
      {(head || draws) && (
        <div className="bridge-head">
          {head || <span />}
          {draws && (
            <TableToggle table={table} onChange={setTable} />
          )}
        </div>
      )}
      {none}
      {table || !draws ? (
        <DataTable
          id="surplus-bridge"
          caption="Tulot ja mihin ne menivät taulukkona"
          rows={rows}
          rowKey={(r) => r.key}
          phone="cards"
          columns={[
            { key: "item", label: "Erä", kind: "text", rowHead: true, cell: (r) => cell(r, r.label) },
            {
              key: "sum",
              label: "Summa",
              kind: "money",
              main: true,
              cell: (r) =>
                leftWhy && r.key === "left" ? (
                  <Why figure="yli_jai.month" title={r.label} range={leftWhy.range} scope={leftWhy.scope} text={money(r.cents, false)}>
                    {cell(r, money(r.cents, false))}
                  </Why>
                ) : (
                  cell(r, money(r.cents, false))
                ),
            },
            ...(shares ? [{ key: "share", label: "Osuus tuloista", kind: "share" as const, cell: (r: (typeof rows)[number]) => (r.ofIncome ? share(r) : "–") }] : []),
          ]}
        />
      ) : (
        <>
          <div className="bridge-track" role="img" aria-label={said.filter(Boolean).join(" ")}>
            {sources.length > 0 && (
              <div className="bridge-from">
                <Segments parts={sources} />
              </div>
            )}
            <div className="bridge-bar">
              <Segments parts={parts} />
            </div>
          </div>
          <div className="bridge-legend">
            {figures.map((f) => (
              <div key={f.key}>
                <span className="k">
                  {(f.key !== "income" || sources.length > 0) && <i className="swatch" style={{ background: f.color }} />}
                  {f.label}
                </span>
                <span className="v">{money(f.cents, false)}</span>
                {f.ofIncome && <small>{share(f)} tuloista</small>}
              </div>
            ))}
          </div>
        </>
      )}
      {text.gap && <p className="bridge-gap">{text.gap}</p>}
      <Drawn lines={text.drawn} />
    </div>
  );
}
