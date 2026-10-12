/**
 * Test code: what the CSV import route did, kept so tests can make rows of the kind old accounts hold (source
 * `csv`). Read a file, create the account or take the one given, and store the rows booked. Nothing under src/
 * imports it; the route is gone (csv-seed.ts is the way in). The rows go in through `ingestTransactions` as a
 * fetch does, which also replaces the pending rows an account holds: seed into an account without any.
 */
import type { AccountType } from "@banking/core";
import { csvImport } from "../src/connectors/csv-import/index.ts";
import { randomToken, stableId } from "../src/platform/ids.ts";
import type { Services } from "../src/services/context.ts";
import { reprocess } from "../src/services/enrich.ts";
import { startLookup } from "../src/services/industry.ts";
import { type IngestResult, ingestTransactions } from "../src/services/ingest.ts";
import { parseSeedCsv } from "./fixtures/nordea-csv.ts";

export interface CsvImportInput {
  content: string;
  /** An account of the user's to import into. Without it a new account is made. */
  accountId?: string;
  accountName?: string;
  accountType?: AccountType;
}

export interface CsvImportResult extends IngestResult {
  accountId: string;
  errors: string[];
}

export async function importCsv(s: Services, userId: string, input: CsvImportInput): Promise<CsvImportResult> {
  const repo = s.finance(userId);
  const parsed = parseSeedCsv(input.content);
  // rows dated in the future are typos or a wrong date format; they would also confuse the sync window
  const today = s.today();
  const future = parsed.transactions.filter((t) => t.bookingDate > today).length;
  const transactions = parsed.transactions.filter((t) => t.bookingDate <= today);
  const errors = future ? [future === 1 ? "Ohitettu 1 tulevaisuuteen päivätty rivi." : `Ohitettu ${future} tulevaisuuteen päivättyä riviä.`] : [];

  let accountId = input.accountId;
  // a new account changes what transfers can pair with, whatever the rows did
  let accountChanged = false;
  if (accountId) {
    if (!(await repo.getAccount(accountId))) throw new Error(`seed: no account ${accountId}`);
  } else {
    const name = input.accountName?.trim().slice(0, 80) || "Tuotu tili";
    // account ids derive from this exact text: it stays "csv" whatever the connector is called
    let identity = stableId(`${userId}|csv|${name}`);
    // an account imported under this name and renamed since keeps the id; the new one must not take it over
    if (await repo.getAccount(`csv-${identity}`)) identity = stableId(`${userId}|csv|${name}|${randomToken()}`);
    accountId = `csv-${identity}`;
    accountChanged = true;
    await repo.upsertAccount({
      id: accountId,
      connectionId: null,
      provider: csvImport.id,
      externalId: null,
      identity,
      name,
      iban: parsed.ownIban,
      currency: "EUR",
      type: input.accountType ?? "checking",
    });
  }
  const result = await ingestTransactions(repo, accountId, transactions, csvImport.id);
  // the same file again changes nothing: no processing, and nobody's cached analysis is dropped
  if (result.changed || accountChanged) await reprocess(repo, s.settings);
  if (result.inserted) startLookup(s);
  return { accountId, ...result, errors };
}
