/**
 * Work that runs once after a new version starts. Bank data is stored as
 * the bank sent it; merchant names, categories and transfer flags are
 * derived from it. A new version may derive them better (new rules, better
 * name cleaning), so after a version change every member's derived fields
 * are recomputed, and so is the folded search text. Choices the user made
 * (category_source = 'user', own rules) are kept. Idempotent and cheap:
 * only changed rows are written.
 *
 * A run that is killed halfway (an update's stop timeout, an out-of-memory kill) is picked up again: the lock
 * a dead process leaves is cleared at start (services/recovery.ts), each finished user is remembered under
 * `app_build:<user id>`, and the hourly tick calls this again while the build differs.
 */
import { isLookupName, normalizeMerchant } from "@banking/core";
import { bankTxnCode } from "../connectors/enable-banking/mapper.ts";
import type { EbTransaction } from "../connectors/enable-banking/types.ts";
import { yieldToLoop } from "../platform/yield.ts";
import type { Services } from "./context.ts";
import { reprocessLocked, withUserLock } from "./enrich.ts";

const BUILD_KEY = "app_build";
const LOCK_KEY = "upgrade_lock";
/** The Enable Banking connector's id as its rows carry it in `source` (a connector id is stored and never renamed). */
const EB_SOURCE = "enablebanking";

/**
 * Whether every member's derived fields were last computed by this build. Until the upgrade tasks have
 * finished, stored categories may differ from what the current rules give, and the shortcut for a single
 * change (services/enrich.ts) must not start from them.
 */
export async function derivedStateIsCurrent(s: Services): Promise<boolean> {
  return (await s.settings.get(BUILD_KEY)) === s.build.id;
}

export interface UpgradeResult {
  users: number;
  merchantsRenamed: number;
  recategorised: number;
  /** Rows that got the bank's own code from their stored payload. */
  bankCodes: number;
  /** Loan accounts whose stored balance was a plus and became a minus. */
  loanBalances: number;
}

