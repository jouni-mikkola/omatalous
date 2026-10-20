import type { FinanceRepo } from "./db/finance-repo.ts";
import type { SettingsRepo } from "./db/settings-repo.ts";
import { addDays } from "@banking/core";
import { type DemoAccount, generateDemoData } from "./demo-data.ts";
import { accountKey } from "./db/household-repo.ts";
import { reprocess } from "./services/enrich.ts";
import { stableId } from "./platform/ids.ts";
import { ingestTransactions } from "./services/ingest.ts";
import { EXTENSIONS } from "./extensions.ts";
import type { Services } from "./services/context.ts";

/**
 * What the bank would have sent for the account: for a checking account the booked balance at the end of every day
 * from the day before its first row, fetched the day after (so it proves); for the savings account only the available
 * balance of today (so it never does).
 */
function demoBalances(a: DemoAccount, today: string) {
  if (a.reading === "ITAV") return a.balanceCents === null ? [] : [{ day: today, type: "ITAV", referenceDay: today, cents: a.balanceCents, fetchedAt: `${today}T05:00:00.000Z` }];
  if (a.reading !== "CLBD") return [];
  const booked = a.transactions.filter((t) => t.status === "booked");
  if (!booked.length) return [];
  const sums = new Map<string, number>();
  for (const t of booked) sums.set(t.bookingDate, (sums.get(t.bookingDate) ?? 0) + t.amountCents);
  const first = booked.reduce((day, t) => (t.bookingDate < day ? t.bookingDate : day), booked[0]!.bookingDate);
  const out: { day: string; type: string; referenceDay: string; cents: number; fetchedAt: string }[] = [];
  let cents = a.openingCents;
  for (let ref = addDays(first, -1); ref < today; ref = addDays(ref, 1)) {
    cents += sums.get(ref) ?? 0;
    const day = addDays(ref, 1);
    out.push({ day, type: "CLBD", referenceDay: ref, cents, fetchedAt: `${day}T05:00:00.000Z` });
  }
  return out;
}

/** The histories a demo can have: the usual 14 months, or 26 for a picture of a household with a whole year before this one. */
export const DEMO_MONTHS = [14, 26] as const;

/** Replaces the user's previous demo data with a fresh set ending today. */
export async function loadDemoData(repo: FinanceRepo, settings: SettingsRepo, today: string, months: (typeof DEMO_MONTHS)[number] = 14): Promise<{ accounts: number; transactions: number }> {
  await repo.deleteProviderData("demo");
  let transactions = 0;
  const accounts = generateDemoData(today, months);
  for (const a of accounts) {
    // ids are per user, so several members can load demo data side by side
    const identity = stableId(`${repo.userId}|${a.id}`);
    const id = `demo-${identity}`;
    await repo.upsertAccount({
      id,
      connectionId: null,
      provider: "demo",
      externalId: null,
      identity,
      name: a.name,
      iban: a.iban,
      ...(a.cardMask ? { cardMask: a.cardMask } : {}),
      currency: "EUR",
      type: a.type,
    });
    const r = await ingestTransactions(repo, id, a.transactions, "demo");
    await repo.replaceDemoBalances(accountKey({ id, identity }), demoBalances(a, today));
    if (a.balanceCents !== null) await repo.setAccountBalance(id, a.balanceCents, new Date().toISOString());
    transactions += r.inserted;
  }
  await reprocess(repo, settings);
  return { accounts: accounts.length, transactions };
}

/** The demo rows of the build's extensions (extensions.ts), each while its flag is on; the shared build has none. */
export async function loadExtensionDemos(s: Services, userId: string, today: string): Promise<void> {
  for (const e of EXTENSIONS) if (e.demo && s.instance.enabled(e.id)) await e.demo(s, userId, today);
}
