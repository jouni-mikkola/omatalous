/**
 * The direction of a user's rule. A rule that files a payee under a category of spending (a doctor's, a shop's) is about
 * the money the household pays that payee. The money that payee sends in is another thing: the social insurance
 * institution pays benefits under the same name that a rule for medical payees files as health. So a user's rule with a
 * category of spending or debt reads money out only, and money in is read by the rest of the rules: a refund still takes
 * its payment's category (returns.ts), and what no rule recognises is income and goes to the payee question.
 */
import { getCategory } from "./categories.ts";
import { type CategorizeInput, type CategorizeResult, categorize, type CompiledRule } from "./categorize.ts";
import type { Account } from "./types.ts";

const isOutflow = (category: string): boolean => ["expense", "debt"].includes(getCategory(category).kind);

/** `categorize`, but a user's rule of an outflow category is left out when the money comes in. */
export function categorizeInDirection(input: CategorizeInput, rules: readonly CompiledRule[], accounts: readonly Account[]): CategorizeResult {
  const result = categorize(input, rules, accounts);
  if (!result.byUser || input.amountCents < 0 || !isOutflow(result.category)) return result;
  // the rules that remain may still hold another rule of the user's, of an income category
  return categorize(input, rules.filter((r) => !(r.byUser && isOutflow(r.category))), accounts);
}
