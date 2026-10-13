/**
 * Cross-user reads for the household view. A user sees another member's
 * account only when its owner shared it (account_shares); sharing is
 * read-only and per account. Who uses an account (account_use) is kept apart
 * from that: a use never lets anybody see an account.
 */
import { accountBank, type Row, type StoredAccount, type StoredTransaction, str, TX_COLUMNS_LIGHT, toAccount, toTransaction } from "./rows.ts";
import type { Db } from "./types.ts";

export interface AccountShare {
  accountId: string;
  userId: string;
}

/**
 * The real account an `accounts` row stands for: the bank's stable identity, or the row's own id when it has none (an
 * imported or a demo account). A joint account both partners linked is two rows with one key.
 */
export const accountKey = (a: Pick<StoredAccount, "id" | "identity">): string => a.identity ?? a.id;
/** The same key in SQL, for the accounts table named or aliased `a`. */
const keyOf = (a: string) => `COALESCE(${a}.identity, ${a}.id)`;

/** One user of a real account as the household said it. `userId` null: the holders who are no user of this instance. */
interface UseRow {
  key: string;
  userId: string | null;
  weight: number;
}

/** An account as the derivation of a use reads it: who linked it, which real account it is, and the bank's line of holders. */
interface HeldAccount {
  id: string;
  userId: string;
  key: string;
  holder: string | null;
}

/** A real account cut by who paid it: `setBy` null means the app set it. */
interface SplitRow {
  key: string;
  setBy: string | null;
  setAt: string;
}

/** What the household said of whose money a payer's (`kind` "in") or the opening's (`kind` "opening", key "") was. */
export interface AnswerRow {
  key: string;
  kind: "in" | "opening";
  answerKey: string;
  owner: string;
}

/** One stored part of a row: see migration 0020. */
export interface PartRow {
  owner: string;
  kind: string;
  grp: string;
  cents: number;
  passed: boolean;
}

/** What a real account's parts were built from, and its lots (JSON). */
interface PartsState {
  key: string;
  signature: string;
  builtAt: string;
  lots: string;
}

const partKeyOf = (p: PartRow): string => `${p.owner}\u0000${p.kind}\u0000${p.grp}`;
/** The parts of one row as a list that compares equal when the parts do. */
const partsText = (parts: readonly PartRow[]): string =>
  JSON.stringify([...parts].sort((a, b) => (partKeyOf(a) < partKeyOf(b) ? -1 : 1)).map((p) => [p.owner, p.kind, p.grp, p.cents, p.passed ? 1 : 0]));

export class HouseholdRepo {
  constructor(private readonly db: Db) {}

