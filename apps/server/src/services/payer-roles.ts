/**
 * What money from a payer is, said by a member on the first page. An answer is the member's own: it moves the rows that
 * member sees (their own accounts and the shared or joint ones visible to them), in their own view, and no other member's.
 * Every answer, change and restore reprocesses that member, so the past months move with it. Rows of the household scope
 * are read by core but never written here.
 */
import { PAYER_ROLES, type PayerRole, payerKeyOf } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";

/** `iban:<IBAN>` or `name:<folded words>`, as core `payerKeyOf` writes them. */
const PAYER_KEY = /^(iban:[A-Z0-9]{5,34}|name:[^\p{Cc}]{1,200})$/u;

interface PayerAnswer {
  key: string;
  /** Null takes the member's own answer back: the payer is proposed again. */
  role: PayerRole | null;
}

/** Refuses a key that is not a payer's and a role that is not one of the five. */
export function parsePayerAnswer(value: { key: unknown; role: unknown }): PayerAnswer {
  const { key, role } = value;
  if (typeof key !== "string" || !PAYER_KEY.test(key)) throw new UserError("Virheellinen maksaja.");
  if (role !== null && !(PAYER_ROLES as readonly unknown[]).includes(role)) throw new UserError("Virheellinen vastaus.");
  return { key, role: role as PayerRole | null };
}

/** Sets, changes or takes back the member's own answer, then moves that member's rows. */
export async function answerPayer(s: Services, userId: string, answer: PayerAnswer): Promise<void> {
  const repo = s.finance(userId);
  if (answer.role === null) {
    // the member's own answer row goes whether or not rows of the payer remain: it is the only way out of a stuck answer
    await repo.clearPayerRole(answer.key);
  } else {
    // a payer the member's own rows have: a key from nowhere is stored under nothing
    const { ctx } = await s.analysis.get(s, userId, "own");
    if (!ctx.txs.some((t) => t.amountCents > 0 && payerKeyOf(t) === answer.key)) throw new UserError("Maksajaa ei löydy.");
    await repo.setPayerRole(answer.key, answer.role, s.now().toISOString());
  }
  await reprocess(repo, s.settings);
}
