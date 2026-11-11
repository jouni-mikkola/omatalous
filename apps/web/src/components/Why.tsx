// Decision: the figure the app infers is itself the button that opens its rows in a panel; the names come from the list the page already reads
import { type Explanation, type FigureId, isLoanFigure, type Reason, sentenceOf } from "@banking/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { query } from "../api.ts";
import { dateRange, dayMonth, money, monthLong } from "../format.ts";
import { useApi, useMeta } from "../hooks.ts";
import type { Scope } from "../types.ts";
import { MarkCell } from "./table/Cells.tsx";
import { type Column, Table } from "./table/Table.tsx";
import "../styles/why.css";
import { Button } from "./ui/Button.tsx";
import { useModal } from "./useModal.ts";
import { t, tn } from "../text.ts";
/** The rows shown before "Näytä kaikki". */
const FIRST_ROWS = 50;

/** The figures the panel can open. */
type WhyFigureId = Exclude<FigureId, "settlement.over">;

interface WhyFigure {
  figure: WhyFigureId;
  /** The name of the figure, as its row says it. */
  title: string;
  range: { from: string; to: string };
  scope: Scope;
  category?: string;
  /** `share.part`: the row whose part the figure is. */
  row?: string;
  /** `share.part`: the row's account, whose users name the lines. */
  account?: string;
  /** `loan.*`: the loan, as the Lainat report and Varat ja velat name it. */
  loan?: string;
  /** What the button shows: the figure, or the waterfall's bar. */
  children: ReactNode;
  /** The figure's own text: its visible words belong to the button's name. A bar has none. */
  text?: string;
  /** The class of the button beside `why-door`, which every door has: `why-fig` (a figure in text) by default. */
  className?: string;
  /** An estimate: "≈" before the figure, or the dotted underline where the sign does not fit. */
  estimate?: EstimateMark;
}

/** How an estimate shows: "≈" before the figure (`approx`), or a dotted underline (`line`) where the sign does not fit. */
type EstimateMark = "approx" | "line";

/**
 * An estimate's figure, the one mark the app has (owner rule): "≈" before it, or the dotted underline in a narrow cell. An
 * exact figure, a zero above all, wears neither, so `when` false gives the figure as it is. A chart or a table draws its
 * estimates with `est-area`, `est-line`, `est-bar` and `est-row` (why.css, the tokens `--estimate-fill` and `--estimate-edge`).
 */
export function Estimate({ when = true, mark = "approx", children }: { when?: boolean; mark?: EstimateMark; children: ReactNode }) {
  if (!when) return <>{children}</>;
  if (mark === "line") return <span className="fig-est">{children}</span>;
  return (
    <span className="fig-approx">
      <span className="fig-approx-sign">≈</span>
      {children}
    </span>
  );
}

/** The same mark where the figure is plain text (a datum, a cell, a sentence a screen reader reads): "≈ 12,40 €". */
export { approxText } from "../approx.ts";

/** The accessible name of a door: what opens, what the figure is, and that an estimate is one. */
/**
 * What a door opens, by the kind of its basis: the rows a sum adds up, a calculation (a loan's figures, whose lines are
 * loans and the steps of a figure), or the sheet of BasisDoor.
 */
type DoorKind = "rows" | "calculation" | "sheet";
const OPENS: Record<DoorKind, "why.show_rows" | "why.show_calc" | "why.show_basis"> = { rows: "why.show_rows", calculation: "why.show_calc", sheet: "why.show_basis" };

/** The kind of a figure's basis: a loan figure is a calculation, every other figure the panel opens is a sum of rows. */
const doorKind = (figure: WhyFigureId): DoorKind => (isLoanFigure(figure) ? "calculation" : "rows");

function doorName(kind: DoorKind, title: string, text?: string, estimate?: boolean): string {
  return `${t(OPENS[kind])}: ${[title, text && estimate ? t("why.estimate", { text }) : text].filter(Boolean).join(" ")}`;
}

/**
 * The door to a basis that opens in place under the figure (BasisSheet, the sheets of the private pages): the same look,
 * keys and name as Why, with `aria-expanded` for the sheet it shows. `text` is the figure as words; `children` draw it when
 * the figure is more than its text. `className` stands beside `why-door` in place of `why-fig`, as Why's does.
 */
