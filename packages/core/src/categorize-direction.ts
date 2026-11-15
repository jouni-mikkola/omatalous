/**
 * The direction of a user's rule. A rule that files a payee under a category of spending (a doctor's, a shop's) is about
 * the money the household pays that payee. The money that payee sends in is another thing: the social insurance
 * institution pays benefits under the same name that a rule for medical payees files as health. So a user's rule with a
 * category of spending reads money out only, and money in is read by the rest of the rules: what no rule recognises is
 * income and goes to the payee question, which pairs it with its payment when it is a refund (returns.ts).
 *
 * A rule of debt needs no such step: `categorize` already reads money in under it as credit drawn.
 *
 * This is the one way to categorize a row outside the rule table itself: the pipeline, a statement's rows and the row's
 * detail all call it, and repo rule 51 refuses a direct call of `categorize` anywhere else in the code.
 */
import { getCategory } from "./categories.ts";
import { type CategorizeInput, type CategorizeResult, categorize, type CompiledRule } from "./categorize.ts";
import type { Account } from "./types.ts";

const isSpending = (category: string): boolean => getCategory(category).kind === "expense";

/**
 * `categorize`, but a user's rule of spending is left out when the money comes in. When the rest of the rules then file
 * the money in under a category of spending too (a shop's refund the built-in rules know), the user's own result stays:
 * their category is where that refund belongs, and a different category of spending would move the cost.
 */
export function categorizeInDirection(input: CategorizeInput, rules: readonly CompiledRule[], accounts: readonly Account[] = []): CategorizeResult {
  const result = categorize(input, rules, accounts);
  if (!result.byUser || input.amountCents < 0 || !isSpending(result.category)) return result;
  // the rules that remain may still hold another rule of the user's, of an income category
  const rest = categorize(input, rules.filter((r) => !(r.byUser && isSpending(r.category))), accounts);
  return isSpending(rest.category) ? result : rest;
}

/** Core as the add-on modules receive it: the same names, with `categorize` reading a user's rule by its direction too. */
export function moduleApiOf<T extends { categorizeInDirection: unknown }>(api: T): T {
  return { ...api, categorize: api.categorizeInDirection };
}
