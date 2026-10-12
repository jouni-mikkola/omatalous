/**
 * A member's own view in SQL: the viewer's part of a row's amount as one expression, the viewer's accounts the view
 * leaves out, and the category and transfer mark of the rows the view counts otherwise than they are stored. The
 * arithmetic of a part lives in core (`partCents`); the expression here is the same sum in SQLite's whole numbers,
 * and a test proves the two equal to the cent on random rows. What a row counts as is decided in core too
 * (`applyUse`): the statements here are handed its answer by row id and decide nothing.
 */
import { isNone, isWhole, type Part, type Transaction } from "@banking/core";
import type { SqlValue } from "../types.ts";

/** What the own view changes in the rows a list or a sum reads. The household view changes nothing: both are empty. */
export interface OwnRows {
  /** The viewer's own accounts somebody else uses alone: none of their rows is read. */
  left: readonly string[];
  /** The viewer's part of each account counted at less than the whole, by account id. */
  parts: ReadonlyMap<string, Part>;
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
 * the order the expression stands in the statement, once for each time it is written.
 */
export function partSql(parts: ReadonlyMap<string, Part>, column: string): Sql {
  const cut = [...parts].filter(([, part]) => !isWhole(checked(part)));
  if (!cut.length) return { sql: column, params: [] };
  const abs = `ABS(${column})`;
  const cents = ({ from, to, of }: Part) => (from === 0 ? centsUpTo(abs, to, of) : `(${centsUpTo(abs, to, of)} - ${centsUpTo(abs, from, of)})`);
  const whens = cut.map(([, part]) => ` WHEN ? THEN ${isNone(part) ? "0" : `(CASE WHEN ${column} < 0 THEN 0 - ${cents(part)} ELSE ${cents(part)} END)`}`);
  return { sql: `(CASE account_id${whens.join("")} ELSE ${column} END)`, params: cut.map(([id]) => id) };
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
