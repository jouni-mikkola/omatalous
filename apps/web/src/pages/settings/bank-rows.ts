/**
 * The rows of Pankkiyhteydet: one per bank. A household thinks in banks, and a bank that gives one consent per account
 * would else fill the list with rows that say the same thing.
 */
import { bankKey } from "../../banks.ts";
import type { Account, BankOption, Connection } from "../../types.ts";

export interface BankRow {
  /** The bank's id, or its name for a bank that has none. */
  key: string;
  /** The consent that speaks for the bank: its name, its end day and its reminder. */
  lead: Connection;
  /** Every listed consent of the bank, in the order the server sent them. */
  consents: Connection[];
}

/** Whether an ended consent asks for a renewal (no newer consent of its bank took its place). */
const asksRenewal = (c: Connection) => c.needsRenewal && !c.replaced;

/**
 * The consent a bank's row reads its state from: the active one that ends first (one with no end day last), so the
 * day on the row is the day the first account stops; with none active the one that asks for a renewal, else the first.
 */
function leadOf(consents: readonly Connection[]): Connection {
  const active = consents.filter((c) => c.state === "active");
  const first = active.reduce<Connection | null>((best, c) => (best === null || (c.validUntil !== null && (best.validUntil === null || c.validUntil < best.validUntil)) ? c : best), null);
  return first ?? consents.find(asksRenewal) ?? consents[0]!;
}

/** The consents by bank, a bank standing where its first consent stood. */
export function bankRows(connections: readonly Connection[], banks: readonly BankOption[]): BankRow[] {
  const byKey = new Map<string, Connection[]>();
  for (const c of connections) {
    const key = bankKey(c.institution, banks);
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  return [...byKey].map(([key, consents]) => ({ key, lead: leadOf(consents), consents }));
}

/** The consent whose accounts were fetched last, which the bank's Päivitetty reads; before any fetch the lead. */
export function lastFetched(row: BankRow, accounts: readonly Pick<Account, "connectionId" | "lastSyncedAt">[]): Connection {
  let newest: { consent: Connection; at: string } | null = null;
  for (const consent of row.consents) {
    for (const a of accounts) {
      if (a.connectionId === consent.id && a.lastSyncedAt && (!newest || a.lastSyncedAt > newest.at)) newest = { consent, at: a.lastSyncedAt };
    }
  }
  return newest?.consent ?? row.lead;
}
