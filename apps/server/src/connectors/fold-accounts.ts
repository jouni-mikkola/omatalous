/**
 * A CSV account and a bank account with the same IBAN are one real account. The rows of the CSV account move
 * into the bank account, so the sync sees them as another source and skips what it already has instead of
 * counting every payment twice. Rows get the ids a later import into the bank account would give them.
 *
 * It names both connectors, so it sits above them and not inside one: linking a bank calls it.
 */
import { fold, normalizeIban } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import { stableId } from "../platform/ids.ts";
import { csvImport } from "./csv-import/index.ts";
import { enableBanking } from "./enable-banking/connector.ts";

export async function foldCsvAccounts(repo: FinanceRepo): Promise<number> {
  const accounts = await repo.listAccounts();
  let folded = 0;
  for (const bank of accounts.filter((a) => a.provider === enableBanking.id && a.iban)) {
    const iban = normalizeIban(bank.iban);
    for (const csv of accounts.filter((a) => a.provider === csvImport.id && a.iban && a.id !== bank.id && normalizeIban(a.iban) === iban)) {
      const occurrence = new Map<string, number>();
      const newIds = new Map<string, string>();
      for (const t of await repo.transactionsOfAccount(csv.id)) {
        if (t.source !== csvImport.id || t.status !== "booked") continue;
        const base = `c|${t.bookingDate}|${t.amountCents}|${fold(t.counterparty ?? "")}|${fold(t.description ?? "")}`;
        const n = occurrence.get(base) ?? 0;
        occurrence.set(base, n + 1);
        newIds.set(t.id, stableId(`${bank.id}|booked|${base}|${n}`));
      }
      await repo.mergeAccountInto(csv.id, bank.id, newIds);
      folded++;
    }
  }
  return folded;
}
