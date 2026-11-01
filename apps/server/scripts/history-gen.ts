/**
 * Made-up rows for the performance budgets: five years of a household, at least 100 000 rows. The demo data's
 * backbone (salary, rent, bills, subscriptions, a card and its bill) plus a deterministic filler of everyday purchases
 * from a few hundred merchants, with the bank's own ids. Nothing is stored in the repo: tests and
 * `pnpm seed:years` build it on the spot.
 */
import { addDays } from "@banking/core";
import type { FinanceRepo } from "../src/db/finance-repo.ts";
import type { SettingsRepo } from "../src/db/settings-repo.ts";
import { type DemoAccount, generateDemoData } from "../src/demo-data.ts";
import { stableId } from "../src/platform/ids.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";

export const YEARS = 5;
export const MIN_ROWS = 100_000;

/** A few filler rows land on a twin of another row and are not stored; the spare keeps the stored count over `rows`. */
const SPARE = 200;

const CHAINS = ["K-MARKET", "S-MARKET", "LIDL", "PRISMA", "ALEPA", "R-KIOSKI", "WOLT", "SUSHI", "HESBURGER", "STOCKMANN", "CLAS OHLSON", "VERKKOKAUPPA.COM", "FINNAIR", "VR", "HSL", "NESTE", "ABC", "APTEEKKI", "SOK", "TOKMANNI"];
const PLACES = ["HELSINKI", "ESPOO", "VANTAA", "TAMPERE", "TURKU", "OULU"];

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The household of the demo for `years` years, topped up with everyday purchases to at least `rows` rows in all. */
export function historyAccounts(today: string, rows = MIN_ROWS, years = YEARS): DemoAccount[] {
  const accounts = generateDemoData(today, years * 12);
  const have = accounts.reduce((n, a) => n + a.transactions.length, 0);
  const rand = rng(7);
  const days = years * 365;
  const buyers = accounts.filter((a) => a.type === "checking" || a.type === "credit_card");
  const stop = addDays(today, -2);
  for (let i = 0; i < rows - have + SPARE; i++) {
    const a = buyers[i % buyers.length]!;
    const day = addDays(stop, -Math.floor(rand() * days));
    const chain = CHAINS[Math.floor(rand() * CHAINS.length)]!;
    const shop = rand() < 0.5 ? `${chain} ${PLACES[Math.floor(rand() * PLACES.length)]}` : `${chain} ${1 + Math.floor(rand() * 40)}`;
    a.transactions.push({
      externalId: `fill-${a.id}-${i}`,
      bookingDate: day,
      valueDate: day,
      amountCents: -Math.round((1 + rand() * rand() * 180) * 100),
      currency: "EUR",
      status: "booked",
      counterparty: shop,
      counterpartyIban: null,
      description: null,
      reference: null,
      mcc: null,
    });
  }
  return accounts;
}

/** Stores the accounts and their rows for the user, as a sync would, and processes them. Returns the row count. */
export async function loadHistory(repo: FinanceRepo, settings: SettingsRepo, accounts: readonly DemoAccount[]): Promise<number> {
  let stored = 0;
  for (const a of accounts) {
    const identity = stableId(`${repo.userId}|${a.id}`);
    const id = `hist-${identity}`;
    await repo.upsertAccount({ id, connectionId: null, provider: "demo", externalId: null, identity, name: a.name, iban: a.iban, ...(a.cardMask ? { cardMask: a.cardMask } : {}), currency: "EUR", type: a.type });
    stored += (await ingestTransactions(repo, id, a.transactions, "demo")).inserted;
    if (a.balanceCents !== null) await repo.setAccountBalance(id, a.balanceCents, new Date().toISOString());
  }
  await reprocess(repo, settings);
  return stored;
}
