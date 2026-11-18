import type { FinanceRepo } from "./db/finance-repo.ts";
import type { ReferenceRatesRepo } from "./db/reference-rates-repo.ts";
import type { SettingsRepo } from "./db/settings-repo.ts";
import { addDays } from "@banking/core";
import { EURIBOR_REFERENCES, type FixingRow } from "./providers/reference-rates/client.ts";
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

/** The made-up level of each rate on its first day, in thousandths of a percent. */
const DEMO_FIXING_LEVEL = { euribor_3: 2000, euribor_6: 2150, euribor_12: 2300 } as const;
/** The days of fixings before today, a little over the 26 months of the longest demo. */
const DEMO_FIXING_DAYS = 800;

/**
 * Made-up fixings of the three euribor rates, one on each weekday up to yesterday: a slow wave round a level of the rate's
 * own. A demo, a picture and a test show these and never a published rate. Loaded only where the daily fetch is off
 * (`REFERENCE_RATES=false`), since a real install keeps the real fixings.
 */
export async function loadDemoFixings(rates: ReferenceRatesRepo, today: string): Promise<void> {
  const rows: FixingRow[] = [];
  for (let back = DEMO_FIXING_DAYS; back >= 1; back--) {
    const day = addDays(today, -back);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const reference of EURIBOR_REFERENCES) rows.push({ reference, day, rateMilli: DEMO_FIXING_LEVEL[reference] + Math.round(150 * Math.sin(back / 40)) });
  }
  await rates.upsert(rows);
}

/** The demo rows of the add-on module (extensions.ts) when one is loaded. */
export async function loadExtensionDemos(s: Services, userId: string, today: string): Promise<void> {
  for (const e of EXTENSIONS) if (e.demo) await e.demo(s, userId, today);
}
