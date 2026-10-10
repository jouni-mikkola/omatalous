import type { CategoryRule } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import { UserError } from "../platform/errors.ts";

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
