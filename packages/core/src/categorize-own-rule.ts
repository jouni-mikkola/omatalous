/** Which of the user's own rules gave a row its category, for the row's detail. */
import type { CategorizeInput, CompiledRule } from "./categorize.ts";
import { categorizeInDirection } from "./categorize-direction.ts";

/**
 * The user's own rule that gave a row its category: the first of their rules (compiled with `compileRules`) that takes
 * the row, when it gives the category the row has. The user's rules run before every built-in one, so that rule decided.
 * null when none takes the row or the category came from a later step. `categorizeInDirection` does the matching, as the
 * pipeline does, so a rule of spending that the pipeline passed by for money in is passed by here too; the rules are
 * tried one by one only for a row that one of them took.
 */
export function ownRuleOf(input: CategorizeInput, category: string, ownRules: readonly CompiledRule[]): CompiledRule | null {
  const own = ownRules.filter((r) => r.byUser);
  const all = categorizeInDirection(input, own);
  if (!all.byUser || all.category !== category) return null;
  return own.find((r) => categorizeInDirection(input, [r]).byUser) ?? null;
}
