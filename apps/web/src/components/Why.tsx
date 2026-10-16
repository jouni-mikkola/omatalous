// Decision: the figure the app infers is itself the button that opens its rows in a panel; the names come from the list the page already reads
import { type Explanation, type FigureId, type Reason, sentenceOf } from "@banking/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { dayMonth, money, monthLong } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { Meta, Scope, TransactionItem } from "../types.ts";
import "../styles/why.css";

/** The rows shown before "Näytä kaikki". */
const FIRST_ROWS = 50;

/** The figures the panel can open. */
export type WhyFigureId = Exclude<FigureId, "settlement.over">;

interface WhyFigure {
  figure: WhyFigureId;
  /** The name of the figure, as its row says it. */
  title: string;
  range: { from: string; to: string };
  scope: Scope;
  category?: string;
  /** `share.part`: the row whose part the figure is. */
  row?: string;
  /** What the button shows: the figure, or the waterfall's bar. */
  children: ReactNode;
  /** The figure's own text: its visible words belong to the button's name. A bar has none. */
  text?: string;
  /** The class of the button; the figure's dotted underline by default. */
  className?: string;
}

/** "Täsmää" when a sum adds up, the difference when it does not (never left out); a median or an estimate has no such line. */
function checkText(check: Explanation["check"]): string | null {
  if (check.kind === "n/a") return null;
  if (check.diffCents === 0) return check.kind === "sum" ? "Täsmää" : null;
  return `Ero ${money(check.diffCents)}`;
}

type Line = Explanation["lines"][number];

/** The one reason a row says, first in this order; the app's own category rule is what nearly every row has, so it says nothing (the category name stands alone). */
const ORDER = [
  "transfer.pair",
  "transfer.channel",
  "card.bill",
  "return.shop",
  "return.person",
  "return.share",
  "refund.net",
  "part.use",
  "category.hand",
  "category.own_rule",
] as const;
function reasonOf(why: readonly Reason[]): string | undefined {
  for (const rule of ORDER) {
    const r = why.find((x) => x.rule === rule);
    if (r) return sentenceOf(r);
  }
  return undefined;
}

/** What names a row of a part: the fraction of the user's part, and the cent no one could share. */
function shareNote(why: readonly Reason[]): string | undefined {
  const use = why.find((r) => r.rule === "part.use");
  const cent = why.find((r) => r.rule === "rounding.cent");
  const parts = [use ? `Osuus ${Number(use.to) - Number(use.from)}/${use.of}` : null, cent ? sentenceOf(cent) : null].filter(Boolean);
  return parts.length ? parts.join(". ") : undefined;
}

/** The names the answer's ids stand for, read from the lists the page has. */
interface Names {
  rows: Map<string, TransactionItem>;
  labels: Map<string, string>;
  members: Map<string, string>;
}

/** The figure as the button that opens the panel of its rows. */
export function Why({ children, text, className = "why-fig", ...panel }: WhyFigure) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" aria-label={text ? `Näytä rivit: ${panel.title} ${text}` : `Näytä rivit: ${panel.title}`} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <WhyPanel {...panel} onClose={() => setOpen(false)} />}
    </>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whom or what a line of the answer is about. */
function nameOf(l: Line, figure: WhyFigureId, names: Names): string {
  if (figure === "share.part") return l.id.startsWith("u:") ? (names.members.get(l.id.slice(2)) ?? "–") : l.why[0] ? sentenceOf(l.why[0]) : "–";
  return names.rows.get(l.id)?.merchant ?? "–";
}

interface Shown {
  figure: WhyFigureId;
  names: Names;
}

/** One line of the answer as two table rows: the day, the name and the cents, then what is said under them. */
function lineRows(l: Line, key: string, shown: Shown, kind: "counted" | "left" | "plain"): ReactNode[] {
  const { figure, names } = shown;
  const tx = names.rows.get(l.id);
  const category = kind === "counted" && tx ? (names.labels.get(tx.category) ?? tx.category) : undefined;
  const reason = figure === "share.part" ? shareNote(l.why) : kind === "plain" ? undefined : reasonOf(l.why);
  const mark = kind === "left" ? { "data-why-left": l.id } : kind === "counted" ? { "data-why-row": l.id } : {};
  return [
    <tr key={key} {...mark}>
      <td>{dayMonth(l.day)}</td>
      <td>{nameOf(l, figure, names)}</td>
      <td className="num">{money(l.cents)}</td>
    </tr>,
    ...(category || reason || (l.whole !== undefined && figure !== "share.part")
      ? [
          <tr key={`${key}-why`} className="why-more">
            <td colSpan={3}>
              {category && <div>{category}</div>}
              {reason && <div className="why-reason">{reason}</div>}
              {l.whole !== undefined && figure !== "share.part" && <div className="why-reason">Pankin ilmoittama saldo {money(l.whole)}</div>}
            </td>
          </tr>,
        ]
      : []),
  ];
}

