// Decision: move money to savings
import { type ReactNode, useState } from "react";
import { money, percent } from "../format.ts";
import { type DrawnLine, type BridgePart, type BridgeTotals, bridgeDraws, bridgeFigures, bridgeParts, bridgeRows, bridgeSources, bridgeText } from "./month-parts.ts";
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
  const shown = parts.filter((p) => p.cents > 0);
  const whole = shown.reduce((s, p) => s + p.cents, 0);
  return (
    <>
      {shown.map((p) => (
        <span key={p.key} className="bridge-seg" style={{ width: `${(p.cents / whole) * 100}%`, backgroundColor: p.color }} title={`${p.label} ${money(p.cents, false)}`} />
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
 * (`bridgeDraws`). The caller gives the totals of months that are over (the running month has its bills but often not
 * its salary).
 */
export function SurplusBridge({ totals, title, heading: Heading = "h3", sub }: { totals: BridgeTotals; title?: string; heading?: "h2" | "h3"; sub?: ReactNode }) {
  const [table, setTable] = useState(false);
  const draws = bridgeDraws(totals);
  const rows = bridgeRows(totals);
  const text = bridgeText(totals);
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

  const parts = bridgeParts(totals);
  const sources = bridgeSources(totals);
  const figures = bridgeFigures(totals);
  const share = (cents: number) => percent(cents / totals.incomeCents);
  const shares = rows.some((r) => r.ofIncome);
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
            <button className="btn btn-small" onClick={() => setTable((v) => !v)} aria-pressed={table}>
              {table ? "Kaavio" : "Taulukko"}
            </button>
          )}
        </div>
      )}
      {none}
      {table || !draws ? (
        <div className="table-wrap">
          <table className="bridge-table">
            <thead>
              <tr>
                <th>Erä</th>
                <th className="num">Summa</th>
                {shares && <th className="num">Osuus tuloista</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cell = (v: string) => (r.side === "stayed" ? <strong>{v}</strong> : v);
                return (
                  <tr key={r.key}>
                    <td>{cell(r.label)}</td>
                    <td className="num">{cell(money(r.cents, false))}</td>
                    {shares && <td className="num">{r.ofIncome ? share(r.cents) : "–"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                {f.ofIncome && <small>{share(f.cents)} tuloista</small>}
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