export function BasisDoor({ label, text, estimate = false, open, onToggle, controls, className, children }: { label?: string; text: string; estimate?: boolean; open: boolean; onToggle: () => void; controls: string; className?: string; children?: ReactNode }) {
  return (
    <button type="button" className={`why-door ${className ?? "why-fig"}`} aria-expanded={open} aria-controls={controls} aria-label={doorName("sheet", label ?? "", text, estimate)} onClick={onToggle}>
      <Estimate when={estimate}>{children ?? text}</Estimate>
    </button>
  );
}

/** The days a basis covers: "9.10.2026", or "1.10.–31.10.2026" for a range. */
function periodText({ from, to }: { from: string; to: string }): string {
  return dateRange(from, to);
}

/** "Täsmää" when a sum adds up, the difference when it does not (never left out); a median or an estimate has no such line. */
function checkText(check: Explanation["check"]): string | null {
  if (check.kind === "n/a") return null;
  if (check.diffCents === 0) return check.kind === "sum" ? t("why.matches") : null;
  return t("why.difference", { sum: money(check.diffCents) });
}

type Line = Explanation["lines"][number];

/** The one reason a row says, first in this order; the app's own category rule is what nearly every row has, so it says nothing (the category name stands alone). */
const ORDER = [
  "transfer.pair",
  "transfer.channel",
  "card.bill",
  "return.wallet",
  "share.open",
  "share.back",
  "return.shop",
  "return.person",
  "return.share",
  "refund.net",
  "part.use",
  "category.hand",
  "category.own_rule",
] as const;
function reasonOf(why: readonly Reason[], names: Names): string | undefined {
  for (const rule of ORDER) {
    const r = why.find((x) => x.rule === rule);
    // the reason holds the purchase's id and day; its shop is one of the rows the answer names
    if (r) return sentenceOf(rule === "return.wallet" ? { ...r, shop: names.rows.get(String(r.purchase))?.merchant ?? "" } : r);
  }
  return undefined;
}

/** The payment service a row went through, as its own line under the row. */
const viaOf = (why: readonly Reason[]): string | undefined => {
  const r = why.find((x) => x.rule === "via.service");
  return r ? sentenceOf(r) : undefined;
};

/** What names a row of a part: the fraction of the user's part, and the cent no one could share. */
function shareNote(why: readonly Reason[]): string | undefined {
  const use = why.find((r) => r.rule === "part.use");
  const cent = why.find((r) => r.rule === "rounding.cent");
  const parts = [use ? t("why.share_of", { part: Number(use.to) - Number(use.from), of: String(use.of) }) : null, cent ? sentenceOf(cent) : null].filter(Boolean);
  return parts.length ? parts.join(". ") : undefined;
}

/** A row the answer names, as the list of rows names it (services/explain.ts). */
interface NamedRow {
  id: string;
  merchant: string;
  category: string;
}

/** The names the answer's ids stand for: its rows from the answer itself, the categories and members from the page's meta. */
interface Names {
  rows: Map<string, NamedRow>;
  labels: Map<string, string>;
  members: Map<string, string>;
}

/**
 * The figure as the button that opens the panel of its rows: the one door to a basis. Being a button, Enter and Space open
 * it and a tap does; Escape or Sulje closes the panel and the focus comes back to the figure.
 */
