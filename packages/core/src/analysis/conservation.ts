import { normalizeIban } from "../iban.ts";
import type { Account, Transaction } from "../types.ts";
import { type Flows, leftOf } from "./flows.ts";

/**
 * Conservation of a view's money: what the figures count must agree with what the accounts did. Pure, and used only by
 * the invariant tests so far (`test/invariants.generated.test.ts`).
 *
 * Decision: a month's Tulos is the change of the pool (`pool.ts`), so a household that reads Tulos can trust that no
 * row counted twice or not at all. Two kinds of row make the pool and Tulos differ by design, and each is its own named
 * line that the rows alone fix, never the engine's own verdict on them:
 * - `cards`: a purchase on a connected card lowers Tulos when it is made and the pool when its bill is paid, so the
 *   change of what the cards hold is a line of its own;
 * - `moved`: money between two daily accounts of the household (a joint account's top-up, a transfer between members)
 *   that no flow counts. One leg can be in the view and the other not, or cut to a member's part, so the pool changes
 *   by it and Tulos does not.
 * What is left, `residualCents`, is a cent that Tulos counted twice or not at all.
 */

/** Where an account sits against the pool: in it, a connected card, a loan account, or any other account outside it. */
export type Place = "pool" | "card" | "loan" | "outside";

export const placeOf = (account: Pick<Account, "id" | "type">, poolIds: ReadonlySet<string>): Place =>
  poolIds.has(account.id) ? "pool" : account.type === "credit_card" ? "card" : account.type === "loan" ? "loan" : "outside";

/** The lines between the pool's change and Tulos. */
export const BOUNDARY_NAMES = ["cards", "moved"] as const;
export type BoundaryName = (typeof BOUNDARY_NAMES)[number];

/** One named line: what it adds to the pool's change on the way to Tulos, and the rows it is made of. */
export interface BoundaryLine {
  cents: number;
  rowIds: string[];
}

/** What the engine counted on rows of an account outside the pool, to name a residual. */
export interface CountedLine {
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
  /** What the pool gained in the month: the booked rows on its accounts. */
  poolCents: number;
  /** The named lines, each with its rows. A row is in at most one. */
  lines: Record<BoundaryName, BoundaryLine>;
  /** `leftCents` less `poolCents` and the lines: zero when every cent is counted once. */
  residualCents: number;
  /** What the engine counted on rows outside the pool and the cards, largest first. */
  counted: CountedLine[];
}

type BridgeRow = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "counterpartyIban"> & { flows: Flows };

const COUNTED: readonly (keyof Flows)[] = ["consumption", "debt", "saved", "borrowed", "income"];
const COUNTS_NOTHING = (f: Flows) => COUNTED.every((k) => f[k] === 0);

/**
 * The bridge of each month that has rows, in order. A loan account's rows add nothing: they repeat a payment counted
 * where it left. `dailyIbans` are the household's checking accounts, those of the view and those it does not hold: a row
 * of the pool that names one of them as its counterparty is money moved between daily accounts.
 */
export function bridgeByMonth(rows: readonly BridgeRow[], accounts: readonly Pick<Account, "id" | "type">[], poolIds: ReadonlySet<string>, dailyIbans: ReadonlySet<string>): MonthBridge[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const months = new Map<string, MonthBridge & { counts: Map<string, CountedLine> }>();
  for (const t of rows) {
    const account = byId.get(t.accountId)!;
    const place = placeOf(account, poolIds);
    const month = t.bookingDate.slice(0, 7);
    let m = months.get(month);
    if (!m) {
      const empty = (): BoundaryLine => ({ cents: 0, rowIds: [] });
      months.set(month, (m = { month, rows: { pool: 0, card: 0, loan: 0, outside: 0 }, leftCents: 0, poolCents: 0, lines: { cards: empty(), moved: empty() }, residualCents: 0, counted: [], counts: new Map() }));
    }
    m.rows[place]++;
    m.leftCents += leftOf(t.flows);
    if (place === "pool") {
      m.poolCents += t.amountCents;
      const iban = normalizeIban(t.counterpartyIban);
      if (iban && dailyIbans.has(iban) && COUNTS_NOTHING(t.flows)) {
        // the pool lost or gained it and Tulos counts no such move, so the line takes it off
        m.lines.moved.cents -= t.amountCents;
        m.lines.moved.rowIds.push(t.id);
      }
    } else if (place === "card") {
      m.lines.cards.cents += t.amountCents;
      m.lines.cards.rowIds.push(t.id);
    }
    if (place !== "outside") continue;
    for (const flow of COUNTED) {
      if (!t.flows[flow]) continue;
      const key = `${account.type}:${flow}`;
      const line = m.counts.get(key) ?? { accountType: account.type, flow, cents: 0 };
      line.cents += t.flows[flow];
      m.counts.set(key, line);
    }
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ counts, ...m }) => ({ ...m, residualCents: m.leftCents - m.poolCents - m.lines.cards.cents - m.lines.moved.cents, counted: [...counts.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)) }));
}
