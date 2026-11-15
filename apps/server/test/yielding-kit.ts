/** A user with a made-up history of booked rows, for the tests of long work (work: yielding.test.ts, time: yielding.perf.test.ts). */
import type { StoredTransaction } from "../src/db/rows.ts";
import type { setupApp } from "./helpers.ts";

export type Setup = Awaited<ReturnType<typeof setupApp>>;

export async function history(setup: Setup, count: number, accountId = "acc", userId = setup.adminId) {
  const repo = setup.s.finance(userId);
  await repo.upsertAccount({ id: accountId, connectionId: null, provider: "csv", externalId: null, identity: accountId, name: accountId, iban: null, currency: "EUR", type: "checking" });
  const rows: Omit<StoredTransaction, "userId">[] = Array.from({ length: count }, (_, i) => ({
    id: `${accountId === "acc" ? "" : `${accountId}-`}r${String(i).padStart(6, "0")}`,
    accountId,
    // a few dates only, so the id breaks most ties and page borders fall inside a day
    bookingDate: `2026-0${1 + (i % 9)}-0${1 + (i % 3)}`,
    valueDate: null,
    amountCents: -(100 + (i % 977)),
    currency: "EUR",
    status: "booked" as const,
    counterparty: null,
    counterpartyIban: null,
    description: i % 2 ? "K-MARKET KAMPPI" : `KAUPPA ${i % 300}`,
    reference: null,
    mcc: null,
    merchant: i % 2 ? "K-Market Kamppi" : `Kauppa ${i % 300}`,
    category: "other",
    categorySource: "default" as const,
    isTransfer: false,
    source: "test",
    raw: null,
  }));
  await repo.batch(repo.upsertStatements(rows, "2026-10-09T10:00:00Z"));
  return repo;
}
