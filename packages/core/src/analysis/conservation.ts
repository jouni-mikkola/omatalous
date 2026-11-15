import { billCents } from "../account-use.ts";
import { normalizeIban } from "../iban.ts";
import type { Account, Transaction } from "../types.ts";
import { type Flows, leftOf } from "./flows.ts";

/**
 * Conservation of a view's money: what the figures count must agree with what the accounts did. Pure, and used only by
 * the invariant tests so far (`test/invariants.generated.test.ts`).
 *
 * Decision: a month's Tulos is the change of the pool (`pool.ts`), so a household that reads Tulos can trust that no
 * row counted twice or not at all. Two kinds of row make the pool and Tulos differ by design, and each is its own named
 * line that the rows alone fix, never the engine's own verdict on them (what the flows count of a row is the result
 * under test, so no line reads it):
 * - `cards`: a purchase on a connected card lowers Tulos when it is made and the pool when its bill is paid, so the
 *   change of what the cards hold is a line of its own;
 * - `moved`: a transfer between two daily accounts of the household, any member's, where at least one leg is on an
 *   account of the view's pool. It is never income or spending in any view, a member's top-up of a joint account
 *   included, and the rows alone decide it, never the engine's own reading. Each leg names the other's IBAN. Two legs of one day that name each other, one in and one out, are matched, and the
 *   line takes the matched amount: the smaller of the bank's two amounts, at the part the view counts of each leg. A fee
 *   or any other difference between the legs is not matched and stays in the residual. A leg whose other account is
 *   not in the view has nothing to match: the pool changes by all of it and so does the line. A leg whose other account
 *   is in the view but whose other leg is not there stays in the residual.
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

type BridgeRow = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "counterpartyIban"> & Partial<Pick<Transaction, "wholeCents">> & { flows: Flows };
type BridgeAccount = Pick<Account, "id" | "type" | "iban">;

const byId = (x: Pick<BridgeRow, "id">, y: Pick<BridgeRow, "id">): number => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

const COUNTED: readonly (keyof Flows)[] = ["consumption", "debt", "saved", "borrowed", "income"];

/**
 * What of each pool row is money moved between daily accounts, by row id, from the rows and the accounts alone. A row
 * is a leg when its counterparty is a daily account of the household. Two legs of one day match when each names the
 * other's account, one is in and one out; the pair is moved by the smaller of the bank's two amounts. A row cut to a
 * part keeps its share of that amount, so a joint account's top-up cut to a member's part is moved in full.
 *
 * Pairing is by the closest amount, then by row id, and the legs are visited in row id order, so the result does not
 * depend on the order of the rows. With a fee on both legs and a tie, the rows alone cannot tell which legs belong
 * together (legs of -105/+100 and -95/+95 on one day pair either way), and a wrong pairing leaves a false residual of the
 * difference. The generated households have one fee on one pair, where no tie arises.
 */
function movedPieces(rows: readonly BridgeRow[], accounts: readonly BridgeAccount[], poolIds: ReadonlySet<string>, dailyIbans: ReadonlySet<string>): Map<string, number> {
  const ibanOf = new Map(accounts.map((a) => [a.id, normalizeIban(a.iban)]));
  const inView = new Set([...ibanOf.values()].filter((i): i is string => i !== null));
  const legs = rows.filter((t) => {
    const other = normalizeIban(t.counterpartyIban);
    return poolIds.has(t.accountId) && other !== null && dailyIbans.has(other);
  });
  legs.sort(byId);
  const byDay = new Map<string, BridgeRow[]>();
  for (const t of legs) (byDay.get(t.bookingDate) ?? byDay.set(t.bookingDate, []).get(t.bookingDate)!).push(t);
  const whole = (t: BridgeRow) => Math.abs(billCents({ amountCents: t.amountCents, wholeCents: t.wholeCents }));
  const share = (t: BridgeRow, cents: number) => (whole(t) === 0 ? 0 : Math.round((t.amountCents * cents) / whole(t)));
  const pieces = new Map<string, number>();
  const matched = new Set<string>();
  for (const a of legs) {
    if (matched.has(a.id)) continue;
    const mine = ibanOf.get(a.accountId) ?? null;
    const theirs = normalizeIban(a.counterpartyIban)!;
    const mates = (byDay.get(a.bookingDate) ?? []).filter((b) => !matched.has(b.id) && b !== a && Math.sign(b.amountCents) === -Math.sign(a.amountCents) && mine !== null && ibanOf.get(b.accountId) === theirs && normalizeIban(b.counterpartyIban) === mine);
    const b = mates.sort((x, y) => Math.abs(whole(x) - whole(a)) - Math.abs(whole(y) - whole(a)) || byId(x, y))[0];
    if (b) {
      const cents = Math.min(whole(a), whole(b));
      matched.add(a.id).add(b.id);
      pieces.set(a.id, share(a, cents));
      pieces.set(b.id, share(b, cents));
    } else if (!inView.has(theirs)) pieces.set(a.id, a.amountCents);
  }
  return pieces;
}

/**
 * The bridge of each month that has rows, in order. A loan account's rows add nothing: they repeat a payment counted
 * where it left. `dailyIbans` are the household's checking accounts, those of the view and those it does not hold: a row
 * of the pool that names one of them as its counterparty is a leg of money moved between daily accounts (`movedPieces`).
 */
export function bridgeByMonth(rows: readonly BridgeRow[], accounts: readonly BridgeAccount[], poolIds: ReadonlySet<string>, dailyIbans: ReadonlySet<string>): MonthBridge[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const pieces = movedPieces(rows, accounts, poolIds, dailyIbans);
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
      const piece = pieces.get(t.id);
      if (piece) {
        // the pool lost or gained it and Tulos counts no such move, so the line takes it off
        m.lines.moved.cents -= piece;
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
