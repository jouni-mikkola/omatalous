/**
 * What the transactions page and the export read: the filter, its two sides (own rows and shared accounts) and
 * the pages. Every side starts with a user_id condition, so a filter can never reach another member's rows.
 * The rows are the bank's, whole, in every view; the sums above the list are sums of the viewer's parts, and they and
 * the category filter count a row as the view does (`toldSql`).
 */
import { fold } from "@banking/core";
import { type Row, type StoredTransaction, TX_COLUMNS_LIGHT, toTransaction } from "../rows.ts";
import type { SqlValue } from "../types.ts";
import type { FinanceContext } from "./context.ts";
import { notLeftSql, type OwnRows, partSql, toldSql } from "./part-sql.ts";

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountId?: string;
  category?: string;
  merchant?: string;
  q?: string;
  limit?: number;
  offset?: number;
  /** The own view: the viewer's accounts it leaves out, the parts the sums are cut by, and the rows it counts otherwise than they are stored. */
  own?: OwnRows;
}

/** A LIKE pattern for text anywhere in a value; `%`, `_` and `\` typed by the user are literal. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * A search that reads as a euro amount ("142,30", "-142.30", "1 250 €", "142"): the amounts it matches, in cents.
 * Cents typed match exactly; whole euros match every amount of that euro (142 finds 142,30). A sign picks money out
 * or in, none matches both. Null for any other text.
 */
export function amountQuery(q: string): { sign: -1 | 0 | 1; min: number; max: number } | null {
  const m = /^([+\-−])?\s*(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:€|eur)?$/i.exec(q.trim());
  if (!m) return null;
  const euros = Number(m[2]!.replace(/\D/g, ""));
  if (!Number.isSafeInteger(euros * 100 + 99)) return null;
  const sign = !m[1] ? 0 : m[1] === "+" ? 1 : -1;
  if (m[3] === undefined) return { sign, min: euros * 100, max: euros * 100 + 99 };
  const cents = euros * 100 + Number(m[3].padEnd(2, "0"));
  return { sign, min: cents, max: cents };
}

export class TransactionListRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /**
   * The WHERE parts of a transaction filter for one side of the view: the user's own rows, or (household view)
   * the shared accounts' rows. The two sides never overlap, because a shared account belongs to another user.
   * Reading them apart lets each side use its own index and stop at the limit; one OR over both sorted every row.
   */
  private filterSide(f: TransactionFilter, side: { own: true } | { shared: readonly string[] }): { where: string[]; params: SqlValue[] } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    const add = (condition: string, ...values: SqlValue[]) => {
      where.push(condition);
      params.push(...values);
    };
    if ("own" in side) {
      const kept = notLeftSql(f.own);
      add(`user_id = ?${kept.sql}`, this.ctx.userId, ...kept.params);
    } else add(`user_id != ? AND account_id IN (${side.shared.map(() => "?").join(",")})`, this.ctx.userId, ...side.shared);
    if (f.from) add("booking_date >= ?", f.from);
    if (f.to) add("booking_date <= ?", f.to);
    if (f.accountId) add("account_id = ?", f.accountId);
    const category = toldSql(f.own).category;
    if (f.category) add(`${category.sql} = ?`, ...category.params, f.category);
    if (f.merchant) add("merchant = ?", f.merchant);
    const q = f.q ? fold(f.q.trim()) : "";
    const amount = f.q ? amountQuery(f.q) : null;
    if (amount) {
      const column = amount.sign === 0 ? "ABS(amount_cents)" : "amount_cents";
      const [min, max] = amount.sign < 0 ? [-amount.max, -amount.min] : [amount.min, amount.max];
      add(`(search_text LIKE ? ESCAPE '\\' OR ${column} BETWEEN ? AND ?)`, containsPattern(q), min, max);
    } else if (q) add("search_text LIKE ? ESCAPE '\\'", containsPattern(q));
    return { where, params };
  }

  filterSides(f: TransactionFilter, accountIds?: readonly string[]) {
    // household view: own rows plus explicitly shared accounts (resolved by HouseholdRepo)
    const sides = [this.filterSide(f, { own: true })];
    if (accountIds?.length) sides.push(this.filterSide(f, { shared: accountIds }));
    return sides;
  }

  /** `limit` rows of the sides, newest first (date, then id), starting after `offset` rows or after the keyset row. */
  private async pageRows(sides: { where: string[]; params: SqlValue[] }[], limit: number, offset: number, after?: { date: string; id: string }): Promise<StoredTransaction[]> {
    const keyset = after ? " AND booking_date <= ? AND (booking_date < ? OR id > ?)" : "";
    const keysetParams = after ? [after.date, after.date, after.id] : [];
    const select = (side: { where: string[] }) => `SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE ${side.where.join(" AND ")}${keyset} ORDER BY booking_date DESC, id LIMIT ?`;
    if (sides.length === 1) {
      const side = sides[0]!;
      return (await this.ctx.db.all<Row>(`${select(side)} OFFSET ?`, [...side.params, ...keysetParams, limit, offset])).map(toTransaction);
    }
    // each side is cut at offset + limit rows before the merge
    const params = sides.flatMap((side) => [...side.params, ...keysetParams, limit + offset]);
    const rows = await this.ctx.db.all<Row>(
      `SELECT * FROM (${sides.map((side) => `SELECT * FROM (${select(side)})`).join(" UNION ALL ")}) ORDER BY booking_date DESC, id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(toTransaction);
  }

  async listTransactions(f: TransactionFilter, accountIds?: readonly string[]): Promise<{ total: number; inCents: number; outCents: number; items: StoredTransaction[] }> {
    const sides = this.filterSides(f, accountIds);
    // money in and out over every matching row, so the list says what the whole filter adds up to. An own transfer
    // leaves one account and lands on another: counted, it would add the same money to both sums. A row of a joint
    // account adds the viewer's part, as it does in every report, and a transfer is what the view counts as one.
    const part = partSql(f.own?.parts ?? new Map(), "amount_cents");
    const { moved } = toldSql(f.own);
    let total = 0;
    let inCents = 0;
    let outCents = 0;
    for (const side of sides) {
      const r = await this.ctx.db.first<{ c: number; inc: number | null; outc: number | null }>(
        `SELECT COUNT(*) AS c, SUM(CASE WHEN amount_cents > 0 AND ${moved.sql} = 0 THEN ${part.sql} END) AS inc,
                -SUM(CASE WHEN amount_cents < 0 AND ${moved.sql} = 0 THEN ${part.sql} END) AS outc
         FROM transactions WHERE ${side.where.join(" AND ")}`,
        [...moved.params, ...part.params, ...moved.params, ...part.params, ...side.params],
      );
      total += Number(r?.c ?? 0);
      inCents += Number(r?.inc ?? 0);
      outCents += Number(r?.outc ?? 0);
    }
    const items = await this.pageRows(sides, Math.min(Math.max(f.limit ?? 100, 1), 5000), Math.max(f.offset ?? 0, 0));
    return { total, inCents, outCents, items };
  }

  /**
   * One page of the same rows in the same order for the export: no count, and the next page starts after the
   * last row of this one (`after`), so a long history costs the same at its end as at its start.
   */
  async exportPage(f: TransactionFilter, accountIds: readonly string[] | undefined, limit: number, after?: { date: string; id: string }): Promise<StoredTransaction[]> {
    return this.pageRows(this.filterSides(f, accountIds), limit, 0, after);
  }
}
