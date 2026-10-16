// Decision: find the month a category jumped
import { type ReactNode, useState } from "react";
import { monthEnd } from "@banking/core";
import { query } from "../../api.ts";
import { money, monthLong } from "../../format.ts";
import type { ReportsData } from "../../types.ts";
import { toggled } from "../toggled.ts";
import "../../styles/statement.css";
import "../../styles/themes-table.css";
import "../../styles/quality.css";

type Report = ReportsData["pivot"];
type Theme = Report["themes"][number];
type Line = Theme["lines"][number];

/** What a row prints: the month's figure comes from `values`, the rest as the report has it. A payee has no usual level. */
interface Figures {
  values: readonly number[];
  totalCents: number;
  usualCents?: number | null;
  diffCents?: number | null;
}

interface Shared {
  r: Report;
  range: { from: string; to: string };
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A difference with its sign: "+120 €", "−100 €". */
const signed = (cents: number) => `${cents > 0 ? "+" : "−"}${money(Math.abs(cents), false)}`;
/** "Syyskuu" of "2026-09". */
const monthName = (month: string) => capital(monthLong(month).split(" ")[0]!);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function Toggle({ id, label, open, onToggle }: Pick<Shared, "open" | "onToggle"> & { id: string; label: string }) {
  return (
    <button type="button" className="themes-toggle" aria-expanded={open.has(id)} onClick={() => onToggle(id)}>
      <span className="themes-label">{label}</span>
    </button>
  );
}

/** The figures of a row under the heads of the table; without a complete month there is the total alone. */
function Cells({ r, f }: { r: Report; f: Figures }) {
  return (
    <>
      {r.last !== null && (
        <>
          <td className="st-num" data-label={monthName(r.months[r.last]!)}>
            {money(f.values[r.last]!, false)}
          </td>
          <td className="st-num" data-label="Tavallisesti">
            {f.usualCents === undefined ? "" : f.usualCents === null ? "–" : money(f.usualCents, false)}
          </td>
          <td className="st-num" data-label="Ero">
            {f.diffCents ? signed(f.diffCents) : ""}
          </td>
        </>
      )}
      <td className="st-num" data-label="Yhteensä">
        {money(f.totalCents, false)}
      </td>
    </>
  );
}

/** One row of the table; `depth` is how far in it stands (a theme 0, a line 1, a payee 2). */
function Row({ s, id, depth, label, f, children }: { s: Shared; id?: string; depth: number; label: ReactNode; f: Figures; children?: ReactNode }) {
  return (
    <>
      <tr className={`months-row months-depth-${depth}`}>
        <th scope="row" className="st-cut" title={typeof label === "string" ? label : undefined}>
          {id !== undefined ? <Toggle id={id} label={label as string} open={s.open} onToggle={s.onToggle} /> : <span className="themes-plain">{label}</span>}
        </th>
        <Cells r={s.r} f={f} />
      </tr>
      {id !== undefined && s.open.has(id) && children}
    </>
  );
}

/** The link to the rows of a payee in the range of the page. */
function payeeLink(s: Shared, name: string, category: string | null): string {
  return `#/transactions${query({ merchant: name, category, from: s.range.from, to: s.range.to })}`;
}

function LineRows({ s, theme, line, depth }: { s: Shared; theme: string; line: Line; depth: number }) {
  const id = `${theme}/${line.id}`;
  return (
    <Row s={s} id={id} depth={depth} label={line.label} f={line}>
      {line.payees.map((p) => (
        <Row key={p.name} s={s} depth={depth + 1} label={<a href={payeeLink(s, p.name, line.category)}>{p.name}</a>} f={p} />
      ))}
      {line.other && <Row s={s} depth={depth + 1} label={line.other.name} f={line.other} />}
    </Row>
  );
}

function ThemeRows({ s, theme, depth = 0 }: { s: Shared; theme: Theme; depth?: number }) {
  return (
    <Row s={s} id={theme.id} depth={depth} label={theme.label} f={theme}>
      {theme.lines.map((l) => (
        <LineRows key={l.id} s={s} theme={theme.id} line={l} depth={depth + 1} />
      ))}
    </Row>
  );
}

/** The twelve months as columns of the month's spending, the highest marked. */
function Strip({ r }: { r: Report }) {
  const top = Math.max(1, ...r.strip.map((i) => r.monthTotals[i]!));
  return (
    <ol className="months-strip">
      {r.strip.map((i) => (
        <li key={r.months[i]} className={i === r.peak ? "is-peak" : undefined} title={`${monthLong(r.months[i]!)}: ${money(r.monthTotals[i]!, false)}`}>
          <span className="months-bar">
            <i style={{ height: `${Math.max(0, (r.monthTotals[i]! / top) * 100)}%` }} />
          </span>
          <span className="months-name">{Number(r.months[i]!.slice(5))}</span>
        </li>
      ))}
    </ol>
  );
}

/** Where the highest month went: its three largest rows, each the rows of that month in Tapahtumat. */
function Peak({ r }: { r: Report }) {
  if (r.peak === null || !r.peakRows.length) return null;
  const month = r.months[r.peak]!;
  return (
    <ul className="months-peak">
      <li>
        <strong>{capital(monthLong(month))}</strong>
      </li>
      {r.peakRows.map((p) => (
        <li key={p.key}>
          {p.category ? <a href={`#/transactions${query({ category: p.category, from: `${month}-01`, to: monthEnd(month) })}`}>{p.label}</a> : p.label} {money(p.cents, false)}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Menot kuukausittain": the spending by theme, each row opening to its lines and a line to its payees. The newest
 * complete month stands beside the usual level and the difference, and above the rows the strip of the months says which
 * one rose. `range` is the page's period, which the links to Tapahtumat carry.
 */
export function MonthsView({ r, range }: { r: Report; range: { from: string; to: string } }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const s: Shared = { r, range, open, onToggle: (id) => setOpen((o) => toggled(o, id)) };
  const head = r.last === null ? null : monthName(r.months[r.last]!);
  const own: Figures = { values: r.monthTotals, totalCents: r.totalCents };
  return (
    <div className="months-view">
      {r.strip.length > 0 && <Strip r={r} />}
      <Peak r={r} />
      <table className="st-table months-table">
        <thead>
          <tr>
            <td />
            {head && (
              <>
                <th scope="col" className="st-num">
                  {head}
                </th>
                <th scope="col" className="st-num">
                  Tavallisesti
                </th>
                <th scope="col" className="st-num">
                  Ero
                </th>
              </>
            )}
            <th scope="col" className="st-num">
              Yhteensä
            </th>
          </tr>
        </thead>
        <tbody>
          {r.cardBills && <Row s={s} depth={0} label="Luottokortin laskut" f={{ values: r.cardBills, totalCents: sum(r.cardBills) }} />}
          {r.themes.map((t) => (
            <ThemeRows key={t.id} s={s} theme={t} />
          ))}
          {r.rest && (
            <Row s={s} id="rest" depth={0} label="Loput yhteensä" f={r.rest}>
              {r.rest.themes.map((t) => (
                <ThemeRows key={t.id} s={s} theme={t} depth={1} />
              ))}
            </Row>
          )}
          {r.large && <Row s={s} depth={0} label={r.large.count > 0 ? `Suuret hankinnat (${r.large.count})` : "Suuret hankinnat"} f={r.large} />}
          <tr className="months-total">
            <th scope="row">Yhteensä</th>
            <Cells r={r} f={own} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
