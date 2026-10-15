/**
 * What each fetch leaves behind about an account's balance and how far back its rows go: the balances the bank sent
 * (`account_balances`), the earliest day the app asked for (`account_history`) and the calls made (`account_fetch`).
 * The tables are keyed by the real account (`keyOf`), not the user, so a joint account fetched by both members writes
 * one row of each kind. Nothing here is read back by a page.
 */
import { keyOf } from "../household-repo.ts";
import type { FinanceContext } from "./context.ts";

/** One balance to record: euros only, the sign as `accounts.balance_cents` has it. */
interface RecordedBalance {
  cents: number;
  /** The bank's code as sent; anything but four capital letters is recorded as OTHR. */
  type: string | null;
  referenceDay: string | null;
}

const balanceType = (type: string | null): string => (type !== null && /^[A-Z]{4}$/.test(type) ? type : "OTHR");

export class BalanceRecordRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /**
   * Records the balances of one fetch: one row per account key, day and type. A row of the same key, day and type is
   * replaced, so the last fetch of the day stands (a joint account is fetched by both members). A row that the seed
   * wrote is replaced by one the bank sent; a bank's row is replaced only by a fetch no older than itself.
   */
  async recordBalances(accountKey: string, day: string, fetchedAt: string, balances: readonly RecordedBalance[]): Promise<void> {
    if (!balances.length) return;
    await this.ctx.db.batch(
      balances.map((b) => ({
        sql: `INSERT INTO account_balances (account_key, day, type, reference_date, cents, fetched_at, source) VALUES (?, ?, ?, ?, ?, ?, 'bank')
              ON CONFLICT (account_key, day, type) DO UPDATE SET reference_date = excluded.reference_date, cents = excluded.cents, fetched_at = excluded.fetched_at, source = 'bank'
              WHERE account_balances.source <> 'bank' OR excluded.fetched_at >= account_balances.fetched_at`,
        params: [accountKey, day, balanceType(b.type), b.referenceDay, b.cents, fetchedAt],
      })),
    );
  }

  /**
   * Gives every euro account of the user that holds a balance one row from it: the day of the stored stamp, type OTHR, no
   * reference day (so it is never a proof), source `seed`. A row that is there stays, whatever its source, so a balance the
   * bank sent is never replaced. An account in another currency is left out: its stored balance is not known to be euros.
   * Returns how many rows were written.
   */
  async seedBalancesFromAccounts(): Promise<number> {
    const r = await this.ctx.db.run(
      `INSERT OR IGNORE INTO account_balances (account_key, day, type, reference_date, cents, fetched_at, source)
       SELECT ${keyOf("a")}, substr(a.balance_at, 1, 10), 'OTHR', NULL, a.balance_cents, a.balance_at, 'seed' FROM accounts a
       WHERE a.user_id = ? AND a.balance_cents IS NOT NULL AND a.balance_at IS NOT NULL AND UPPER(TRIM(a.currency)) = 'EUR' ORDER BY a.id`,
      [this.ctx.userId],
    );
    return r.changes;
  }

  /**
   * Notes that the app asked the bank for rows from `dateFrom` for this account. `asked_from` is the first day ever
   * asked for and only moves earlier: it is the earlier of `dateFrom` and the oldest booked row stored, which a file
   * import may hold from before. `first_row_day` is the oldest booked row stored, also only earlier.
   */
  async recordHistory(accountId: string, dateFrom: string, source: "default" | "longest" | "csv", at: string): Promise<void> {
    const first = (await this.ctx.db.first<{ d: string | null }>("SELECT MIN(booking_date) AS d FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked'", [this.ctx.userId, accountId]))?.d ?? null;
    const asked = first !== null && first < dateFrom ? first : dateFrom;
    await this.ctx.db.run(
      `INSERT INTO account_history (account_id, asked_from, first_row_day, source, recorded_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET
         asked_from = MIN(account_history.asked_from, excluded.asked_from),
         first_row_day = CASE WHEN account_history.first_row_day IS NULL THEN excluded.first_row_day
                              WHEN excluded.first_row_day IS NULL THEN account_history.first_row_day
                              ELSE MIN(account_history.first_row_day, excluded.first_row_day) END,
         source = CASE WHEN excluded.asked_from < account_history.asked_from THEN excluded.source ELSE account_history.source END,
         recorded_at = CASE WHEN excluded.asked_from < account_history.asked_from THEN excluded.recorded_at ELSE account_history.recorded_at END`,
      [accountId, asked, first, source, at],
    );
  }

  /** Notes one call to the bank, made with this user's consent. The old notes are dropped by `HouseholdRepo.pruneFetchNotes`, which no user owns. */
  async recordFetch(accountKey: string, at: Date, trigger: string): Promise<void> {
    await this.ctx.db.run("INSERT INTO account_fetch (account_key, at, trigger, user_id) VALUES (?, ?, ?, ?)", [accountKey, at.toISOString(), trigger, this.ctx.userId]);
  }
}