const head = (who: string) => (
  <thead>
    <tr>
      <th scope="col">Päivä</th>
      <th scope="col">{who}</th>
      <th scope="col" className="num">
        Summa
      </th>
    </tr>
  </thead>
);

/** A month of a median: its figure, and its rows once it is opened. */
function Month({ label, cents, lines, shown }: { label: string; cents: number; lines: Line[]; shown: Shown }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="why-month" data-why-month={label} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>
        <span>{capital(monthLong(label))}</span>
        <span className="num">{money(cents)}</span>
      </summary>
      {open && (
        <table className="why-rows">
          {head("Saaja")}
          <tbody>{lines.filter((l) => l.cents !== 0).flatMap((l) => lineRows(l, l.id, shown, "counted"))}</tbody>
        </table>
      )}
    </details>
  );
}

function WhyPanel({ figure, title, range, scope, category, row, onClose }: Omit<WhyFigure, "children" | "className" | "text"> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const why = useApi<Explanation>(`/api/explain${query({ figure, ...range, scope, category, row })}`);
  const e = why.data;
  // the answer holds ids only: a row is named by the list of rows the page reads for the same days; a usual level
  // reaches back before the range, so its list waits for the answer to tell how far
  const waits = figure.startsWith("usual");
  const needsRows = figure !== "share.part";
  const earliest = e ? [range.from, ...e.lines.map((l) => l.day), ...(e.method?.kind === "median" ? e.method.values.map((v) => `${v.label}-01`) : [])].sort()[0]! : range.from;
  const rows = useApi<{ items: TransactionItem[] }>(needsRows && (e || !waits) ? `/api/transactions${query({ from: earliest, to: range.to, scope, limit: 5000 })}` : null);
  const meta = useApi<Pick<Meta, "categories" | "members">>("/api/meta");
  const names: Names = {
    rows: new Map((rows.data?.items ?? []).map((t) => [t.id, t])),
    labels: new Map((meta.data?.categories ?? []).map((c) => [c.id, c.label])),
    members: new Map((meta.data?.members ?? []).map((m) => [m.id, m.displayName])),
  };
  const shown: Shown = { figure, names };
  // a row the figure left out counts nothing: it stands in the closed group at the foot, never between the counted rows
  const splits = e?.kind === "sum";
  const counted = e ? (splits ? e.lines.filter((l) => l.cents !== 0) : e.lines) : [];
  const left = e && splits ? e.lines.filter((l) => l.cents === 0) : [];
  const shownRows = all ? counted : counted.slice(0, FIRST_ROWS);
  const kind = splits ? "counted" : "plain";
  const check = e ? checkText(e.check) : null;
  const method = e?.method;
  const whole = figure === "share.part" ? e?.lines[0]?.whole : undefined;
  return (
    <dialog
      ref={ref}
      className="why"
      aria-labelledby="why-title"
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
    >
      <h2 id="why-title">{title}</h2>
      {why.error && <p role="alert">{why.error}</p>}
      {!e && !why.error && <p role="status">Ladataan…</p>}
      {e && (
        <>
          <div className="why-scroll">
            {method?.kind === "median" && (
              <>
                {method.values.map((v) => (
                  <Month key={v.label} label={v.label} cents={v.cents} lines={v.explain?.lines ?? []} shown={shown} />
                ))}
                <p className="why-reason">{e.cents === null ? capital(method.rule) : `${method.rule}. ${method.tie}`}</p>
              </>
            )}
            {!method && (
              <>
                <table className="why-rows">
                  {head("Saaja")}
                  <tbody>{shownRows.flatMap((l) => lineRows(l, l.id, shown, kind))}</tbody>
                </table>
                {counted.length > FIRST_ROWS && !all && (
                  <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
                    Näytä kaikki
                  </button>
                )}
              </>
            )}
            {left.length > 0 && (
              <details className="why-left">
                <summary>{`Ei laskettu mukaan: ${left.length === 1 ? "1 tapahtuma" : `${left.length} tapahtumaa`}`}</summary>
                <table className="why-rows">
                  {head("Saaja")}
                  <tbody>{left.flatMap((l) => lineRows(l, `left-${l.id}`, shown, "left"))}</tbody>
                </table>
              </details>
            )}
          </div>
          <div className="why-foot">
            {whole !== undefined && (
              <div className="why-total">
                <span>Pankin ilmoittama saldo</span>
                <span className="num">{money(whole)}</span>
              </div>
            )}
            <div className="why-total">
              <span>{method ? title : "Yhteensä"}</span>
              <span className="num" data-why-total>
                {e.cents === null ? "–" : money(e.cents)}
              </span>
            </div>
            {check && (
              <p className={e.check.kind !== "n/a" && e.check.diffCents !== 0 ? "why-check why-differs" : "why-check"} role="status">
                {check}
              </p>
            )}
          </div>
        </>
      )}
      <div className="form-row">
        <button type="button" className="btn" onClick={onClose}>
          Sulje
        </button>
      </div>
    </dialog>
  );
}
