import { normalizeIban } from "../iban.ts";
import type { Account, Transaction } from "../types.ts";
import { type Flows, leftOf } from "./flows.ts";

/**
 * Conservation of a view's money: what the figures count must agree with what the accounts did. Pure, and used only by
 * the invariant tests so far (`test/invariants.generated.test.ts`).
 *
 * Decision: a month's Tulos is the change of the pool (`pool.ts`) and of the connected cards in that month, so a
 * household that reads Tulos can trust that no row counted twice or not at all. A month where the two differ names the
 * line that crossed the pool's boundary: money that left for good from an account outside the pool, and the money
 * that moved between members.
 */

/** Where an account sits against the pool: in it, a connected card, a loan account, or any other account outside it. */
export type Place = "pool" | "card" | "loan" | "outside";

export const placeOf = (account: Pick<Account, "id" | "type">, poolIds: ReadonlySet<string>): Place =>
  poolIds.has(account.id) ? "pool" : account.type === "credit_card" ? "card" : account.type === "loan" ? "loan" : "outside";

/** What the engine counted on rows of an account outside the pool: one line across the boundary. */
export interface BoundaryLine {
  accountType: Account["type"];
  flow: keyof Flows;
  cents: number;
}

export interface MonthBridge {
  /** `YYYY-MM`. */
  month: string;
  /** The rows of the month by their place: each row is in exactly one. */
  rows: Record<Place, number>;
  /** Tulos as the rows' flows add up. */
  leftCents: number;
  /** What the pool and the connected cards gained in the month, from the rows alone. */
  gainCents: number;
  /**
   * The part of `gainCents` that moved between the household's own daily accounts and no flow counted: what a member's
   * share of a joint account cuts from a leg, what a bank kept on the way, and money from or to a member outside the view.
   */
  betweenMembersCents: number;
  /** `leftCents` less what the accounts gained from the world outside the household: zero when every cent is counted once. */
  residualCents: number;
  /** What the engine counted on rows outside the pool and the cards, largest first. */
  boundary: BoundaryLine[];
}

type BridgeRow = Pick<Transaction, "accountId" | "bookingDate" | "amountCents" | "counterpartyIban"> & { flows: Flows };

const COUNTED: readonly (keyof Flows)[] = ["consumption", "debt", "saved", "borrowed", "income"];
const ZERO = (f: Flows) => COUNTED.every((k) => f[k] === 0);

/**
 * The bridge of each month that has rows, in order. A loan account's rows add nothing: they repeat a payment counted
 * where it left. `dailyIbans` are the household's checking accounts, those of the view and those it does not hold: a row
 * to or from one of them that no flow counted is money moved between members, and is its own line.
 */
export function bridgeByMonth(rows: readonly BridgeRow[], accounts: readonly Pick<Account, "id" | "type">[], poolIds: ReadonlySet<string>, dailyIbans: ReadonlySet<string>): MonthBridge[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const months = new Map<string, MonthBridge & { lines: Map<string, BoundaryLine> }>();
  for (const t of rows) {
    const account = byId.get(t.accountId)!;
    const place = placeOf(account, poolIds);
    const month = t.bookingDate.slice(0, 7);
    let m = months.get(month);
    if (!m) months.set(month, (m = { month, rows: { pool: 0, card: 0, loan: 0, outside: 0 }, leftCents: 0, gainCents: 0, betweenMembersCents: 0, residualCents: 0, boundary: [], lines: new Map() }));
    m.rows[place]++;
    m.leftCents += leftOf(t.flows);
    if (place === "pool" || place === "card") {
      m.gainCents += t.amountCents;
      const iban = normalizeIban(t.counterpartyIban);
      if (iban && dailyIbans.has(iban) && ZERO(t.flows)) m.betweenMembersCents += t.amountCents;
    }
    if (place !== "outside") continue;
    for (const flow of COUNTED) {
      if (!t.flows[flow]) continue;
      const key = `${account.type}:${flow}`;
      const line = m.lines.get(key) ?? { accountType: account.type, flow, cents: 0 };
      line.cents += t.flows[flow];
      m.lines.set(key, line);
    }
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ lines, ...m }) => ({ ...m, residualCents: m.leftCents - (m.gainCents - m.betweenMembersCents), boundary: [...lines.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)) }));
}

/**
 * The rows whose other end is a checking or savings account of the household but that count as income, spending or
 * debt: money moved between members that no member earned or spent. A leg that paired is neutral and is not in the
 * list. The household answers these with the payer question.
 */
export function unpairedMemberLegs(rows: readonly (Pick<Transaction, "id" | "counterpartyIban"> & { flows: Flows })[], householdIbans: ReadonlySet<string>): string[] {
  return rows.filter((t) => {
    const iban = normalizeIban(t.counterpartyIban);
    return iban !== null && householdIbans.has(iban) && (t.flows.income !== 0 || t.flows.consumption !== 0 || t.flows.debt !== 0);
  }).map((t) => t.id);
}