export async function runUpgradeTasks(s: Services, buildId: string): Promise<UpgradeResult | null> {
  if ((await s.settings.get(BUILD_KEY)) === buildId) return null;
  // one process does it; another one started at the same time (a CLI command) skips
  if (!(await s.settings.tryLock(LOCK_KEY, 10 * 60_000))) {
    console.log(`upgrade tasks for ${buildId} skipped: another run holds ${LOCK_KEY}. The hourly tick tries again.`);
    return null;
  }
  try {
    const result: UpgradeResult = { users: 0, merchantsRenamed: 0, recategorised: 0, bankCodes: 0, loanBalances: 0 };
    // A name an earlier version sent to the trade register and this one refuses (a person's name, the name of a way to
    // pay) must not stay stored with its answer. The answers are shared, so this runs once, before any user's reprocess.
    await s.industry.keepOnly(isLookupName);
    for (const user of await s.users.list()) {
      // finished by an earlier run of this build that was cut short
      if ((await s.settings.get(`${BUILD_KEY}:${user.id}`)) === buildId) continue;
      const repo = s.finance(user.id);
      // one read of the history serves the renaming, the search text and the categorising, and the user's lock keeps
      // an edit or an import from running in between while the event loop is given back
      await withUserLock(user.id, async () => {
        // A row fetched by a version that did not store the bank's own code (before migration 0015, or after a rollback
        // to such a version) has it in the payload. Every run reads the rows still without one, before the history is
        // read, so the categorising below sees the codes. A file's rows have no such payload.
        result.bankCodes += await repo.fillBankCodes(EB_SOURCE, "$.bank_transaction_code", (field) => bankTxnCode(field as EbTransaction["bank_transaction_code"]));
        // A loan account stored at a plus, as an earlier version took the bank's word for it, is a debt of zero to the readers
        // (core `creditAccountLoan`): it takes the minus that the sync stores now. Nothing is above zero after one run.
        result.loanBalances += await repo.negateLoanBalances();
        const rows = await repo.allTransactionsWithSearchText();
        // the rows that get a new name, which they take once the rules of merged names are settled (below)
        const moved: [row: (typeof rows)[number], merchant: string][] = [];
        const names = new Map<string, Set<string>>();
        // the same text repeats across a history: derive each name once
        const derived = new Map<string, string>();
        for (const [i, t] of rows.entries()) {
          if (i % 4000 === 3999) await yieldToLoop();
          const key = `${t.counterparty ?? "\u0001"}\u0000${t.description ?? "\u0001"}`;
          let merchant = derived.get(key);
          if (merchant === undefined) derived.set(key, (merchant = normalizeMerchant(t.counterparty, t.description)));
          // unchanged rows count too: if some rows keep the old name, the rule must stay on it
          const set = names.get(t.merchant);
          if (set) set.add(merchant);
          else names.set(t.merchant, new Set([merchant]));
          if (merchant !== t.merchant) moved.push([t, merchant]);
        }
        const { renames, merged } = followingNames(names);
        // The rules of names that become one name with others are settled while the rows still carry the old names. The
        // in-memory rows get the same choice, so the categorising below starts from what is stored.
        const settled = await repo.settleMerchantRules(merged);
        for (const [t, merchant] of moved) {
          const category = settled(t);
          if (category !== undefined) {
            t.category = category;
            t.categorySource = "user";
          }
          t.merchant = merchant;
        }
        await repo.updateMerchants(moved.map(([t, merchant]) => ({ id: t.id, merchant })));
        // rows from before search_text existed, and the names just re-derived
        await repo.writeSearchText(rows);
        await repo.renameMerchantRules(renames);
        // 0.8.3 and older let a category for one unnamed row become a rule for every unnamed row. The rule has no effect now
        // (core `compileRules`); deleting it is what lets the rows it moved return to automatic in the reprocess below,
        // and it needs no migration, so a rollback keeps working. Rows set by hand are not touched by the reprocess.
        await repo.deleteUnknownMerchantRules();
        await repo.renameMerchantMarks(renames);
        await repo.renameMerchantStates(renames);
        result.recategorised += (await reprocessLocked(repo, s.settings, rows)).changed;
        result.merchantsRenamed += moved.length;
      });
      result.users++;
      await s.settings.set(`${BUILD_KEY}:${user.id}`, buildId);
    }
    await s.settings.set(BUILD_KEY, buildId);
    return result;
  } finally {
    await s.settings.delete(LOCK_KEY);
  }
}

/**
 * What becomes of the household's choices on exact old names. `names` holds every stored name with the new names its
 * rows get. A rule, a mark, a loan's series or an Optimoi decision follows its name (`renames`) when every row of the
 * name got the same new name and no other old name got it too. When two or more old names become one, what the
 * household chose for one of them would reach the rest and could not be told apart again: those names (`merged`) keep
 * their marks and states, and their rules are settled onto the rows instead. A name some rows keep stays as it is.
 */
function followingNames(names: ReadonlyMap<string, ReadonlySet<string>>): { renames: Map<string, string>; merged: Set<string> } {
  const sources = new Map<string, number>();
  for (const to of names.values()) for (const name of to) sources.set(name, (sources.get(name) ?? 0) + 1);
  const renames = new Map<string, string>();
  const merged = new Set<string>();
  for (const [from, to] of names) {
    if (to.has(from)) continue;
    if ([...to].some((name) => sources.get(name)! > 1)) merged.add(from);
    else if (to.size === 1) renames.set(from, [...to][0]!);
  }
  return { renames, merged };
}

/** The start-up and hourly-tick entry: runs the tasks when the build differs and says what happened. Never throws. */
export async function upgradeAndLog(s: Services): Promise<void> {
  try {
    const r = await runUpgradeTasks(s, s.build.id);
    if (r) console.log(`upgrade to ${s.build.version}: ${r.users} users, ${r.merchantsRenamed} merchant names and ${r.recategorised} categories updated, ${r.bankCodes} bank codes read from stored rows`);
  } catch (err) {
    console.error("upgrade tasks failed, the hourly tick tries again:", err);
  }
}
