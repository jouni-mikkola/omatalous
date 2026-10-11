/**
 * Category rules and the categories set by hand. Each write here also decides how much to reprocess: a merchant's own
 * rule redoes that merchant's rows, anything broader redoes everything (both bump the user's data version).
 */
import { type CategoryRule, isUnknownMerchant, namesUnknownMerchant, type RuleField } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { reprocess, reprocessMerchantChange } from "./enrich.ts";
import { derivedStateIsCurrent } from "./upgrade.ts";

/** Every rule runs on every transaction at each reprocess; a few hundred is plenty. */
const MAX_RULES = 300;

export async function checkRuleRoom(repo: FinanceRepo): Promise<void> {
  if ((await repo.ruleCount()) >= MAX_RULES) throw new UserError(`Sääntöjä voi olla enintään ${MAX_RULES}.`);
}

/**
 * Whether the user has an older whole-word rule for this merchant name. It matches other merchants that contain
 * the word too, so replacing or removing it changes rows beyond the merchant (the full reprocess handles that).
 */
export function replacesWordRule(rules: readonly CategoryRule[], merchant: string): boolean {
  return rules.some((r) => r.field === "merchant" && r.pattern === merchant);
}

/** Raw bank payloads stay on the server. */
export function publicTx({ raw: _raw, ...t }: StoredTransaction) {
  return t;
}

/** Rows without a merchant name all share one placeholder, so a rule for it would take every one of them. */
const UNNAMED_MERCHANT_RULE = "Tuntemattomalle kauppiaalle ei voi asettaa kategoriaa. Vaihda kategoria tapahtumalta.";

/** A rule the route checked; the number of rows whose category changed. */
export async function addRule(s: Services, userId: string, rule: { field: RuleField; pattern: string; category: string }): Promise<number> {
  if (namesUnknownMerchant(rule)) throw new UserError(UNNAMED_MERCHANT_RULE);
  const repo = s.finance(userId);
  await checkRuleRoom(repo);
  await repo.addRule({ ...rule, priority: 10 });
  return reprocess(repo, s.settings);
}

/** Another member's rule id deletes nothing; the reprocess runs either way. */
export async function deleteRule(s: Services, userId: string, id: number): Promise<number> {
  const repo = s.finance(userId);
  await repo.deleteRule(id);
  return reprocess(repo, s.settings);
}

/**
 * One row's category by hand, and with `createRule` the merchant's rule as well, except for a row without a merchant
 * name: that one changes alone. Someone else's (shared) transaction is read-only and looks the same as a missing one.
 */
export async function setTransactionCategory(s: Services, userId: string, id: string, category: string | null, createRule: boolean) {
  const repo = s.finance(userId);
  const tx = await repo.getTransaction(id);
  if (!tx) throw new NotFound("Tapahtumaa ei löydy.");
  const rule = createRule && category !== null && !isUnknownMerchant(tx.merchant);
  // replacing this merchant's rule keeps the count; a new one must fit under the cap
  if (rule && !(await repo.hasMerchantRule(tx.merchant))) await checkRuleRoom(repo);
  const oldRules = await repo.listRules();
  await repo.setUserCategory(id, category);
  if (rule) await repo.setMerchantRule(tx.merchant, category);
  const { recategorised } = await reprocessMerchantChange(repo, s.settings, {
    merchants: [tx.merchant],
    rule,
    before: new Map([[id, { category: tx.category, categorySource: tx.categorySource }]]),
    oldRules,
    incremental: (await derivedStateIsCurrent(s)) && !(rule && replacesWordRule(oldRules, tx.merchant)),
  });
  const updated = await repo.getTransaction(id);
  // the row itself was set by hand before the rules ran, so reprocess did not count it
  const self = category !== null && category !== tx.category ? 1 : 0;
  return { transaction: updated ? publicTx(updated) : null, changed: recategorised + self };
}

/** The reprocess after a merchant's rule was set, replaced or removed: only that merchant's rows, unless an older whole-word rule went with it. */
async function reprocessRule(s: Services, repo: FinanceRepo, merchant: string, oldRules: readonly CategoryRule[]): Promise<number> {
  const { recategorised } = await reprocessMerchantChange(repo, s.settings, {
    merchants: [merchant],
    rule: true,
    before: new Map(),
    oldRules,
    incremental: (await derivedStateIsCurrent(s)) && !replacesWordRule(oldRules, merchant),
  });
  return recategorised;
}

/** Every row of the merchant, now and later, goes to the category (rows set by hand one by one keep theirs). */
export async function setMerchantCategory(s: Services, userId: string, merchant: string, category: string): Promise<number> {
  if (isUnknownMerchant(merchant)) throw new UserError(UNNAMED_MERCHANT_RULE);
  const repo = s.finance(userId);
  if (!(await repo.hasMerchant(merchant))) throw new UserError("Kauppiasta ei löydy.");
  // replacing the merchant's own rule keeps the count; a new one must fit under the cap
  if (!(await repo.hasMerchantRule(merchant))) await checkRuleRoom(repo);
  const oldRules = await repo.listRules();
  await repo.setMerchantRule(merchant, category);
  return reprocessRule(s, repo, merchant, oldRules);
}

/** Back to automatic: the merchant's rule goes and the other rules and the register decide again. No rule, no reprocess. */
export async function clearMerchantRule(s: Services, userId: string, merchant: string): Promise<number> {
  const repo = s.finance(userId);
  const oldRules = await repo.listRules();
  if (!(await repo.deleteMerchantRules(merchant))) return 0;
  return reprocessRule(s, repo, merchant, oldRules);
}