  /**
   * Accounts other members shared with `userId`, with the owner's display name. Each carries the bank of its own
   * connection for the analysis (whose price list applies to a card). A response leaves it out (routes/finance.ts).
   */
  async sharedWith(userId: string): Promise<(StoredAccount & { ownerName: string })[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.*, ${accountBank("a")}, u.display_name AS owner_name FROM account_shares s
       JOIN accounts a ON a.id = s.account_id JOIN users u ON u.id = a.user_id
       WHERE s.user_id = ? AND a.user_id != ? ORDER BY u.display_name, a.name`,
      [userId, userId],
    );
    return rows.map((r) => ({ ...toAccount(r), ownerName: String(r.owner_name) }));
  }

  async transactionsOfAccounts(accountIds: readonly string[]): Promise<StoredTransaction[]> {
    if (!accountIds.length) return [];
    const marks = accountIds.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE account_id IN (${marks}) ORDER BY booking_date, id`, [...accountIds])).map(toTransaction);
  }

  /** Shares of the owner's accounts (who sees what). */
  async sharesOf(ownerId: string): Promise<AccountShare[]> {
    return (
      await this.db.all<Row>("SELECT s.account_id, s.user_id FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ?", [ownerId])
    ).map((r) => ({ accountId: String(r.account_id), userId: String(r.user_id) }));
  }

  /** Only the account's owner can share it; the INSERT … SELECT enforces that. Sharing twice is fine. */
  async share(ownerId: string, accountId: string, withUserId: string): Promise<boolean> {
    if (ownerId === withUserId) return false;
    await this.db.run(
      `INSERT OR IGNORE INTO account_shares (account_id, user_id, created_at)
       SELECT a.id, u.id, ? FROM accounts a, users u WHERE a.id = ? AND a.user_id = ? AND u.id = ?`,
      [new Date().toISOString(), accountId, ownerId, withUserId],
    );
    const shared = await this.db.first(
      "SELECT 1 FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE s.account_id = ? AND s.user_id = ? AND a.user_id = ?",
      [accountId, withUserId, ownerId],
    );
    return shared !== null;
  }

  async unshare(ownerId: string, accountId: string, withUserId: string): Promise<void> {
    await this.db.run("DELETE FROM account_shares WHERE account_id = ? AND user_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)", [
      accountId,
      withUserId,
      ownerId,
    ]);
  }

  /** What the household said of who uses these real accounts. A key with no row was never said, or was taken back. */
  async useRows(keys: readonly string[]): Promise<UseRow[]> {
    if (!keys.length) return [];
    const marks = keys.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT account_key, user_id, weight FROM account_use WHERE account_key IN (${marks}) ORDER BY account_key, user_id IS NULL, user_id`, [...keys])).map(
      (r) => ({ key: String(r.account_key), userId: str(r.user_id), weight: Number(r.weight) }),
    );
  }

  /** Says who uses a real account. The rows replace what was said before, in one transaction, so a read never sees half of a statement. */
  async setUse(key: string, rows: readonly Pick<UseRow, "userId" | "weight">[], saidBy: string, at: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM account_use WHERE account_key = ?", params: [key] },
      ...rows.map((r) => ({ sql: "INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, ?, ?, ?)", params: [key, r.userId, r.weight, saidBy, at] })),
    ]);
  }

  /** Takes back what was said: the use is derived from the bank's holders again. */
  async clearUse(key: string): Promise<void> {
    await this.db.run("DELETE FROM account_use WHERE account_key = ?", [key]);
  }

  /**
   * Deletes a member, and with them their rows of `account_use` (the cascade). What they weighed is not lost to the
   * others first: on each real account where somebody else has a row too, it is added to the row of the holders who
   * are no user (made if there is none), so the ratio that was said stays. A weight of nothing moves nothing. Where
   * the member had the only row, the statement goes with them and the use is derived again. What was said of a real
   * account that nobody holds a copy of now (the member's was the last) goes too, so the next member who links it
   * starts without a statement. The answers that name the member as the owner of some money go too. One transaction.
   */
  async removeMember(userId: string): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO account_use (account_key, user_id, weight, said_by, said_at)
              SELECT account_key, NULL, weight, said_by, said_at FROM account_use
              WHERE user_id = ? AND weight > 0
                AND EXISTS (SELECT 1 FROM account_use o WHERE o.account_key = account_use.account_key AND o.user_id IS NOT ?)
              ON CONFLICT (account_key, COALESCE(user_id, '')) DO UPDATE SET weight = weight + excluded.weight`,
        params: [userId, userId],
      },
      { sql: "DELETE FROM users WHERE id = ?", params: [userId] },
      { sql: "DELETE FROM owner_answer WHERE owner = ?", params: [`u:${userId}`] },
      { sql: `DELETE FROM account_use WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE ${keyOf("a")} = account_use.account_key)` },
    ]);
  }

  /**
   * Every account of the instance with its holders, for deriving who uses an account: a member is matched to a holder
   * by the name their own accounts give. The ids tell which real account a loan of another member is paid from
   * (services/loans-in-view.ts). The names and the ids are compared on the server and are not for a response.
   */
  async heldAccounts(): Promise<HeldAccount[]> {
    return (await this.db.all<Row>(`SELECT a.id, a.user_id, ${keyOf("a")} AS account_key, a.holder FROM accounts a ORDER BY a.id`)).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      key: String(r.account_key),
      holder: str(r.holder),
    }));
  }

  /** Every account of the instance, whoever linked it: the payers of a joint account are found among them by IBAN (services/money-trace.ts). */
  async allAccounts(): Promise<StoredAccount[]> {
    return (await this.db.all<Row>(`SELECT a.*, ${accountBank("a")} FROM accounts a ORDER BY a.id`)).map(toAccount);
  }

  /** The accounts cut by who paid them, by real account. */
  async splitRows(keys: readonly string[]): Promise<SplitRow[]> {
    if (!keys.length) return [];
    const marks = keys.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT account_key, set_by, set_at FROM account_split WHERE account_key IN (${marks}) ORDER BY account_key`, [...keys])).map((r) => ({
      key: String(r.account_key),
      setBy: str(r.set_by),
      setAt: String(r.set_at),
    }));
  }

  /** Cuts an account by who paid it. `replace` false leaves a row that is there (the app sets it once); returns whether a row was written. */
  async setSplit(key: string, setBy: string | null, at: string, replace: boolean): Promise<boolean> {
    const keep = replace ? "ON CONFLICT (account_key) DO UPDATE SET set_by = excluded.set_by, set_at = excluded.set_at" : "ON CONFLICT (account_key) DO NOTHING";
    return (await this.db.run(`INSERT INTO account_split (account_key, mode, set_by, set_at) VALUES (?, 'source', ?, ?) ${keep}`, [key, setBy, at])).changes > 0;
  }

  async clearSplit(key: string): Promise<void> {
    await this.db.run("DELETE FROM account_split WHERE account_key = ?", [key]);
  }

  async answerRows(key: string): Promise<AnswerRow[]> {
    return (await this.db.all<Row>("SELECT kind, key, owner FROM owner_answer WHERE account_key = ? ORDER BY kind, key", [key])).map((r) => ({
      key,
      kind: String(r.kind) as AnswerRow["kind"],
      answerKey: String(r.key),
      owner: String(r.owner),
    }));
  }

  /** Says whose money a payer's or the opening was; saying it again replaces it. */
  async setAnswer(key: string, kind: AnswerRow["kind"], answerKey: string, owner: string, saidBy: string, at: string): Promise<void> {
    await this.db.run(
      `INSERT INTO owner_answer (account_key, kind, key, owner, said_by, said_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_key, kind, key) DO UPDATE SET owner = excluded.owner, said_by = excluded.said_by, said_at = excluded.said_at`,
      [key, kind, answerKey, owner, saidBy, at],
    );
  }

  async deleteAnswer(key: string, kind: AnswerRow["kind"], answerKey: string): Promise<void> {
    await this.db.run("DELETE FROM owner_answer WHERE account_key = ? AND kind = ? AND key = ?", [key, kind, answerKey]);
  }

  async partsState(key: string): Promise<PartsState | null> {
    const r = await this.db.first<Row>("SELECT account_key, signature, built_at, lots FROM tx_part_state WHERE account_key = ?", [key]);
    return r ? { key: String(r.account_key), signature: String(r.signature), builtAt: String(r.built_at), lots: String(r.lots) } : null;
  }

  /** The stored parts of the rows of these accounts, by row id. */
  async partsOf(accountIds: readonly string[]): Promise<Map<string, PartRow[]>> {
    const out = new Map<string, PartRow[]>();
    if (!accountIds.length) return out;
    const marks = accountIds.map(() => "?").join(",");
    const rows = await this.db.all<Row>(
      `SELECT p.tx_id, p.owner, p.kind, p.grp, p.cents, p.passed FROM tx_part p JOIN transactions t ON t.id = p.tx_id WHERE t.account_id IN (${marks}) ORDER BY p.tx_id, p.owner, p.kind, p.grp`,
      [...accountIds],
    );
    for (const r of rows) {
      const part: PartRow = { owner: String(r.owner), kind: String(r.kind), grp: String(r.grp), cents: Number(r.cents), passed: Number(r.passed) === 1 };
      const list = out.get(String(r.tx_id));
      if (list) list.push(part);
      else out.set(String(r.tx_id), [part]);
    }
    return out;
  }

  /**
   * Writes the parts a real account was built with: only the rows whose parts changed, the rows that have none now
   * cleared, and the state, in one transaction, so a read never sees half of a build. `built` is by row id; `had` is
   * what `partsOf` gave before. Returns how many rows were written.
   */
  async writeParts(built: ReadonlyMap<string, readonly PartRow[]>, had: ReadonlyMap<string, readonly PartRow[]>, state: PartsState): Promise<number> {
    const changed = [...built].filter(([id, parts]) => partsText(parts) !== partsText(had.get(id) ?? []));
    const gone = [...had.keys()].filter((id) => !built.has(id));
    await this.db.batch([
      ...[...changed.map(([id]) => id), ...gone].map((id) => ({ sql: "DELETE FROM tx_part WHERE tx_id = ?", params: [id] })),
      ...changed.flatMap(([id, parts]) =>
        parts.map((p) => ({ sql: "INSERT INTO tx_part (tx_id, owner, kind, grp, cents, passed) VALUES (?, ?, ?, ?, ?, ?)", params: [id, p.owner, p.kind, p.grp, p.cents, p.passed ? 1 : 0] })),
      ),
      {
        sql: `INSERT INTO tx_part_state (account_key, signature, built_at, lots) VALUES (?, ?, ?, ?)
              ON CONFLICT (account_key) DO UPDATE SET signature = excluded.signature, built_at = excluded.built_at, lots = excluded.lots`,
        params: [state.key, state.signature, state.builtAt, state.lots],
      },
    ]);
    return changed.length + gone.length;
  }

  /** Forgets the parts of a real account that is no pool (any more): their rows (by id) and the state. */
  async clearParts(key: string, rowIds: readonly string[]): Promise<void> {
    await this.db.batch([...rowIds.map((id) => ({ sql: "DELETE FROM tx_part WHERE tx_id = ?", params: [id] })), { sql: "DELETE FROM tx_part_state WHERE account_key = ?", params: [key] }]);
  }

  /** Everyone whose figures hold a real account: the members who linked it and the members it is shared with. */
  async seenBy(key: string): Promise<string[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.user_id FROM accounts a WHERE ${keyOf("a")} = ?
       UNION SELECT s.user_id FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE ${keyOf("a")} = ?`,
      [key, key],
    );
    return rows.map((r) => String(r.user_id));
  }
}
