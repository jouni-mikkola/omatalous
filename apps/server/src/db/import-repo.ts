/**
 * What "Tuo tiedot" asks of the database (services/data-import.ts): which rows exist already, which ids are taken, and the
 * one transaction that adds the rest. Nothing here updates or deletes: a row is added with INSERT OR IGNORE, so a row that
 * appeared since the plan was made is kept as it is.
 */
import type { Db, SqlValue, Statement } from "./types.ts";

/** Tables whose rows have an opaque id column `id` (the owner column is `user_id` where there is one). */
export type IdTable = "accounts" | "transactions" | "loans" | "expected_bills" | "statement_rows" | "household_member";

/** The keys asked in one query: a list as one JSON parameter, so the number of keys is not limited by SQLite's variable cap. */
const QUERY_KEYS = 20_000;

export interface OwnAccount {
  id: string;
  identity: string | null;
  iban: string | null;
  type: string;
}

interface OwnTransaction {
  id: string;
  accountId: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  status: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  reference: string | null;
  mcc: string | null;
  bankTxnCode: string | null;
  merchant: string;
}

export class ImportRepo {
  constructor(private readonly db: Db) {}

  async accountsOf(userId: string): Promise<OwnAccount[]> {
    return (await this.db.all<Record<string, string | null>>("SELECT id, identity, iban, type FROM accounts WHERE user_id = ?", [userId])).map((r) => ({
      id: String(r.id),
      identity: r.identity ?? null,
      iban: r.iban ?? null,
      type: String(r.type),
    }));
  }

  /** The accounts of every user but this one: what an account of a file must never be joined to. */
  async accountsOfOthers(userId: string): Promise<OwnAccount[]> {
    return (await this.db.all<Record<string, string | null>>("SELECT id, identity, iban, type FROM accounts WHERE user_id <> ?", [userId])).map((r) => ({
      id: String(r.id),
      identity: r.identity ?? null,
      iban: r.iban ?? null,
      type: String(r.type),
    }));
  }

  /** Of these asset ids, the ones the table holds, each with the kinds and names it holds them under (`[kind, name]` as JSON). */
  async assetKinds(ids: readonly string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (let i = 0; i < ids.length; i += QUERY_KEYS) {
      const rows = await this.db.all<{ id: string; what: string }>("SELECT DISTINCT id, json_array(kind, name) AS what FROM valued_asset WHERE id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids.slice(i, i + QUERY_KEYS))]);
      for (const r of rows) out.set(r.id, (out.get(r.id) ?? new Set()).add(r.what));
    }
    return out;
  }

  /** Of these ids, the ones the table holds, each with the user it belongs to (null: the table has no owner column). */
  async taken(table: IdTable, ids: readonly string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const owner = table === "household_member" ? "NULL" : "user_id";
    for (let i = 0; i < ids.length; i += QUERY_KEYS) {
      const rows = await this.db.all<{ id: string; owner: string | null }>(`SELECT id, ${owner} AS owner FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids.slice(i, i + QUERY_KEYS))]);
      for (const r of rows) out.set(r.id, r.owner);
    }
    return out;
  }

  /** The user's own transactions on these accounts, with the fields the bank signature is made of. */
  async transactionsOf(userId: string, accountIds: readonly string[]): Promise<OwnTransaction[]> {
    const rows = await this.db.all<Record<string, string | number | null>>(
      `SELECT id, account_id, booking_date, value_date, amount_cents, status, counterparty, counterparty_iban, description, reference, mcc, bank_txn_code, merchant
       FROM transactions WHERE user_id = ? AND account_id IN (SELECT value FROM json_each(?))`,
      [userId, JSON.stringify(accountIds)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      accountId: String(r.account_id),
      bookingDate: String(r.booking_date),
      valueDate: (r.value_date as string | null) ?? null,
      amountCents: Number(r.amount_cents),
      status: String(r.status),
      counterparty: (r.counterparty as string | null) ?? null,
      counterpartyIban: (r.counterparty_iban as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      reference: (r.reference as string | null) ?? null,
      mcc: (r.mcc as string | null) ?? null,
      bankTxnCode: (r.bank_txn_code as string | null) ?? null,
      merchant: String(r.merchant),
    }));
  }

  /** Of these keys (the values of `columns`, in order), the ones a row of the table has: a missing value (null) matches null. */
  async present(table: string, columns: readonly string[], keys: readonly SqlValue[][]): Promise<Set<string>> {
    const out = new Set<string>();
    const on = columns.map((c, i) => `t."${c}" IS json_extract(j.value, '$[${i}]')`).join(" AND ");
    const select = columns.map((c) => `t."${c}" AS "${c}"`).join(", ");
    for (let i = 0; i < keys.length; i += QUERY_KEYS) {
      const rows = await this.db.all<Record<string, SqlValue>>(`SELECT ${select} FROM json_each(?) j JOIN ${table} t ON ${on}`, [JSON.stringify(keys.slice(i, i + QUERY_KEYS))]);
      for (const r of rows) out.add(JSON.stringify(columns.map((c) => r[c] ?? null)));
    }
    return out;
  }

  /** The statement that adds one row, or leaves it when the table has it (a key, a check or a not-null refuses it). */
  static insert(table: string, row: Record<string, SqlValue>): Statement {
    const columns = Object.keys(row);
    return { sql: `INSERT OR IGNORE INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, params: columns.map((c) => row[c]!) };
  }

  /** Every statement in one transaction: all of the import or none of it. */
  async commit(statements: Statement[]): Promise<void> {
    await this.db.batch(statements);
  }
}
