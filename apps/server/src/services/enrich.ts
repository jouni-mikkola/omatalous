import { categoryForIndustry, enrichTransactions } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { SettingsRepo } from "../db/settings-repo.ts";

export interface ReprocessResult {
  /** Rows written: a new category, category source or transfer flag. */
  changed: number;
  /** Rows that ended up in a different category. */
  recategorised: number;
}

/**
 * Re-runs categorisation and transfer detection over one user's
 * transactions, then bumps the data version so cached analyses refresh.
 * Called after every import, sync, rule change or manual recategorisation.
 */
export async function reprocess(repo: FinanceRepo, settings: SettingsRepo): Promise<number> {
  return (await reprocessDetailed(repo, settings)).changed;
}

export async function reprocessDetailed(repo: FinanceRepo, settings: SettingsRepo): Promise<ReprocessResult> {
  const [txs, accounts, rules, codes] = await Promise.all([repo.allTransactions(), repo.listAccounts(), repo.listRules(), repo.industryCodes()]);
  // derived here rather than stored, so a new version's code table applies on the next reprocess
  const industries = new Map<string, string>();
  for (const [merchant, { code, codeSet }] of codes) {
    const category = categoryForIndustry(code, codeSet);
    if (category) industries.set(merchant, category);
  }
  const before = new Map(txs.map((t) => [t.id, t.category]));
  const changed = enrichTransactions(txs, accounts, rules, industries);
  await repo.updateEnrichment(changed);
  await settings.bumpDataVersion();
  return { changed: changed.length, recategorised: changed.filter((t) => t.categorySource !== "user" && t.category !== before.get(t.id)).length };
}
