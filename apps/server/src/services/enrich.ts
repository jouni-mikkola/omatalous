import { type CategoryRule, categoryForIndustry, enrichIsland, enrichTransactionsPausing, fold, type Transaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import type { SettingsRepo } from "../db/settings-repo.ts";
import { yieldToLoop } from "../platform/yield.ts";

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
    if (running.get(userId) === tail) running.delete(userId);
  }
}

export async function reprocessDetailed(repo: FinanceRepo, settings: SettingsRepo): Promise<ReprocessResult> {
  return withUserLock(repo.userId, () => reprocessLocked(repo, settings));
}

async function industryMap(repo: FinanceRepo): Promise<Map<string, string>> {
  // derived here rather than stored, so a new version's code table applies on the next reprocess
  const industries = new Map<string, string>();
  for (const [merchant, { code, codeSet }] of await repo.industryCodes()) {
    const category = categoryForIndustry(code, codeSet);
    if (category) industries.set(merchant, category);
  }
  return industries;
}

/** `reprocessDetailed` for a caller that holds the user's lock already (the upgrade tasks) and may have read the rows. */
export async function reprocessLocked(repo: FinanceRepo, settings: SettingsRepo, rows?: StoredTransaction[]): Promise<ReprocessResult> {
  // read before the rows are: an import that lands while this runs sets a new mark, and that one stays
  const mark = await repo.unprocessedMark();
  const [txs, accounts, rules, industries] = await Promise.all([rows ?? repo.allTransactions(), repo.listAccounts(), repo.listRules(), industryMap(repo)]);
  const before = new Map(txs.map((t) => [t.id, t.category]));
  const changed = await enrichTransactionsPausing(txs, accounts, rules, industries, yieldToLoop);
  await repo.updateEnrichment(changed);
  await settings.bumpUserDataVersion(repo.userId);
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
    const [rows, accounts, rules, industries, outsideMatches] = await Promise.all([
      repo.transactionsOfMerchants(merchants),
      repo.listAccounts(),
      repo.listRules(),
      industryMap(repo),
      repo.matchedRowsOutside(merchants),
    ]);
    if (rows.length > ISLAND_MAX_ROWS) return reprocessLocked(repo, settings);
    const island = enrichIsland({ rows, before: change.before, accounts, rules, oldRules: change.oldRules, industries, outsideMatches });
    if (!island.ok) return reprocessLocked(repo, settings);
    await repo.updateEnrichment(island.changed);
    await settings.bumpUserDataVersion(repo.userId);
    return { ...summarise(island.changed, new Map(rows.map((t) => [t.id, t.category]))), incremental: true };
  });
}
