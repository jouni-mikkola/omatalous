/**
 * Category rules and the categories set by hand. Each write here also decides how much to reprocess: a merchant's own
 * rule redoes that merchant's rows, anything broader redoes everything (both bump the user's data version).
 */
import { type CategoryRule, isKnownCategory, isUnknownMerchant, namesUnknownMerchant, type RuleField, rulePatternKey } from "@banking/core";
import type { FinanceRepo, MerchantRule } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { reprocess, reprocessMerchantChange } from "./enrich.ts";
import { derivedStateIsCurrent } from "./upgrade.ts";

/** Every rule runs on every transaction at each reprocess; a few hundred is plenty. */
const MAX_RULES = 300;

async function checkRuleRoom(repo: FinanceRepo): Promise<void> {
  if ((await repo.ruleCount()) >= MAX_RULES) throw new UserError(`Sääntöjä voi olla enintään ${MAX_RULES}.`);
}

/**
 * Whether the user has an older whole-word rule for this merchant name. It matches other merchants that contain
 * the word too, so replacing or removing it changes rows beyond the merchant (the full reprocess handles that).
 */
function replacesWordRule(rules: readonly CategoryRule[], merchant: string): boolean {
  return rules.some((r) => r.field === "merchant" && r.pattern === merchant);
}

/** Raw bank payloads stay on the server. */
export function publicTx({ raw: _raw, ...t }: StoredTransaction) {
  return t;
}

/** Rows without a merchant name all share one placeholder, so a rule for it would take every one of them. */
const UNNAMED_MERCHANT_RULE = "Tuntemattomalle kauppiaalle ei voi asettaa kategoriaa. Vaihda kategoria tapahtumalta.";

/**
 * A rule the route checked; the number of rows whose category changed. One rule per field and pattern (compared as
 * matching compares it): a repeat with the same category stores nothing, one with another category gives the rule
 * that category, so the latest answer wins. Duplicates made before this stay and all take the new category.
 */
export async function addRule(s: Services, userId: string, rule: { field: RuleField; pattern: string; category: string }): Promise<number> {
  if (namesUnknownMerchant(rule)) throw new UserError(UNNAMED_MERCHANT_RULE);
  const repo = s.finance(userId);
  const key = rulePatternKey(rule);
  const same = (await repo.listRules()).filter((r) => r.field === rule.field && rulePatternKey(r) === key);
  if (same.length === 0) {
    await checkRuleRoom(repo);
    await repo.addRule({ ...rule, priority: 10 });
  } else {
    const stale = same.filter((r) => r.category !== rule.category);
    if (stale.length === 0) return 0;
    await repo.setRuleCategory(stale.map((r) => r.id!), rule.category);
  }
  return reprocess(repo, s.settings);
}

/** Another member's rule id deletes nothing; the reprocess runs either way. */
export async function deleteRule(s: Services, userId: string, id: number): Promise<number> {
  const repo = s.finance(userId);
  await repo.deleteRule(id);
  return reprocess(repo, s.settings);
}

/**
 * What a hand-made change took over, enough to give it back: the category the row had set by hand (null when the rules
 * decided it) and, when the change made the merchant's rule, the rules it replaced (none when there were none), with
 * their field and priority: a rule that sat among the user's own ones must come back in its place.
 */
export interface CategoryUndo {
  category: string | null;
  rule?: MerchantRule[];
}

/** The body of an undo as the browser sends it back: checked, because the rules it names are written to the database. */
export function parseCategoryUndo(input: { category?: unknown; rule?: unknown }): CategoryUndo {
  const known = (v: unknown) => v === null || (typeof v === "string" && isKnownCategory(v));
  // a merchant field, a known category, a small whole priority
  const ruleOk = (v: unknown): v is MerchantRule => {
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    return (r.field === "merchant" || r.field === "merchant_exact") && typeof r.category === "string" && isKnownCategory(r.category) && Number.isInteger(r.priority) && (r.priority as number) >= 0 && (r.priority as number) <= 1000;
  };
  const rules = input.rule;
  if (input.category === undefined || !known(input.category) || (rules !== undefined && (!Array.isArray(rules) || rules.length > 10 || !rules.every(ruleOk)))) throw new UserError("Virheellinen pyyntö.");
  return { category: input.category as string | null, ...(rules !== undefined ? { rule: (rules as MerchantRule[]).map(({ field, category, priority }) => ({ field, category, priority })) } : {}) };
}

/**
 * One row's category by hand, and with `createRule` the merchant's rule as well, except for a row without a merchant
 * name: that one changes alone. Someone else's (shared) transaction is read-only and looks the same as a missing one.
 * The answer carries `undo`, which `undoTransactionCategory` takes.
 */
export async function setTransactionCategory(s: Services, userId: string, id: string, category: string | null, createRule: boolean) {
  const repo = s.finance(userId);
  const tx = await repo.getTransaction(id);
  if (!tx) throw new NotFound("Tapahtumaa ei löydy.");
  const rule = createRule && category !== null && !isUnknownMerchant(tx.merchant);
  // replacing this merchant's rule keeps the count; a new one must fit under the cap
  if (rule && !(await repo.hasMerchantRule(tx.merchant))) await checkRuleRoom(repo);
  const oldRules = await repo.listRules();
  const undo: CategoryUndo = { category: tx.categorySource === "user" ? tx.category : null, ...(rule ? { rule: await repo.merchantRules(tx.merchant) } : {}) };
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
  return { transaction: updated ? publicTx(updated) : null, changed: recategorised + self, undo };
}

/**
 * Gives a hand-made change back: the row returns to what it had (its own category, or the rules' choice), the
 * merchant's rule the change made goes or takes its old category back, and the merchant's other rows follow the rules
 * again. The rows end where they were before the change.
 */
export async function undoTransactionCategory(s: Services, userId: string, id: string, undo: CategoryUndo): Promise<{ changed: number }> {
  const repo = s.finance(userId);
  const tx = await repo.getTransaction(id);
  if (!tx) throw new NotFound("Tapahtumaa ei löydy.");
  const oldRules = await repo.listRules();
  const rule = undo.rule !== undefined;
  await repo.setUserCategory(id, undo.category);
  if (undo.rule) await repo.restoreMerchantRules(tx.merchant, undo.rule);
  const { recategorised } = await reprocessMerchantChange(repo, s.settings, {
    merchants: [tx.merchant],
    rule,
    before: new Map([[id, { category: tx.category, categorySource: tx.categorySource }]]),
    oldRules,
    // a whole-word rule given back reaches longer names too, as one taken away did: neither is the merchant's rows alone
    incremental: (await derivedStateIsCurrent(s)) && !(rule && (replacesWordRule(oldRules, tx.merchant) || undo.rule!.some((r) => r.field === "merchant"))),
  });
  return { changed: recategorised };
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
