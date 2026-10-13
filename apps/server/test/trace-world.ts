/**
 * A household for the tests of the money trace: two members, the one with the lower id called Aino and the other Ville,
 * each with an own account, and a joint account one or both of them linked. Made-up names and sums only.
 */
import { type AccountType, type RawTransaction } from "@banking/core";
import { expect } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

export const IBAN = {
  aino: "FI1000000000000001",
  ville: "FI2000000000000002",
  pool: "FI3000000000000003",
  card: "FI4000000000000004",
  loan: "FI5000000000000005",
  cecilia: "FI6000000000000006",
};
export const AINO = "MEIKALAINEN AINO";
export const VILLE = "LAHTINEN VILLE";
export const KEY = "idn-pool";

/** A row of a pool: the day, the euros (signed), the counterparty and, where the bank names an account, its IBAN. */
export type R = [date: string, euros: number, counterparty: string, iban?: string];
export const raw = ([bookingDate, euros, counterparty, iban]: R): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: iban ?? null, description: null, reference: null, mcc: null,
});
export const fromAino = (date: string, euros: number): R => [date, euros, AINO, IBAN.aino];
export const fromVille = (date: string, euros: number): R => [date, euros, VILLE, IBAN.ville];
export const cents = (rows: readonly R[]) => rows.reduce((n, r) => n + Math.round(r[1] * 100), 0);

export interface Copy {
  by: "aino" | "ville";
  id: string;
  rows: R[];
}
export interface Options {
  copies: Copy[];
  /** What the account holds now, in cents. */
  balance: number;
  /** The bank's line of holders on the pool; null: none read. */
  holder?: string | null;
  now?: string;
  /** Aino's own account is shared with Ville. */
  share?: boolean;
  extra?: (w: Awaited<ReturnType<typeof people>>) => Promise<void>;
}

export async function link(app: Awaited<ReturnType<typeof setupApp>>, userId: string, id: string, holder: string | null, iban: string | null, identity: string | null, type: AccountType = "checking") {
  await app.s.finance(userId).upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity, name: id, holder, iban, currency: "EUR", type });
}

/** Two members, the one with the lower id called Aino and the other Ville, each with an own account. */
export async function people(clock: { at: Date }) {
  const app = await setupApp({}, undefined, { now: () => clock.at });
  const other = await app.member("ville", "Ville");
  const [aino, ville] = [app.adminId, other.id].sort() as [string, string];
  await link(app, aino, "aino-own", AINO, IBAN.aino, "idn-aino");
  await link(app, ville, "ville-own", VILLE, IBAN.ville, "idn-ville");
  /** The signed-in client of a member, to call the routes as them. */
  const as = (userId: string) => (userId === app.adminId ? app.admin : other);
  return { ...app, aino, ville, clock, as };
}
export type World = Awaited<ReturnType<typeof people>>;

export async function world(o: Options): Promise<World> {
  const clock = { at: new Date(`${o.now ?? "2026-10-09"}T10:00:00Z`) };
  const w = await people(clock);
  const holder = o.holder === undefined ? `${AINO}, ${VILLE}` : o.holder;
  for (const c of o.copies) {
    const owner = c.by === "aino" ? w.aino : w.ville;
    await link(w, owner, c.id, holder, IBAN.pool, KEY);
    await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [o.balance, c.id]);
    await ingestTransactions(w.s.finance(owner), c.id, c.rows.map(raw), "enablebanking");
  }
  if (o.share) expect(await w.s.household.share(w.aino, "aino-own", w.ville)).toBe(true);
  await o.extra?.(w);
  return w;
}

export const one = (rows: R[], opening: number, over: Partial<Options> = {}): Options => ({ copies: [{ by: "aino", id: "pool-a", rows }], balance: opening + cents(rows), ...over });
