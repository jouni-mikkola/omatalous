/**
 * Payer roles: what money from a steady payer is. One answer per payer (per member, with a household default) moves
 * every row of that payer, past and future. The run stores the result as the row's category (source `payer`), so every
 * sum reads one answer; `applyPayerRoles` is the one place a role acts, and `categoryUnderRole` the one table of what
 * a role does to a category.
 *
 * A payer is the row's IBAN when it has one, else the folded words of its counterparty. A row with neither has no payer.
 */
import { getCategory } from "./categories.ts";
import { nameOf, type Name, samePerson } from "./person-names.ts";
import { steadyBy, STEADY_BAND } from "./returns.ts";
import { normalizeIban } from "./transfers.ts";
import type { PayerInput, PayerRole, PayerRoleRow, Transaction } from "./types.ts";
import { hasPayeeForm } from "./wording.ts";

/** The roles in the order a page offers them. */
export const PAYER_ROLES = ["cost_share", "sales", "own_money", "gift", "pay"] as const satisfies readonly PayerRole[];

/** A household default can be any role but `own_money`: whose own money it is only a member can say. */
const DEFAULT_ROLES: readonly PayerRole[] = PAYER_ROLES.filter((r) => r !== "own_money");

type PayerRow = Pick<Transaction, "counterparty" | "counterpartyIban">;

/** The payer of a row: `iban:<IBAN>`, else `name:<distinct folded words of the counterparty, sorted>`; null when it has neither. */
export function payerKeyOf(t: PayerRow): string | null {
  const iban = normalizeIban(t.counterpartyIban);
  if (iban) return `iban:${iban}`;
  const words = [...nameOf(t.counterparty ?? "")].sort();
  return words.length ? `name:${words.join(" ")}` : null;
}

const nameOfKey = (key: string): Name => new Set(key.slice("name:".length).split(" "));

/** A word that is a company form ("Oy", "Ky") anywhere in the name: the words of a key are sorted, so not only at an end. */
const hasForm = (name: Name) => [...name].some((word) => hasPayeeForm(word));

/** The same words, or one person written two ways; never when either is a company ("Matti Meikalainen Kiinteistot Oy"). */
export function sameName(a: Name, b: Name): boolean {
  if (a.size === b.size && [...a].every((word) => b.has(word))) return true;
  return samePerson(a, b) && !hasForm(a) && !hasForm(b);
}

const CONFLICT = "conflict";

/** One scope's answer for a row: an IBAN answer first, then the name answers; two names that disagree leave none. */
function roleIn(rows: readonly PayerRoleRow[], t: PayerRow): PayerRole | typeof CONFLICT | null {
  const iban = normalizeIban(t.counterpartyIban);
  if (iban) {
    const hit = rows.find((r) => r.counterpartyKey === `iban:${iban}`);
    if (hit) return hit.role;
  }
  const name = nameOf(t.counterparty ?? "");
  if (!name.size) return null;
  const roles = new Set(rows.filter((r) => r.counterpartyKey.startsWith("name:") && sameName(nameOfKey(r.counterpartyKey), name)).map((r) => r.role));
  return roles.size > 1 ? CONFLICT : ([...roles][0] ?? null);
}

/**
 * The answer that reaches rows like `t` for one member: the member's own answer, else the household's default. Two
 * answers of the member that disagree about the row leave no role (and no fall to the default): the question stands.
 * The direction and the row's own category are not looked at here.
 */
function answeredRole(roles: readonly PayerRoleRow[], t: PayerRow, memberId: string): PayerRole | null {
  const own = roleIn(roles.filter((r) => r.scope === "member" && r.userId === memberId), t);
  if (own) return own === CONFLICT ? null : own;
  const shared = roleIn(roles.filter((r) => r.scope === "household" && DEFAULT_ROLES.includes(r.role)), t);
  return shared === CONFLICT ? null : shared;
}

type RoleRow = PayerRow & Pick<Transaction, "amountCents" | "categorySource">;

/** The resolver behind `payerRoleOf`, deciding each distinct payer once. */
function resolver(roles: readonly PayerRoleRow[], memberId: string): (t: RoleRow) => PayerRole | null {
  const memo = new Map<string, PayerRole | null>();
  return (t) => {
    // a category set by hand stays: no role for the row
    if (t.categorySource === "user" || t.amountCents <= 0) return null;
    const key = `${t.counterpartyIban ?? ""}\u0000${t.counterparty ?? ""}`;
    let role = memo.get(key);
    if (role === undefined) memo.set(key, (role = answeredRole(roles, t, memberId)));
    // a role acts on money in only: what is paid to the same counterparty is never moved by it
    return t.amountCents < 0 ? null : role;
  };
}

/**
 * The role that applies to a row in `memberId`'s view, or null. A row whose category the user set by hand has none, and
 * so has money out: a role acts on money in only.
 */
export const payerRoleOf = (roles: readonly PayerRoleRow[], t: RoleRow, memberId: string): PayerRole | null => resolver(roles, memberId)(t);

/** The category a row of `category` has under `role`: the one table of what a role does. Pay stays a benefit when it read as one. */
export function categoryUnderRole(role: PayerRole, category: string): string {
  switch (role) {
    case "pay":
      return category === "benefits" ? "benefits" : "salary";
    case "sales":
      return "sales";
    case "own_money":
      return "transfer";
    case "gift":
    case "cost_share":
      return "p2p_in";
  }
}

/** A sum more than the steady band from the payer's median: a payback or a gift among the shares, so no role guesses it. */
export const isOffMedian = (cents: number, typical: number): boolean => Math.abs(cents - typical) > Math.abs(typical) * STEADY_BAND;

/** A person's name: no company form in it. A row with no name says nothing and passes. */
export const isPersonName = (counterparty: string | null): boolean => !hasForm(nameOf(counterparty ?? ""));

/** A refund stays a refund under every role: a refund word's category, or money in on a spending category (not the person's own `p2p`). */
const isRefund = (t: Pick<Transaction, "category">): boolean => t.category === "reimbursements" || (t.category !== "p2p" && ["expense", "debt"].includes(getCategory(t.category).kind));

/** What pairing decided before the roles: a transfer leg, a return, a card bill. */
const DECIDED = new Set(["transfer", "match"]);

/**
 * Last step of the run, after the returns: each row of a payer with a role takes the role's category and the source
 * `payer`. In this order the first that applies decides: a category set by hand, the member's own rules, what pairing
 * decided (a transfer leg, a card bill, a return with both its rows), a refund, then the role. `locked`: the rows of the member's
 * own rules and both rows of every return. For a steady payer with `cost_share` or `gift`, a
 * row more than the band from the payer's median keeps today's reading. Changes `next` in place; no roles, no change.
 */
export function applyPayerRoles(next: readonly Transaction[], locked: ReadonlySet<string>, payers: PayerInput | undefined): void {
  if (!payers || !payers.roles.length) return;
  const roleOf = resolver(payers.roles, payers.memberId);
  const steady = steadyBy(next.filter((t) => t.amountCents > 0), payerKeyOf);
  for (const t of next) {
    if (locked.has(t.id) || DECIDED.has(t.categorySource) || t.isTransfer || t.category === "card_bill" || isRefund(t)) continue;
    const role = roleOf(t);
    if (!role) continue;
    if ((role === "cost_share" || role === "gift") && t.amountCents > 0) {
      const typical = steady.get(payerKeyOf(t) ?? "");
      if (typical !== undefined && isOffMedian(t.amountCents, typical)) continue;
    }
    Object.assign(t, { category: categoryUnderRole(role, t.category), categorySource: "payer", isTransfer: role === "own_money" });
  }
}
