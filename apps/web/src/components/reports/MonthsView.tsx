// Decision: find the month a category jumped
import { type ReactNode, useState } from "react";
import { monthEnd } from "@banking/core";
import { query } from "../../api.ts";
import { money, monthLong } from "../../format.ts";
import type { ReportsData } from "../../types.ts";
import { DataTable, type Column } from "../table/DataTable.tsx";
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

/** One visible row of the table, the tree already flattened by what is open. */
interface Item {
  id: string;
  depth: number;
  label: ReactNode;
  /** The key of a row that opens; plain rows have none. */
  toggle?: string;
  f: Figures;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A difference with its sign: "+120 €", "−100 €". */
const signed = (cents: number) => `${cents > 0 ? "+" : "−"}${money(Math.abs(cents), false)}`;
/** "Syyskuu" of "2026-09". */
const monthName = (month: string) => capital(monthLong(month).split(" ")[0]!);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The link to the rows of a payee in the range of the page. */
function payeeLink(range: { from: string; to: string }, name: string, category: string | null): string {
  return `#/transactions${query({ merchant: name, category, from: range.from, to: range.to })}`;
}

/** The rows under the open ones, depth first: a theme opens to its lines and a line to its payees. */
function flatten(r: Report, range: { from: string; to: string }, open: ReadonlySet<string>): Item[] {
  const out: Item[] = [];
  const add = (item: Item, children?: () => void) => {
    out.push(item);
    if (item.toggle !== undefined && open.has(item.toggle)) children?.();
  };
  const theme = (t: Theme, depth: number) =>
    add({ id: t.id, depth, label: t.label, toggle: t.id, f: t }, () => {
      for (const l of t.lines) {
        const id = `${t.id}/${l.id}`;
        add({ id, depth: depth + 1, label: l.label, toggle: id, f: l }, () => {
          for (const p of l.payees) {
            out.push({ id: `${id}/p:${p.name}`, depth: depth + 2, label: <a href={payeeLink(range, p.name, l.category)}>{p.name}</a>, f: p });
          }
          if (l.other) out.push({ id: `${id}/other`, depth: depth + 2, label: l.other.name, f: l.other });
        });
      }
    });
  if (r.cardBills) out.push({ id: "card-bills", depth: 0, label: "Luottokortin laskut", f: { values: r.cardBills, totalCents: sum(r.cardBills) } });
  for (const t of r.themes) theme(t, 0);
  const rest = r.rest;
  if (rest) add({ id: "rest", depth: 0, label: "Loput yhteensä", toggle: "rest", f: rest }, () => rest.themes.forEach((t) => theme(t, 1)));
  if (r.large) out.push({ id: "large", depth: 0, label: r.large.count > 0 ? `Suuret hankinnat (${r.large.count})` : "Suuret hankinnat", f: r.large });
  return out;
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
  const last = r.last;
  const own: Figures = { values: r.monthTotals, totalCents: r.totalCents };
  const columns: Column<Item>[] = [
    {
      key: "name",
      label: <span className="sr-only">Rivi</span>,
      text: "Rivi",
      kind: "text",
      rowHead: true,
      cell: (i) =>
        i.toggle !== undefined ? (
          <button type="button" className="themes-toggle" aria-expanded={open.has(i.toggle)} onClick={() => setOpen((o) => toggled(o, i.toggle!))}>
            <span className="themes-label" title={typeof i.label === "string" ? i.label : undefined}>
              {i.label}
            </span>
          </button>
        ) : (
          <span className="themes-plain">{i.label}</span>
        ),
    },
    ...(last === null
      ? []
      : ([
          { key: "month", label: monthName(r.months[last]!), kind: "money", cell: (i) => money(i.f.values[last]!, false) },
          {
            key: "usual",
            label: "Tavallisesti",
            kind: "money",
            cell: (i) => (i.f.usualCents === undefined ? "" : i.f.usualCents === null ? "–" : money(i.f.usualCents, false)),
          },
          { key: "diff", label: "Ero", kind: "money", cell: (i) => (i.f.diffCents ? signed(i.f.diffCents) : "") },
        ] satisfies Column<Item>[])),
    { key: "total", label: "Yhteensä", kind: "money", cell: (i) => money(i.f.totalCents, false) },
  ];
  const cells: Record<string, ReactNode> = {
    ...(last === null ? {} : { month: money(own.values[last]!, false) }),
    total: money(own.totalCents, false),
  };
  return (
    <div className="months-view">
      {r.strip.length > 0 && <Strip r={r} />}
      <Peak r={r} />
      <DataTable
        id="months"
        caption="Menot kuukausittain"
        className="st-table months-table"
        phone="scroll"
        rows={flatten(r, range, open)}
        rowKey={(i) => i.id}
        rowClassName={(i) => `months-row months-depth-${i.depth}`}
        columns={columns}
        total={{ label: "Yhteensä", cells }}
      />
    </div>
  );
}
