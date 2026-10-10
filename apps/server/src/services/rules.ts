import type { FinanceRepo } from "../db/finance-repo.ts";
import { UserError } from "./errors.ts";

/** Every rule runs on every transaction at each reprocess; a few hundred is plenty. */
const MAX_RULES = 300;

export async function checkRuleRoom(repo: FinanceRepo): Promise<void> {
  if ((await repo.ruleCount()) >= MAX_RULES) throw new UserError(`Sääntöjä voi olla enintään ${MAX_RULES}.`);
}
