import { fold } from "./merchant.ts";
import { userPhrases } from "./categorize.ts";
import type { CategoryRule } from "./types.ts";

/** What matching compares of a rule's pattern: two rules of one field with the same key match the same rows. */
export function rulePatternKey(rule: Pick<CategoryRule, "field" | "pattern">): string {
  if (rule.field === "merchant_exact") return fold(rule.pattern.trim()).replace(/\s+/g, " ");
  return (userPhrases(rule.pattern) ?? [fold(rule.pattern.trim())]).join("|");
}
