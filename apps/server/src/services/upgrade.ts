/**
 * Work that runs once after a new version starts. Bank data is stored as
 * the bank sent it; merchant names, categories and transfer flags are
 * derived from it. A new version may derive them better (new rules, better
 * name cleaning), so after a version change every member's derived fields
 * are recomputed, and so is the folded search text. Choices the user made
 * (category_source = 'user', own rules) are kept. Idempotent and cheap:
 * only changed rows are written.
 */
import { normalizeMerchant } from "@banking/core";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";

const BUILD_KEY = "app_build";
const LOCK_KEY = "upgrade_lock";

export interface UpgradeResult {
  users: number;
  merchantsRenamed: number;
  recategorised: number;
}

export async function runUpgradeTasks(s: Services, buildId: string): Promise<UpgradeResult | null> {
  if ((await s.settings.get(BUILD_KEY)) === buildId) return null;
  // one process does it; another one started at the same time (a CLI command) skips
  if (!(await s.settings.tryLock(LOCK_KEY, 10 * 60_000))) return null;
  try {
    const result: UpgradeResult = { users: 0, merchantsRenamed: 0, recategorised: 0 };
    for (const user of await s.users.list()) {
      const repo = s.finance(user.id);
      const changes: { id: string; merchant: string }[] = [];
      const names = new Map<string, Set<string>>();
      for (const t of await repo.allTransactions()) {
        const merchant = normalizeMerchant(t.counterparty, t.description);
        // unchanged rows count too: if some rows keep the old name, the rule must stay on it
        names.set(t.merchant, (names.get(t.merchant) ?? new Set()).add(merchant));
        if (merchant !== t.merchant) changes.push({ id: t.id, merchant });
      }
      await repo.updateMerchants(changes);
      // rows from before search_text existed, and the names just re-derived
      await repo.refreshSearchText();
      // a rule for an exact old name follows it only when every row of that name got the same new name
      await repo.renameMerchantRules(new Map([...names].filter(([from, to]) => to.size === 1 && !to.has(from)).map(([from, to]) => [from, [...to][0]!])));
      result.recategorised += await reprocess(repo, s.settings);
      result.merchantsRenamed += changes.length;
      result.users++;
    }
    await s.settings.set(BUILD_KEY, buildId);
    return result;
  } finally {
    await s.settings.delete(LOCK_KEY);
  }
}
