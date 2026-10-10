/**
 * Importing a CSV file the user uploaded: parse it, find or create the account and store the rows. The file
 * is parsed by the parser in core that recognises it (core/sources/registry.ts).
 */
import { ACCOUNT_TYPES, type AccountType, daysBetween, normalizeIban, parserFor } from "@banking/core";
import { UserError } from "../../platform/errors.ts";
import { randomToken, stableId } from "../../platform/ids.ts";
import type { Services } from "../../services/context.ts";
import { reprocess } from "../../services/enrich.ts";
import { startLookup } from "../../services/industry.ts";
import { type IngestResult, ingestTransactions } from "../../services/ingest.ts";
import { csvImport } from "./index.ts";

export interface CsvImportInput {
  content: string;
  /** An account of the user's to import into. Without it a new account is made. */
  accountId?: string;
  accountName?: string;
  accountType?: string;
}

export interface CsvImportResult extends IngestResult {
  accountId: string;
  /** The file's own dates, so an export that ends long ago is noticed now and not in Reports later. */
  firstDate?: string;
  lastDate?: string;
  daysOld?: number;
  errors: string[];
}

export async function importCsv(s: Services, userId: string, input: CsvImportInput): Promise<CsvImportResult> {
  const repo = s.finance(userId);
  const parsed = parserFor(input.content).parse(input.content);
  // rows dated in the future are typos or a wrong date format; they would also confuse the sync window
  const today = s.today();
  const future = parsed.transactions.filter((t) => t.bookingDate > today).length;
  const transactions = parsed.transactions.filter((t) => t.bookingDate <= today);
  if (future) parsed.errors.unshift(future === 1 ? "Ohitettu 1 tulevaisuuteen päivätty rivi." : `Ohitettu ${future} tulevaisuuteen päivättyä riviä.`);
  if (!transactions.length) throw new UserError(parsed.errors[0] ?? "Tiedostosta ei löytynyt tapahtumia.");

  const accounts = await repo.listAccounts();
  // the file's own IBAN lets transfers to another imported account pair up; an IBAN that
  // another own account already has would make two accounts look like one, so it is left out
  const ownIban = parsed.ownIban && !accounts.some((a) => normalizeIban(a.iban) === parsed.ownIban) ? parsed.ownIban : null;
  let accountId = input.accountId;
  // a new account or an IBAN that was missing changes what transfers can pair with, whatever the rows did
  let accountChanged = false;
  if (accountId) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new UserError("Tiliä ei löydy.");
    if (!account.iban && ownIban) {
      await repo.setAccountIbanIfMissing(accountId, ownIban);
      accountChanged = true;
    }
  } else {
    const name = input.accountName?.trim().slice(0, 80) || "Tuotu tili";
    // a second file under the same name would silently land in the first account
    const key = name.toLowerCase();
    if (accounts.some((a) => a.name.trim().toLowerCase() === key)) throw new UserError(`Tili ${name} on jo olemassa. Valitse se listasta tai anna toinen nimi.`);
    // account ids derive from this exact text: it stays "csv" whatever the connector is called
    let identity = stableId(`${userId}|csv|${name}`);
    // an account imported under this name and renamed since keeps the id; the new one must not take it over
    if (accounts.some((a) => a.id === `csv-${identity}`)) identity = stableId(`${userId}|csv|${name}|${randomToken()}`);
    accountId = `csv-${identity}`;
    accountChanged = true;
    await repo.upsertAccount({
      id: accountId,
      connectionId: null,
      provider: csvImport.id,
      externalId: null,
      identity,
      name,
      iban: ownIban,
      currency: "EUR",
      type: input.accountType && ACCOUNT_TYPES.includes(input.accountType as AccountType) ? (input.accountType as AccountType) : "checking",
    });
  }
  const result = await ingestTransactions(repo, accountId, transactions, csvImport.id, { replacePending: false });
  // the same file again changes nothing: no processing, and nobody's cached analysis is dropped
  if (result.changed || accountChanged) await reprocess(repo, s.settings);
  if (result.inserted) startLookup(s);
  const dates = transactions.map((t) => t.bookingDate).sort();
  const range = dates.length ? { firstDate: dates[0]!, lastDate: dates[dates.length - 1]!, daysOld: daysBetween(dates[dates.length - 1]!, s.today()) } : {};
  return { accountId, ...result, ...range, errors: parsed.errors.slice(0, 20) };
}
