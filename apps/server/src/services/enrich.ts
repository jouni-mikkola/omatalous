import { type CategoryRule, categoryForCompany, enrichIsland, enrichTransactionsPausing, fold, type Transaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import type { SettingsRepo } from "../db/settings-repo.ts";
import { yieldToLoop } from "../platform/yield.ts";

/** The users whose lock the code it is handed to runs under: it must not wait for those locks. */
export type HeldLocks = ReadonlySet<string>;

const afterHooks = new WeakMap<SettingsRepo, (userId: string, held: HeldLocks) => Promise<void>>();

/**
 * Names what runs for a user after a reprocess has written its rows and bumped the data version, for the services that
 * hold `settings`: the one place every write path of the rows passes (import, sync, rule, account change, upgrade).
 */
export function afterReprocess(settings: SettingsRepo, hook: (userId: string, held: HeldLocks) => Promise<void>): void {
  afterHooks.set(settings, hook);
}

const clocks = new WeakMap<SettingsRepo, () => string>();

/**
 * Names where the services of `settings` read the day: a closing refund of a contract is paired when the contract has
 * ended by that day, as the reports read it, so a reprocess is given it.
 */
export function reprocessClock(settings: SettingsRepo, today: () => string): void {
  clocks.set(settings, today);
}

export interface ReprocessResult {
  /** Rows written: a new category, category source or transfer flag. */
  changed: number;
  /** Rows that ended up in a different category. */
  recategorised: number;
  /** True when only the rows of one merchant were read (see `reprocessMerchantChange`). */
  incremental?: boolean;
}

/**
 * Re-runs categorisation and transfer detection over one user's
 * transactions, then bumps the user's data version so cached analyses refresh.
 * Called after every import, sync, rule change or manual recategorisation.
 */
export async function reprocess(repo: FinanceRepo, settings: SettingsRepo): Promise<number> {
  return (await reprocessDetailed(repo, settings)).changed;
}

const running = new Map<string, Promise<unknown>>();
/** How many runs under each lock have ended: an answer built before one of them is older than that run's writes. */
const ended = new Map<string, number>();
/** Odd while a reprocess writes a user's rows in pieces, one more after: a build that saw it move read a part of them. */
const writes = new Map<string, number>();

async function writeEnrichment(repo: FinanceRepo, changed: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]): Promise<void> {
  const step = () => writes.set(repo.userId, (writes.get(repo.userId) ?? 0) + 1);
  step();
  try {
    await repo.updateEnrichment(changed);
  } finally {
    step();
  }
}

/**
 * Runs `fn` after every earlier call for the same user has finished. Processing a history gives the event loop
 * back now and then, so two runs for one user (two quick edits) could otherwise interleave and the one that read
 * older rows could write last.
 */
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const before = running.get(userId) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  running.set(userId, tail);
  try {
    return await run;
  } finally {
    ended.set(userId, (ended.get(userId) ?? 0) + 1);
    if (running.get(userId) === tail) running.delete(userId);
  }
}

const NONE: HeldLocks = new Set();

/**
 * Whether a run holds the lock of one of these users, seen by code that holds no lock (`held` empty): such a reader
 * may serve what it built before the run, or wait for it (`whenUnlocked`). Code that holds a lock never waits on one.
 * The locks held are handed down by hand, not kept in an AsyncLocalStorage: one of those slows every await of the
 * process about three times on Node 22, and every request with it.
 */
export function lockedOutside(userIds: readonly string[], held: HeldLocks = NONE): boolean {
  return !held.size && userIds.some((id) => running.has(id));
}


/** The count of ended runs of each of these users, in their order: equal counts mean no run ended in between. */
export function runsEnded(userIds: readonly string[], held: HeldLocks = NONE): string {
  // a run whose lock the caller holds ends after it: what is built there is of the state after that run
  return userIds.map((id) => (ended.get(id) ?? 0) + (held.has(id) ? 1 : 0)).join(",");
}

/** The write counts of these users (see `writes`), to compare before and after a read of their rows. */
export function writesOf(userIds: readonly string[]): string {
  return userIds.map((id) => writes.get(id) ?? 0).join(",");
}

/** Resolves when the runs that hold these users' locks now have ended. */
export async function whenUnlocked(userIds: readonly string[]): Promise<void> {
  await Promise.all(userIds.map((id) => running.get(id)));
}

export async function reprocessDetailed(repo: FinanceRepo, settings: SettingsRepo): Promise<ReprocessResult> {
  return withUserLock(repo.userId, () => reprocessLocked(repo, settings));
}

