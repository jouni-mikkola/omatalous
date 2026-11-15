import type { RawTransaction } from "../../../packages/core/src/types.ts";
import { KIT_TODAY, kitHousehold } from "../../../packages/core/test/kit/index.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import type { setupApp } from "./helpers.ts";

/** The kit's rows go in through the same ingest the importers use, the way `loadDemoData` puts the demo in. */
export async function loadKit(app: Awaited<ReturnType<typeof setupApp>>) {
  const h = kitHousehold(null);
  const repo = app.s.finance(app.adminId);
  for (const a of h.accounts) {
    await repo.upsertAccount({ id: a.id, connectionId: null, provider: "csv", externalId: null, identity: null, name: a.name, iban: a.iban, currency: a.currency, type: a.type });
    const rows = h.txs.filter((t) => t.accountId === a.id).map(
      (t): RawTransaction => ({
        externalId: null, bookingDate: t.bookingDate, valueDate: null, amountCents: t.amountCents, currency: t.currency, status: t.status,
        counterparty: t.counterparty, counterpartyIban: t.counterpartyIban, description: t.description, reference: t.reference ?? null, mcc: t.mcc,
        bankTxnCode: t.bankTxnCode ?? null,
      }),
    );
    await ingestTransactions(repo, a.id, rows, "csv");
    const balance = h.balances.find((b) => b.id === a.id)?.balanceCents;
    if (balance !== null && balance !== undefined) await repo.setAccountBalance(a.id, balance, `${KIT_TODAY}T08:00:00.000Z`);
  }
  await reprocess(repo, app.s.settings);
}
