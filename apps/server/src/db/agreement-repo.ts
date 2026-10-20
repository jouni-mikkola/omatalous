/**
 * The two household stores of the settlement between partners: the dated agreements of an account (how its cost is
 * shared from a day on), the people of the household who have no login, and the months of a pool's settlement that have
 * closed, kept as they read the first time. Nothing here is read by anything older.
 */
import type { Row } from "./rows.ts";
import type { Db } from "./types.ts";

/** One `account_agreement` row as stored: `value` is the JSON text. */
export interface StoredAgreement {
  accountKey: string;
  validFrom: string;
  kind: string;
  value: string;
  setBy: string | null;
  setAt: string;
}

/** A person of the household who has no login. */
export interface StoredMember {
  id: string;
  name: string;
  weight: number;
  createdAt: string;
}

/** One closed month of a real account's settlement: `snapshot` is the JSON text of core's `ClosedMonth`. */
export interface StoredClosedMonth {
  accountKey: string;
  month: string;
  closedOn: string;
  snapshot: string;
  writtenAt: string;
}

export class AgreementRepo {
  constructor(private readonly db: Db) {}

  /** The agreements of these real accounts, oldest first within a key. */
  async agreementRows(keys: readonly string[]): Promise<StoredAgreement[]> {
    if (!keys.length) return [];
    const marks = keys.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT account_key, valid_from, kind, value, set_by, set_at FROM account_agreement WHERE account_key IN (${marks}) ORDER BY account_key, valid_from`, [...keys])).map((r) => ({
      accountKey: String(r.account_key),
      validFrom: String(r.valid_from),
      kind: String(r.kind),
      value: String(r.value),
      setBy: r.set_by === null ? null : String(r.set_by),
      setAt: String(r.set_at),
    }));
  }

  /** Every agreement (the trace reads the cards' among them). */
  async allAgreements(): Promise<StoredAgreement[]> {
    return (await this.db.all<Row>("SELECT account_key, valid_from, kind, value, set_by, set_at FROM account_agreement ORDER BY account_key, valid_from")).map((r) => ({
      accountKey: String(r.account_key),
      validFrom: String(r.valid_from),
      kind: String(r.kind),
      value: String(r.value),
      setBy: r.set_by === null ? null : String(r.set_by),
      setAt: String(r.set_at),
    }));
  }

  /** Adds a row from a day. A row that is already there for the day is left as it is: false. An earlier row is never rewritten. */
  async addAgreement(row: StoredAgreement): Promise<boolean> {
    const done = await this.db.run("INSERT OR IGNORE INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)", [
      row.accountKey,
      row.validFrom,
      row.kind,
      row.value,
      row.setBy,
      row.setAt,
    ]);
    return done.changes > 0;
  }

  /** Replaces the value of a row that shows the income ratio and still waits for a partner, if it is still what the caller read: false when it has moved. */
  async confirmAgreement(key: string, validFrom: string, was: string, value: string): Promise<boolean> {
    const done = await this.db.run("UPDATE account_agreement SET value = ? WHERE account_key = ? AND valid_from = ? AND kind IN ('income', 'fixed') AND value = ?", [value, key, validFrom, was]);
    return done.changes > 0;
  }

  /** Takes back a row that still waits for a partner, if it is still what the caller read: false when it has moved. The only way a row goes. */
  async withdrawAgreement(key: string, validFrom: string, was: string): Promise<boolean> {
    const done = await this.db.run("DELETE FROM account_agreement WHERE account_key = ? AND valid_from = ? AND kind IN ('income', 'fixed') AND value = ?", [key, validFrom, was]);
    return done.changes > 0;
  }

  /** The closed months of a real account, oldest first. */
  async closedMonths(key: string): Promise<StoredClosedMonth[]> {
    return (await this.db.all<Row>("SELECT account_key, month, closed_on, snapshot, written_at FROM settlement_closed WHERE account_key = ? ORDER BY month", [key])).map((r) => ({
      accountKey: String(r.account_key),
      month: String(r.month),
      closedOn: String(r.closed_on),
      snapshot: String(r.snapshot),
      writtenAt: String(r.written_at),
    }));
  }

  /** Stores a closed month once. A month that is stored already is never rewritten: false, and the stored one stands. */
  async addClosedMonth(row: StoredClosedMonth): Promise<boolean> {
    const done = await this.db.run("INSERT OR IGNORE INTO settlement_closed (account_key, month, closed_on, snapshot, written_at) VALUES (?, ?, ?, ?, ?)", [row.accountKey, row.month, row.closedOn, row.snapshot, row.writtenAt]);
    return done.changes > 0;
  }

  async members(): Promise<StoredMember[]> {
    return (await this.db.all<Row>("SELECT id, name, weight, created_at FROM household_member ORDER BY created_at, id")).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      weight: Number(r.weight),
      createdAt: String(r.created_at),
    }));
  }

  /**
   * Makes the list of members what `rows` say, in one transaction: the ones not named go, the ones with an id are renamed,
   * the ones without are added. Names are unique with case ignored, so a rename goes through a name nobody has.
   */
  async replaceMembers(rows: readonly { id: string; name: string; isNew: boolean }[], at: string): Promise<void> {
    const keep = rows.filter((r) => !r.isNew).map((r) => r.id);
    const marks = keep.map(() => "?").join(",");
    await this.db.batch([
      { sql: keep.length ? `DELETE FROM household_member WHERE id NOT IN (${marks})` : "DELETE FROM household_member", params: keep },
      ...rows.filter((r) => !r.isNew).map((r) => ({ sql: "UPDATE household_member SET name = '#' || id WHERE id = ?", params: [r.id] })),
      ...rows.map((r) => (r.isNew ? { sql: "INSERT INTO household_member (id, name, weight, created_at) VALUES (?, ?, 1, ?)", params: [r.id, r.name, at] } : { sql: "UPDATE household_member SET name = ? WHERE id = ?", params: [r.name, r.id] })),
    ]);
  }
}
