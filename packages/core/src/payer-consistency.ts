/**
 * One payer, one reading of the money that comes in.
 *
 * Decision: the household reads its income by payer. A payer whose rows split between a group of their own and
 * unrecognised income (one message says "Siirto-maksu", the next a free sentence) tells the household two stories
 * about the same person, so the unrecognised rows take the category the payer's recognised rows share.
 */
import { referenceOf } from "./card-channel.ts";
import { getCategory } from "./categories.ts";
import { nameOf } from "./person-names.ts";
import type { Transaction } from "./types.ts";

/** The payer's name with its words in one order, so "MEIKALAINEN MAIJA" and "Maija Meikäläinen" are one payer. Null: no name of at least two words, which is no person. */
function payerKey(t: Transaction): string | null {
  const words = [...nameOf(t.counterparty ?? "")];
  return words.length >= 2 ? words.sort().join(" ") : null;
}

/**
 * Money in that no rule recognised (`income` by default, no reference) takes the category most of the same payer's
 * rows were given by a rule, when more than half of those say it. `locked` rows (the user's own rules, a payment and
 * its return) stay as they are. The caller runs it after the rules and the transfer pairing, so a transfer leg is never
 * a row here.
 */
export function applyPayerConsistency(next: readonly Transaction[], locked: ReadonlySet<string>): void {
  const decided = new Map<string, Map<string, number>>();
  for (const t of next) {
    const key = t.amountCents > 0 && t.categorySource === "rule" && !t.isTransfer && getCategory(t.category).kind === "income" ? payerKey(t) : null;
    if (!key) continue;
    const counts = decided.get(key) ?? new Map<string, number>();
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    decided.set(key, counts);
  }
  const winner = new Map<string, string>();
  for (const [key, counts] of decided) {
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    if (top[1] * 2 > total) winner.set(key, top[0]);
  }
  for (const t of next) {
    if (t.amountCents <= 0 || t.categorySource !== "default" || t.category !== "income" || t.isTransfer || locked.has(t.id) || referenceOf(t) !== "") continue;
    const key = payerKey(t);
    const category = key ? winner.get(key) : undefined;
    if (category && category !== t.category) Object.assign(t, { category, categorySource: "merchant" });
  }
}
