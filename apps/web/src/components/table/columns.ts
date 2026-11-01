/**
 * What a column is: the shape every page writes and the few pure readings of it that the sort, the search, the chips,
 * the grouping and the CSV share. Table.tsx re-exports the types, so a page imports them from there as before.
 */
import type { Css } from "../../css.ts";
import { Fragment, isValidElement, type ReactNode } from "react";
import { money } from "../../format.ts";

/** What a column holds: it sets the alignment, the tabular figures and the first direction of its sort. */
export type ColumnKind = "text" | "money" | "count" | "date" | "share";

/**
 * A filter chip a column offers. Its count is the number of rows `test` accepts (among the rows the search leaves), so a
 * chip's number is the number of rows shown when it is chosen. The page names the chip; the table never invents one.
 */
export type ChipDef<R> = { key: string; label: string; test: (row: R) => boolean };

export type Column<R> = {
  key: string;
  /** A node when the head carries more than text (a note under the name); then `text` names it for the sort and the pairs of a phone row. */
  label: ReactNode;
  text?: string;
  kind: ColumnKind;
  /** The cell. A money column with `cents` may leave it out. */
  cell?: (row: R) => ReactNode;
  /** The amount of a money column in cents; it is printed to its `precision`, so one column never mixes 29,90 € and 30 €. */
  cents?: (row: R) => number | null;
  precision?: "cents" | "euros";
  /**
   * The column sorts: `true` by its `cents`, or by this value. Only a column of a complete set the household reads by
   * size sorts; a series in time and a cut of the rows do not.
   */
  sort?: true | ((row: R) => number | string | null);
  /** The text of this column the search box looks in: `true` takes the sort value when it is text. A table with such a column has a search box. */
  search?: true | ((row: R) => string);
  /** The chips of the toolbar this column defines. A table with chips shows them in column order, with "Kaikki" first. */
  chips?: readonly ChipDef<R>[];
  /** The rows can be grouped by this value: the toolbar's Ryhmittely menu lists the column and the group's name is the value. */
  group?: (row: R) => string;
  /**
   * What the CSV holds for this column: by default the figure of `cents` in euros, the number of `sort` or its text. A
   * sum is a number, never "1 050 €". `false` leaves the column out (a column of buttons or of bars).
   */
  csv?: false | ((row: R) => string | number | null);
  /** One of the months (or other steps) of a row: a column while there is room, else the list the row's button opens. */
  series?: boolean;
  /** This cell is the row's `th scope="row"`, and the title of its block on a phone. */
  rowHead?: boolean;
  /** The figure on the block's first line on a phone. */
  main?: boolean;
  /** A class of the cell by its row (the tone of a figure that got worse). */
  className?: (row: R) => string | undefined;
  /** The `title` of the cell by its row (the full name of a cut one). */
  title?: (row: R) => string | undefined;
  /** Custom properties set on the cell by its row, through the CSSOM (the stylesheet reads them); name the ones a row may lack with an undefined value. */
  style?: (row: R) => Css | undefined;
  /** The head's label is read, not drawn (a column of row heads or of buttons has no visible name). */
  headHidden?: boolean;
  /** A class of the column's head cell (the cells have `className`). */
  headClass?: string;
  /** Left out on a phone. */
  phone?: "hide";
  /** A bar: the row's own figure against the column's scale, drawn before `cell` (or alone). It computes no money. */
  bar?: {
    value: (row: R) => number;
    max: number;
    color?: (row: R) => string | undefined;
  };
};

/** The figures of a table are right-aligned; these kinds hold figures. */
export const FIGURE: readonly ColumnKind[] = ["money", "count", "share"];

/** The column's name as text: for the sort sentence, the pairs of a phone row, the CSV head and the menus. */
export const textOf = <R,>(c: Column<R>): string => c.text ?? (typeof c.label === "string" ? c.label : c.key);

/** The value the column sorts by, or undefined when it does not sort. */
export const valueOf = <R,>(c: Column<R>): ((row: R) => number | string | null) | undefined => (c.sort === true ? (c.cents ? (r) => c.cents!(r) : undefined) : c.sort);

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": "\u00a0" };

/** The words of a component's markup: parts marked `aria-hidden` (a chevron, a mark) and drawings say nothing. */
function wordsOfMarkup(html: string): string {
  return html
    .replace(/<(svg|canvas)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<(\w+)\b[^>]*\baria-hidden="true"[^>]*>[^<]*<\/\1>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (e) => ENTITIES[e]!);
}

