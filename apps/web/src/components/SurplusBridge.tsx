// Decision: move money to savings
import { type ReactNode, useState } from "react";
import { money, percent } from "../format.ts";
import type { DashboardData } from "../types.ts";
import { bridgeParts } from "./month-parts.ts";
import "../styles/charts.css";
import "../styles/month.css";

type Totals = Pick<DashboardData["totals"], "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "leftCents">;

/**
 * Where the income went: one bar split into spending, debt service, saving and what stayed on the accounts, always
 * in that order. When spending and saving exceed the income there is no remainder, and a mark shows where the income
 * ends. The caller gives the totals of months that are over (the running month has its bills but often not its salary).
 */
export function SurplusBridge({ totals, title, heading: Heading = "h3", sub }: { totals: Totals; title?: string; heading?: "h2" | "h3"; sub?: ReactNode }) {
  const [table, setTable] = useState(false);
  const { incomeCents: income, consumptionCents: consumption, debtCents: debt, savedCents: saved, leftCents: left } = totals;
  const over = left < 0;
  const share = (cents: number) => (income > 0 ? percent(cents / income) : "–");

  if (income <= 0) {
    return (
      <div className="bridge">
        {title && (
          <div className="card-head bridge-head">
            <div>
              <Heading className="bridge-title">{title}</Heading>
              {sub && <div className="card-sub">{sub}</div>}
            </div>
          </div>
        )}
        <p className="muted small">Jaksolla ei ole tuloja. Jako näkyy, kun jaksolle tulee palkka tai muuta tuloa.</p>
      </div>
    );
  }

  const parts = bridgeParts(totals);
  const whole = parts.reduce((s, p) => s + p.cents, 0);
  const label = `Tulot ${money(income, false)}: ${parts.filter((p) => p.cents > 0).map((p) => `${p.label} ${money(p.cents, false)}`).join(", ")}${over ? `. Menoja ${money(-left, false)} enemmän kuin tuloja` : ""}`;

  return (
    <div className="bridge">
      <div className="card-head bridge-head">
        {title ? (
          <div>
            <Heading className="bridge-title">{title}</Heading>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
        ) : (
          <span />
        )}
        <button className="btn btn-small" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? "Kaavio" : "Taulukko"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="bridge-table">
            <thead>
              <tr>
                <th>Erä</th>
                <th className="num">Summa</th>
                <th className="num">Osuus tuloista</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tulot</td>
                <td className="num">{money(income, false)}</td>
                <td className="num">100 %</td>
              </tr>
              {[parts[0]!, parts[1]!].map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="num">{money(p.cents, false)}</td>
                  <td className="num">{share(p.cents)}</td>
                </tr>
              ))}
              <tr>
                <td>Säästöön</td>
                <td className="num">{money(saved, false)}</td>
                <td className="num">{share(saved)}</td>
              </tr>
              <tr>
                <td>
                  <strong>{over ? "Menot ylittivät tulot" : "Yli jäi"}</strong>
                </td>
                <td className="num">
                  <strong>{money(over ? -left : left, false)}</strong>
                </td>
                <td className="num">{share(over ? -left : left)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="bridge-track">
            <div className="bridge-bar" role="img" aria-label={label}>
              {parts
                .filter((p) => p.cents > 0)
                .map((p) => (
                  <span key={p.key} className="bridge-seg" style={{ width: `${(p.cents / whole) * 100}%`, background: p.color }} />
                ))}
            </div>
            {over && <span className="bridge-mark" style={{ left: `${(income / whole) * 100}%` }} title={`Tulot ${money(income, false)}`} />}
          </div>
          <div className="bridge-legend">
            <div>
              <span className="k">Tulot</span>
              <span className="v">{money(income, false)}</span>
            </div>
            {parts
              .filter((p) => p.key !== "left" || !over)
              .map((p) => (
                <div key={p.key}>
                  <span className="k">
                    <i className="swatch" style={{ background: p.color }} />
                    {p.label}
                  </span>
                  <span className="v">{money(p.key === "saved" ? saved : p.cents, false)}</span>
                  <small>{share(p.key === "saved" ? saved : p.cents)} tuloista</small>
                </div>
              ))}
          </div>
          {over && <p className="bridge-over">Menoja {money(-left, false)} enemmän kuin tuloja</p>}
          {saved < 0 && <p className="muted small">Säästöistä nostettiin {money(-saved, false)}. Se kuuluu lukuun Yli jäi.</p>}
        </>
      )}
    </div>
  );
}
