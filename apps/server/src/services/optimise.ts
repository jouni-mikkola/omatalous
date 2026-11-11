/**
 * The numbers the user types in for the savings tips, and which of them the tips still wait for. The inputs are the
 * signed-in user's own in both scopes. They are read for each request like marks, so saving one moves no data version
 * and calls no reprocess.
 */
import { DEFAULT_LANGUAGE, type Language, buildOptimise, type InputValues, inputDefOf, type NeededInput, parseInputValue } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import { requestInputs, type Scope, type View } from "./analysis.ts";
import type { Services } from "./context.ts";

/** A household types in a handful of numbers; the cap only stops a script from filling the table. */
const MAX_INPUTS = 50;

/** Owners of the shared accounts in view: their register answers categorised those rows, as on the transactions list. */
const ownersOf = (userId: string, accounts: readonly { userId: string }[]) => [...new Set(accounts.map((a) => a.userId).filter((id) => id !== userId))];

/**
 * The rows the advice reads: every account whole in both views. A contract is the household's, and half an
 * electricity bill against a market price is wrong advice, so the own view reads the accounts the viewer uses with
 * their rows and balances as the bank has them.
 */
const viewOf = (scope: Scope): View => (scope === "own" ? "used" : scope);

/** The tips as they stand for the signed-in user, with the inputs and the decisions stored for them. */
async function compute(s: Services, userId: string, scope: Scope, lang: Language) {
  const repo = s.finance(userId);
  const { ctx, accounts } = await s.analysis.get(s, userId, viewOf(scope));
  const [{ balances, inputs }, inputRows, states, codes] = await Promise.all([requestInputs(s, userId, accounts), repo.listInputs(), repo.listStates(), repo.industryCodes(ownersOf(userId, accounts))]);
  const values: InputValues = Object.fromEntries(inputRows.map(({ key, value, asOf }) => [key, { value, asOf }]));
  // the user's own register answers, for the merchants in view; a lookup never happens here
  const merchants = new Set(ctx.txs.map((t) => t.merchant));
  const industry = new Map([...codes].filter(([merchant]) => merchants.has(merchant)).flatMap(([merchant, { code }]): [string, string][] => (code ? [[merchant, code]] : [])));
  return buildOptimise({ ctx, balances, inputs, values, states, industry, lang });
}

/**
 * The inputs Säästövinkit waits for, asked in Tarkistettavat: each with the money it is about, the largest mid of a
 * tip that a value would make exact, 0 when only a check waits for it. Saving one never reprocesses (`setInput`).
 */
export async function neededInputs(s: Services, userId: string, lang: Language = DEFAULT_LANGUAGE): Promise<(NeededInput & { cents: number })[]> {
  const data = await compute(s, userId, "own", lang);
  const mids = new Map<string, number>();
  for (const f of data.areas.flatMap((a) => a.findings)) for (const key of f.needs ?? []) mids.set(key, Math.max(mids.get(key) ?? 0, f.euros?.midCents ?? 0));
  return data.needed.map((n) => ({ ...n, cents: mids.get(n.key) ?? 0 }));
}

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