export async function industryMap(repo: FinanceRepo): Promise<Map<string, string>> {
  // derived here rather than stored, so a new version's code table applies on the next reprocess
  const industries = new Map<string, string>();
  for (const [merchant, answer] of await repo.industryCodes()) {
    const category = categoryForCompany(answer);
    if (category) industries.set(merchant, category);
  }
  return industries;
}

/** `reprocessDetailed` for a caller that holds the user's lock already (the upgrade tasks) and may have read the rows. */
export async function reprocessLocked(repo: FinanceRepo, settings: SettingsRepo, rows?: StoredTransaction[]): Promise<ReprocessResult> {
  // read before the rows are: an import that lands while this runs sets a new mark, and that one stays
  const mark = await repo.unprocessedMark();
  const [txs, accounts, rules, industries, roles] = await Promise.all([rows ?? repo.allTransactions(), repo.listAccounts(), repo.listRules(), industryMap(repo), repo.payerRoles()]);
  const before = new Map(txs.map((t) => [t.id, t.category]));
  const changed = await enrichTransactionsPausing(txs, accounts, rules, industries, yieldToLoop, { memberId: repo.userId, roles }, undefined, clocks.get(settings)?.());
  // the version moves with the last piece of the rows: the analysis is built before the run or after it (AnalysisCache)
  await writeEnrichment(repo, changed);
  await afterHooks.get(settings)?.(repo.userId, new Set([repo.userId]));
  await repo.clearUnprocessedMark(mark);
  return summarise(changed, before);
}

const summarise = (changed: readonly Transaction[], before: ReadonlyMap<string, string>): ReprocessResult => ({
  changed: changed.length,
  recategorised: changed.filter((t) => t.categorySource !== "user" && t.category !== before.get(t.id)).length,
});

/** The most rows of one merchant's group worth reading for a single change; a bigger group is cheaper through the full run. */
const ISLAND_MAX_ROWS = 20_000;

export interface MerchantChange {
  /** The merchants the change is about. */
  merchants: readonly string[];
  /** A merchant rule: every merchant whose folded name equals one of these is in it too. */
  rule: boolean;
  /** What the rows the change set by hand were before it. */
  before: ReadonlyMap<string, Pick<Transaction, "category" | "categorySource">>;
  /** The user's rules before the change. */
  oldRules: readonly CategoryRule[];
  /** False when the stored rows may not be what the current code derives (an upgrade has not finished) or the change reaches beyond its merchants. */
  incremental: boolean;
}

/**
 * The reprocess after one category set by hand or one merchant rule. Only the rows of the merchant are read and
 * categorised again, and the result is the one the full run gives (core `enrichIsland` checks that nothing reaches
 * beyond the merchant). When it cannot say so the full run follows, so the answer is the same either way.
 */
export async function reprocessMerchantChange(repo: FinanceRepo, settings: SettingsRepo, change: MerchantChange): Promise<ReprocessResult> {
  return withUserLock(repo.userId, async () => {
    // rows still waiting for their first categories are not in the state the island starts from
    if (!change.incremental || (await repo.unprocessedMark()) !== null) return reprocessLocked(repo, settings);
    let merchants = [...change.merchants];
    if (change.rule) {
      const names = new Set(merchants.map((m) => fold(m)));
      merchants = (await repo.merchantNames()).filter((m) => names.has(fold(m)));
    }
    const [rows, accounts, rules, industries, outsideMatches, roles] = await Promise.all([
      repo.transactionsOfMerchants(merchants),
      repo.listAccounts(),
      repo.listRules(),
      industryMap(repo),
      repo.matchedRowsOutside(merchants),
      repo.payerRoles(),
    ]);
    if (rows.length > ISLAND_MAX_ROWS) return reprocessLocked(repo, settings);
    // a payer's median reads rows of other merchants: their payer, sum and day, nothing more
    const payerRows = roles.length ? await repo.incomingPayerRows() : undefined;
    const island = enrichIsland({ rows, before: change.before, accounts, rules, oldRules: change.oldRules, industries, outsideMatches, payers: { memberId: repo.userId, roles }, payerRows, today: clocks.get(settings)?.() });
    if (!island.ok) return reprocessLocked(repo, settings);
    await writeEnrichment(repo, island.changed);
    await afterHooks.get(settings)?.(repo.userId, new Set([repo.userId]));
    return { ...summarise(island.changed, new Map(rows.map((t) => [t.id, t.category]))), incremental: true };
  });
}