/**
 * The drawing of a component to markup is react-dom/server, 16 % of the script of the first page, so it is a chunk of its
 * own (markup.ts) that a table fetches only when a cell holds a component. Until it is there such a cell reads as empty and
 * the table draws again when it arrives (`useMarkup`). Tests install it at once (tools/lib/test-setup.ts).
 */
let render: ((node: ReactNode) => string) | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();
export function setMarkup(draw: ((node: ReactNode) => string) | null): void {
  render = draw;
  for (const f of waiting) f();
}
export function loadMarkup(): Promise<void> {
  loading ??= import("./markup.ts").then((m) => setMarkup(m.markupOf));
  return loading;
}
/** Subscribes to the arrival of the renderer: true once it is there. */
export const markupReady = { subscribe: (f: () => void) => (waiting.add(f), () => void waiting.delete(f)), get: () => render !== null };

/**
 * The words of a node as text: what a cell says without drawing it on the page. A string or a number is itself, an
 * element of the page is its children, a part marked `aria-hidden` (a chevron, a bar) says nothing. A component is drawn
 * to markup and read, so a cell made of components (a payee with its tags, an amount) is read as it shows. A component
 * that cannot be drawn without its page's state reads as empty, so its column gives `csv` or `search`.
 */
export function textFromNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (!isValidElement<{ children?: ReactNode; "aria-hidden"?: boolean | "true" | "false" }>(node)) return "";
  if (node.props["aria-hidden"] === true || node.props["aria-hidden"] === "true") return "";
  if (typeof node.type === "string" || node.type === Fragment) return textFromNode(node.props.children);
  if (!render) {
    void loadMarkup();
    return "";
  }
  try {
    return wordsOfMarkup(render(node));
  } catch {
    return "";
  }
}

/** What the cell of a row says as plain text: the page's cell, or the amount of a money column. */
export const cellText = <R,>(c: Column<R>, row: R): string => {
  if (c.cell) return textFromNode(c.cell(row)).replace(/\s+/g, " ").trim();
  const v = c.cents?.(row) ?? null;
  return v === null ? "" : money(v, c.precision === "cents");
};

const FIGURE_TEXT = /^[−+-]?\d[\d\s\u00a0\u202f]*(?:,\d+)?\s*(?:€|%)?$/;

/** The number a printed figure says ("−1 050,5 €" is -1050.5, "32 %" is 32), or null when the text is not one. */
export function figureOf(text: string): number | null {
  const t = text.trim();
  if (!FIGURE_TEXT.test(t)) return null;
  const n = Number(t.replace(/[\s\u00a0\u202f€%]/g, "").replace("−", "-").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** The text the search looks in for this column, or undefined when the column is not searched. */
export const searchOf = <R,>(c: Column<R>): ((row: R) => string) | undefined => {
  if (!c.search) return undefined;
  if (c.search !== true) return c.search;
  const value = valueOf(c);
  return value ? (r) => String(value(r) ?? "") : undefined;
};

/**
 * The texts the search box looks in. The columns that say `search` are the table's own choice. A table with none is
 * searched in its text and date columns, as they read, so every table has a search box without its page asking.
 */
export const searchFns = <R,>(columns: readonly Column<R>[]): ((row: R) => string)[] => {
  const chosen = columns.map(searchOf).filter((f): f is (row: R) => string => f !== undefined);
  if (chosen.length) return chosen;
  return columns.filter((c) => (c.kind === "text" || c.kind === "date") && !c.headHidden && !c.bar && c.csv !== false).map((c) => (r: R) => cellText(c, r));
};

/** The chips of all columns in column order. */
export const chipsOf = <R,>(columns: readonly Column<R>[]): { column: string; chip: ChipDef<R> }[] => columns.flatMap((c) => (c.chips ?? []).map((chip) => ({ column: c.key, chip })));

/**
 * What a column's cell of the CSV holds for a row: a number for a figure, text for the rest, null for nothing. It is what
 * the table prints: the figure of `cents` in euros, or the printed figure read back as a number. A text column gives its
 * sort or search text, else its cell's words. A date column gives its sort value (a `YYYY-MM-DD` day), else the cell.
 */
export const csvValueOf = <R,>(c: Column<R>, row: R): string | number | null => {
  if (c.csv === false) return null;
  if (c.csv) return c.csv(row);
  if (c.cents) {
    const v = c.cents(row);
    return v === null ? null : Math.round(v) / 100;
  }
  if (FIGURE.includes(c.kind)) {
    const text = cellText(c, row);
    return figureOf(text) ?? (text === "" || text === "–" ? null : text);
  }
  const v = valueOf(c)?.(row);
  if (typeof v === "string" && v !== "") return v;
  return searchOf(c)?.(row) || cellText(c, row) || null;
};
