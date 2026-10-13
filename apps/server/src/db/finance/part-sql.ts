/**
 * A member's own view in SQL: the viewer's part of a row's amount as one expression, the viewer's accounts the view
 * leaves out, and the category and transfer mark of the rows the view counts otherwise than they are stored. The
 * arithmetic of a part lives in core (`partCents`); the expression here is the same sum in SQLite's whole numbers,
 * and a test proves the two equal to the cent on random rows. What a row counts as is decided in core too
 * (`applyUse`): the statements here are handed its answer by row id and decide nothing.
 */
import { isNone, isWhole, type Part, type RowShare, type Transaction } from "@banking/core";
import type { SqlValue } from "../types.ts";

/**
 * The viewer's part of an account. For an account cut by who paid it, `viewer` is the viewer's owner key (`u:<id>`): the
 * rows that have stored parts (`tx_part`) are the viewer's own cents of them and their part of the unknown ones, and the
 * rows that have none are cut by the part.
 */
export type ViewPart = Part & { viewer?: string };

/** What the own view changes in the rows a list or a sum reads. The household view changes nothing: both are empty. */
export interface OwnRows {
  /** The viewer's own accounts somebody else uses alone: none of their rows is read. */
  left: readonly string[];
  /** The viewer's part of each account counted at less than the whole, and of each account cut by who paid it, by account id. */
  parts: ReadonlyMap<string, ViewPart>;
  /** The viewer's own cents of the rows of an account cut by who paid it, by row id: what a list shows beside the bank's amount. */
  shares?: ReadonlyMap<string, Pick<RowShare, "cents" | "openCents">>;
  /**
   * The rows the view counts otherwise than they are stored, by row id: money between two members is a transfer,
   * money to an account the viewer has no part in is money to a person. Every other row counts as it is stored.
   */
  told: ReadonlyMap<string, Pick<Transaction, "category" | "categorySource" | "isTransfer">>;
}

interface Sql {
  sql: string;
  params: SqlValue[];
}

/**
 * `abs * weight / of` to a whole cent, a half up. Written by quotient and remainder, so no product leaves 64 bits
 * whatever the amount: the remainder is below `of`, and the weights of a use add up to less than a billion.
 */
const centsUpTo = (abs: string, weight: number, of: number): string => `(${abs} / ${of} * ${weight} + (2 * (${abs} % ${of}) * ${weight} + ${of}) / ${2 * of})`;

/** The numbers of a part go into the statement as text, so they are whole numbers of a part and nothing else. */
function checked(part: Part): Part {
  const { from, to, of } = part;
  if (![from, to, of].every(Number.isSafeInteger) || from < 0 || to < from || to > of || of < 1 || of > 1_000_000_000) throw new Error("not a part of an account");
  return part;
}

/**
 * The viewer's part of `column` (an amount in cents) for the row's account: the part where `parts` names the account,
 * the amount itself elsewhere. With no part below the whole it is the column and binds nothing. The params bind in
 * the order the expression stands in the statement, once for each time it is written. Of an account cut by who paid
 * it a row with stored parts is the viewer's own cents of them plus the viewer's part of the parts nobody owns (`?`
 * and `-`), with the row's sign: the same sum as `shareOf` in core. A row with none is cut by the part.
 */
export function partSql(parts: ReadonlyMap<string, ViewPart>, column: string): Sql {
  const cut = [...parts].filter(([, part]) => part.viewer !== undefined || !isWhole(checked(part)));
  if (!cut.length) return { sql: column, params: [] };
  const cents = ({ from, to, of }: Part, abs: string) => (from === 0 ? centsUpTo(abs, to, of) : `(${centsUpTo(abs, to, of)} - ${centsUpTo(abs, from, of)})`);
  const plain = (part: Part) => (isNone(part) ? "0" : `(CASE WHEN ${column} < 0 THEN 0 - ${cents(part, `ABS(${column})`)} ELSE ${cents(part, `ABS(${column})`)} END)`);
  const traced = (part: Part) =>
    `(SELECT (1 - 2 * (${column} < 0)) * (mine + ${cents(part, "loose")}) FROM (SELECT COALESCE(SUM(CASE WHEN owner = ? THEN cents END), 0) AS mine, COALESCE(SUM(CASE WHEN owner IN ('?', '-') THEN cents END), 0) AS loose FROM tx_part WHERE tx_id = id))`;
  const whens = cut.flatMap(([, part]) => {
    checked(part);
    return part.viewer === undefined
      ? [{ sql: ` WHEN ? THEN ${plain(part)}`, params: [] as string[] }]
      : [{ sql: ` WHEN ? THEN (CASE WHEN EXISTS (SELECT 1 FROM tx_part WHERE tx_id = id) THEN ${traced(part)} ELSE ${plain(part)} END)`, params: [part.viewer] }];
  });
  return { sql: `(CASE account_id${whens.map((w) => w.sql).join("")} ELSE ${column} END)`, params: cut.flatMap(([id, part], i) => [id, ...whens[i]!.params]) };
}

/** The condition that keeps the rows of the accounts left out of the view from being read; empty when there is none. */
export function notLeftSql(own: OwnRows | undefined): Sql {
  const left = own?.left ?? [];
  return left.length ? { sql: ` AND account_id NOT IN (${left.map(() => "?").join(",")})`, params: [...left] } : { sql: "", params: [] };
}

/**
 * The category and the transfer mark of a row as the view counts it: the stored column, but for the rows `told` names.
 * With none it is the column and binds nothing. The row ids bind as one JSON list each, so a long list is one param.
 * The params of each bind in the order it stands in the statement, once for each time it is written.
 */
export function toldSql(own: OwnRows | undefined): { category: Sql; moved: Sql } {
  const told = [...(own?.told ?? [])];
  if (!told.length) return { category: { sql: "category", params: [] }, moved: { sql: "is_transfer", params: [] } };
  const among = "id IN (SELECT value FROM json_each(?))";
  const ids = (rows: typeof told) => JSON.stringify(rows.map(([id]) => id));
  const categories = [...new Set(told.map(([, row]) => row.category))];
  return {
    category: {
      sql: `(CASE${categories.map(() => ` WHEN ${among} THEN ?`).join("")} ELSE category END)`,
      params: categories.flatMap((category) => [ids(told.filter(([, row]) => row.category === category)), category]),
    },
    moved: { sql: `(CASE WHEN ${among} THEN 1 WHEN ${among} THEN 0 ELSE is_transfer END)`, params: [ids(told.filter(([, row]) => row.isTransfer)), ids(told.filter(([, row]) => !row.isTransfer))] },
  };
}