export function Why({ children, text, className = "why-fig", estimate, ...panel }: WhyFigure) {
  const [open, setOpen] = useState(false);
  const door = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // the figure is inert while the modal panel stands, so the focus comes back once the panel is gone
  useEffect(() => {
    if (wasOpen.current && !open) door.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <>
      <button ref={door} type="button" className={`why-door ${className}`} aria-haspopup="dialog" aria-label={doorName(doorKind(panel.figure), panel.title, text, estimate !== undefined)} onClick={() => setOpen(true)}>
        <Estimate when={estimate !== undefined} mark={estimate}>{children}</Estimate>
      </button>
      {/* the panel stands under body, so it takes none of the styles of the cell or row the figure stands in */}
      {open && createPortal(<WhyPanel {...panel} onClose={() => setOpen(false)} />, document.body)}
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
  /** The category stands in a column only when the rows of the table differ in it; the figure's own category says it once. */
  categories: boolean;
}

/** Whether the counted rows of a table fall in more than one category. */
const varies = (lines: readonly Line[], names: Names): boolean => new Set(lines.map((l) => names.rows.get(l.id)?.category)).size > 1;

/**
 * Whether a basis row's name is a person's: only a household member's row of a share ("u:" ids) is. Every other row is a
 * payee core settled as no person, so the mark never guesses from the name (Elisa, Robert's Coffee).
 */
export const basisPerson = (figure: string, id: string): boolean => figure === "share.part" && id.startsWith("u:");

/** The viewer's part of a debt, under the line that takes the others' part off. */
function partNote(why: readonly Reason[]): string | undefined {
  const use = why.find((r) => r.rule === "part.use");
  return use ? t("why.debt_share", { part: Number(use.to) - Number(use.from), of: String(use.of) }) : undefined;
}

/** The note under a line: what is said under its day, name and cents. */
function lineNote(l: Line, shown: Shown, kind: "counted" | "left" | "plain"): ReactNode {
  const { figure, names } = shown;
  // a step of a calculation is no payee: the one thing said under it is the viewer's part of a debt
  const calculated = doorKind(figure) === "calculation";
  const reason = figure === "share.part" ? shareNote(l.why) : calculated ? partNote(l.why) : kind === "plain" ? undefined : reasonOf(l.why, names);
  const via = figure === "share.part" || calculated || kind === "plain" ? undefined : viaOf(l.why);
  const whole = l.whole !== undefined && figure !== "share.part";
  if (!reason && !via && !whole) return null;
  return (
    <div className="why-more-in">
      {reason && <div className="why-reason">{reason}</div>}
      {via && <div className="why-reason">{via}</div>}
      {whole && <div className="why-reason">{t("why.whole", { sum: money(l.whole!) })}</div>}
    </div>
  );
}

/** What the name column holds where a line is no payee: an account, or an account and the payments of the window. */
const WHO: Partial<Record<WhyFigureId, "why.who_account" | "why.who_account_or_payment" | "why.who_payer" | "why.who_loan" | "why.who_breakdown">> = {
  "holdings.accounts": "why.who_account",
  "ahead.free": "why.who_account_or_payment",
  "ahead.pay": "why.who_payer",
  "loans.total": "why.who_loan",
  "loans.interest": "why.who_loan",
  "loans.payments": "why.who_loan",
  "holdings.loans": "why.who_loan",
  "loan.balance": "why.who_breakdown",
  "loan.interest": "why.who_breakdown",
  "loan.payment": "why.who_breakdown",
  "loan.monthly": "why.who_breakdown",
};

/** The lines of the answer: the day, the name and the cents, then what is said under them. */
function LineTable({ lines, shown, who, kind, came }: { lines: Line[]; shown: Shown; who: string; kind: "counted" | "left" | "plain"; /** The first row "Näytä kaikki" brought: it can take the focus. */ came?: string }) {
  const { figure, names } = shown;
  const categoryOf = (l: Line) => {
    const tx = names.rows.get(l.id);
    return tx ? (names.labels.get(tx.category) ?? tx.category) : "";
  };
  const columns: Column<Line>[] = [
    { key: "day", label: t("ui.day"), kind: "text", className: () => "why-day", cell: (l) => dayMonth(l.day) },
    {
      key: "who",
      label: who,
      kind: "text",
      cell: (l) => (
        <>
          {doorKind(figure) === "calculation" ? <span className="tc-name">{nameOf(l, figure, names)}</span> : <MarkCell name={nameOf(l, figure, names)} person={basisPerson(figure, l.id)} size="s" />}
          {/* a phone has no room for the column: the category stands under the name there */}
          {shown.categories && <div className="why-cat-sub">{categoryOf(l)}</div>}
        </>
      ),
    },
    ...(shown.categories ? [{ key: "cat", label: t("why.col_category"), kind: "text" as const, className: () => "why-cat", headClass: "why-cat", cell: categoryOf }] : []),
    { key: "sum", label: t("ui.amount"), kind: "money", cell: (l) => money(l.cents) },
  ];
  return (
    <Table<Line>
      caption={t("why.rows", { who })}
      rows={lines}
      rowKey={(l) => l.id}
      columns={columns}
      className="why-rows"
      rowProps={(l) => ({
        ...(kind === "left" ? { "data-why-left": l.id } : kind === "counted" ? { "data-why-row": l.id } : {}),
        ...(came !== undefined && l.id === came ? { "data-why-came": "", tabIndex: -1 } : {}),
      })}
      subRow={(l) => lineNote(l, shown, kind)}
    />
  );
}

/** The rows of a month of a median, with their own category column. */
function MonthTable({ lines, shown }: { lines: Line[]; shown: Shown }) {
  const own = { ...shown, categories: varies(lines, shown.names) };
  return <LineTable lines={lines} shown={own} who={t("ui.payee")} kind="counted" />;
}

/** A month of a median: its figure, and its rows once it is opened. */
function Month({ label, cents, lines, shown }: { label: string; cents: number; lines: Line[]; shown: Shown }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="why-month" data-why-month={label} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>
        <span>{capital(monthLong(label))}</span>
        <span className="num">{money(cents)}</span>
      </summary>
      {open && <MonthTable lines={lines.filter((l) => l.cents !== 0)} shown={shown} />}
    </details>
  );
}

function WhyPanel({ figure, title, range, scope, category, row, account, loan, onClose }: Omit<WhyFigure, "children" | "className" | "text"> & { onClose: () => void }) {
  const ref = useModal();
  const [all, setAll] = useState(false);
  const why = useApi<Explanation & { rows: NamedRow[] }>(`/api/explain${query({ figure, ...range, scope, category, row, loan })}`);
  const e = why.data;
  const meta = useMeta();
  const names: Names = {
    rows: new Map((e?.rows ?? []).map((t) => [t.id, t])),
    labels: new Map((meta?.categories ?? []).map((c) => [c.id, c.label])),
    members: new Map([
      ...(meta?.members ?? []).map((m): [string, string] => [m.id, m.displayName]),
      // the holders who are no user of the app, as the account's users name them
      ...(meta?.accounts.find((a) => a.id === account)?.use?.users ?? []).filter((u) => u.userId === null).map((u): [string, string] => ["-", u.label]),
    ]),
  };
  // a row the figure left out counts nothing: it stands in the closed group at the foot, never between the counted rows
  const splits = e?.kind === "sum";
  const counted = e ? (splits ? e.lines.filter((l) => l.cents !== 0) : e.lines) : [];
  const left = e && splits ? e.lines.filter((l) => l.cents === 0) : [];
  const shown: Shown = { figure, names, categories: figure !== "share.part" && varies(counted, names) };
  const leftShown: Shown = { ...shown, categories: figure !== "share.part" && varies(left, names) };
  const shownRows = all ? counted : counted.slice(0, FIRST_ROWS);
  // "Näytä kaikki" removes itself: the focus goes to the first row it brought, not to the page behind the sheet
  useEffect(() => {
    if (all) ref.current?.querySelector<HTMLElement>("[data-why-came]")?.focus();
  }, [all, ref]);
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
      <p className="why-period">{periodText(range)}</p>
      {why.error && <p role="alert">{why.error}</p>}
      {!e && !why.error && <p role="status">{t("load.loading")}</p>}
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
            {method?.kind !== "median" && (
              <>
                <LineTable lines={shownRows} shown={shown} who={WHO[figure] ? t(WHO[figure]) : t("ui.payee")} kind={kind} came={all ? counted[FIRST_ROWS]?.id : undefined} />
                {/* empty until the press, so the number of rows is spoken once */}
                <span className="sr-only" data-why-count="" role="status" aria-live="polite">
                  {all && counted.length > FIRST_ROWS ? t("table.shown", { count: counted.length, total: counted.length }) : ""}
                </span>
                {counted.length > FIRST_ROWS && !all && (
                  <Button variant="link" onClick={() => setAll(true)}>
                    {t("why.show_all")}
                  </Button>
                )}
                {method?.kind === "estimate" && <p className="why-reason">{method.rule}</p>}
              </>
            )}
            {left.length > 0 && (
              <details className="why-left">
                <summary>{tn(left.length, "why.left_out_one", "why.left_out_many")}</summary>
                <LineTable lines={left} shown={leftShown} who={t("ui.payee")} kind="left" />
              </details>
            )}
          </div>
          <div className="why-foot">
            {whole !== undefined && (
              <div className="why-total">
                <span>{t("why.whole_label")}</span>
                <span className="num">{money(whole)}</span>
              </div>
            )}
            <div className="why-total">
              <span>{method ? title : t("why.total")}</span>
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
        <Button onClick={onClose}>
          {t("ui.close")}
        </Button>
      </div>
    </dialog>
  );
}
