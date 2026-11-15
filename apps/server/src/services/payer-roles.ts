/**
 * What money from a payer is, said by a member on the first page. An answer is the member's own: it moves the rows that
 * member sees (their own accounts and the shared or joint ones visible to them), in their own view, and no other member's.
 * Every answer, change and restore reprocesses that member, so the past months move with it. Rows of the household scope
 * are read by core but never written here.
 */
import { isPersonName, PAYER_ROLES, type PayerRole, payerKeyOf, payerRoleOf } from "@banking/core";
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

/** One answer of the member's, as the list of standing answers shows it. */
interface PayerAnswerItem {
  key: string;
  /** The payer as its rows write it. */
  name: string;
  role: PayerRole;
  /** The answers offered for this payer: own money only for a person. */
  options: readonly PayerRole[];
  /** The payments the answer moved: rows of the payer the run read as it said. */
  count: number;
}

/** The member's own answers, largest first. A household row is never listed: it is not the member's to change. */
export async function payerAnswers(s: Services, userId: string): Promise<PayerAnswerItem[]> {
  const own = (await s.finance(userId).payerRoles()).filter((r) => r.scope === "member" && r.userId === userId);
  if (!own.length) return [];
  const { ctx } = await s.analysis.get(s, userId, "own");
  const items = own.map((answer): PayerAnswerItem => {
    const reached = ctx.txs.filter((t) => payerRoleOf([answer], t, userId) !== null);
    const written = (reached.find((t) => payerKeyOf(t) === answer.counterpartyKey) ?? reached[0])?.counterparty;
    const name = written || answer.counterpartyKey.slice(answer.counterpartyKey.indexOf(":") + 1);
    return {
      key: answer.counterpartyKey,
      name,
      role: answer.role,
      options: isPersonName(name) ? PAYER_ROLES : PAYER_ROLES.filter((r) => r !== "own_money"),
      count: reached.filter((t) => t.categorySource === "payer").length,
    };
  });
  return items.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
