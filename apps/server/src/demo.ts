import type { FinanceRepo } from "./db/finance-repo.ts";
import type { SettingsRepo } from "./db/settings-repo.ts";
import { generateDemoData } from "./demo-data.ts";
import { reprocess } from "./services/enrich.ts";
import { stableId } from "./platform/ids.ts";
import { ingestTransactions } from "./services/ingest.ts";

/** Replaces the user's previous demo data with a fresh set ending today. */
export async function loadDemoData(repo: FinanceRepo, settings: SettingsRepo, today: string): Promise<{ accounts: number; transactions: number }> {
  await repo.deleteProviderData("demo");
  let transactions = 0;
  const accounts = generateDemoData(today);
  for (const a of accounts) {
    // ids are per user, so several members can load demo data side by side
    const id = `demo-${stableId(`${repo.userId}|${a.id}`)}`;
    await repo.upsertAccount({
      id,
      connectionId: null,
      provider: "demo",
      externalId: null,
      identity: stableId(`${repo.userId}|${a.id}`),
      name: a.name,
      iban: a.iban,
      currency: "EUR",
      type: a.type,
    });
    const r = await ingestTransactions(repo, id, a.transactions, "demo", { replacePending: true });
    if (a.balanceCents !== null) await repo.setAccountBalance(id, a.balanceCents, new Date().toISOString());
    transactions += r.inserted;
  }
  await reprocess(repo, settings);
  return { accounts: accounts.length, transactions };
}
