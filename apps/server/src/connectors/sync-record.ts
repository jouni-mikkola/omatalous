/** What one fetch run adds up, and the records it keeps on the way (sync.ts, sync-backfill.ts). */
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { FetchProblems } from "./fetch-problems.ts";
import type { RefusedByAccount } from "./refused-rows.ts";
import type { SyncSummary } from "./sync.ts";

/** What one run adds up, across connectors. */
export interface Tally {
  /** The run's own record: the count of rows so far is written there while the fetch runs (`countRows`). */
  runId: number;
  failures: number;
  attempts: number;
  /** Rows written, or a balance that moved: only then do categories and the cached analyses need work. */
  rowsChanged: number;
  balanceChanged: boolean;
  /** An account's name, holder, card number or limit was read again (the account list changed, no row did). */
  accountsChanged: boolean;
  /** Per account, what its fetch ran into (fetch-problems.ts); a fetch that works takes its entry away. */
  problems: FetchProblems;
  problemsChanged: boolean;
  /** Per account, the rows of its last fetch the source could not read (refused-rows.ts). */
  refused: RefusedByAccount;
  refusedChanged: boolean;
  /** A source answered that the app has fetched as often as it allows. */
  rateLimited: boolean;
}

/**
 * Adds the rows of one answer to the run's count and writes the count to the run's record, so a page that asks while the
 * fetch runs reads how many rows have come so far (the first fetch of a new bank says it). The count moves once for each
 * account and once for each window of older days.
 */
export async function countRows(repo: FinanceRepo, summary: SyncSummary, tally: Tally, r: { fetched: number; inserted: number }): Promise<void> {
  summary.fetched += r.fetched;
  summary.inserted += r.inserted;
  if (r.fetched) await keepRecord("rows so far", () => repo.noteSyncRunFetched(tally.runId, summary.fetched));
}

/** What a fetch leaves behind to keep (the balances, the days asked for, the calls) is best effort: a failure to write it is logged and does not fail the fetch. */
export async function keepRecord(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(`recording ${what} failed:`, err);
  }
}
