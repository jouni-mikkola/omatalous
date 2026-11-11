/**
 * The numbers the user typed in for the savings tips. No view reads them now, so no question asks for one; a stored
 * one stays, and the two routes still save and delete it. The inputs are the signed-in user's own in both scopes, and
 * saving one moves no data version and calls no reprocess.
 */
import { type Language, inputDefOf, parseInputValue } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import type { Scope, View } from "./analysis.ts";
import type { Services } from "./context.ts";

/** A household types in a handful of numbers; the cap only stops a script from filling the table. */
const MAX_INPUTS = 50;

/**
 * The rows a quote's subject is looked up in: every account whole in both views, so the own view reads the accounts
 * the viewer uses with their rows as the bank has them.
 */
const viewOf = (scope: Scope): View => (scope === "own" ? "used" : scope);

/** One value per key; a later one replaces the earlier and takes today's date. */
export async function setInput(s: Services, userId: string, scope: Scope, key: string, value: unknown, lang: Language) {
  const found = inputDefOf(key);
  if (!found) throw new UserError("Tuntematon tieto.");
  const parsed = parseInputValue(found.def, value, s.today(), lang);
  if (!parsed.ok) throw new UserError(parsed.error);
  if (found.subject !== null) {
    // a quote belongs to a subscription or bill the history has found, in the scope the page is showing
    const { ctx } = await s.analysis.get(s, userId, viewOf(scope));
    if (!ctx.recurring.some((r) => r.id === found.subject)) throw new UserError("Vakuutusta ei löydy tiedoistasi.");
  }
  const repo = s.finance(userId);
  const current = await repo.listInputs();
  if (current.length >= MAX_INPUTS && !current.some((i) => i.key === key)) throw new UserError(`Tietoja voi olla enintään ${MAX_INPUTS}. Poista ensin turhat.`);
  await repo.setInput(key, parsed.value, s.today());
  return { inputs: await repo.listInputs() };
}

/** Taking away what is not there is not an error. */
export async function deleteInput(s: Services, userId: string, key: string) {
  if (!inputDefOf(key)) throw new UserError("Tuntematon tieto.");
  const repo = s.finance(userId);
  await repo.deleteInput(key);
  return { inputs: await repo.listInputs() };
}
