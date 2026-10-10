import { daysBetween, fold, normalizeMerchant, type RawTransaction } from "@banking/core";
import type { FinanceRepo } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import { stableId } from "./ids.ts";

export interface IngestResult {
  fetched: number;
  inserted: number;
  updated: number;
  /** Already imported from another source (e.g. a CSV covering the same days). */
  skipped: number;
}

/**
 * Stores transactions for one account. Ids are derived from the bank's own
 * id when there is one, otherwise from the transaction content plus an
 * occurrence counter (two identical coffees on the same day stay two rows).
 *
 * Pending transactions are replaced wholesale on every sync because banks
 * give them a new identity once they are booked.
 */
export async function ingestTransactions(
  repo: FinanceRepo,
  accountId: string,
  raws: readonly RawTransaction[],
  source: string,
  opts: { replacePending: boolean },
): Promise<IngestResult> {
  const booked = raws.filter((r) => r.status === "booked");
  const pending = opts.replacePending ? raws.filter((r) => r.status === "pending") : [];
  const result: IngestResult = { fetched: raws.length, inserted: 0, updated: 0, skipped: 0 };

  const dates = booked.map((r) => r.bookingDate).sort();
  const existing = dates.length ? await repo.transactionKeys(accountId, dates[0]!, dates[dates.length - 1]!) : [];
  const existingIds = new Set(existing.map((e) => e.id));
  const otherSourceCount = new Map<string, number>();
  for (const e of existing) {
    if (e.source === source) continue;
    const key = `${e.bookingDate}|${e.amountCents}`;
    otherSourceCount.set(key, (otherSourceCount.get(key) ?? 0) + 1);
  }

  // a category the user set on a pending row: kept when the row is re-sent, and moved to the
  // booked row that replaces it (same amount and merchant, booked within a week)
  const userPending = opts.replacePending ? await repo.userCategorisedPending(accountId) : [];
  const claimed = new Set<string>();
  const userChoiceFor = (id: string, r: RawTransaction, merchant: string) => {
    const same = userPending.find((p) => p.id === id);
    const moved = same ?? userPending.find((p) => !claimed.has(p.id) && p.amountCents === r.amountCents && p.merchant === merchant && Math.abs(daysBetween(p.bookingDate, r.bookingDate)) <= 7);
    if (moved) claimed.add(moved.id);
    return moved?.category ?? null;
  };

  const seenBase = new Map<string, number>();
  const seenKey = new Map<string, number>();
  const rows: Omit<StoredTransaction, "userId">[] = [];
  for (const r of [...booked, ...pending]) {
    const base = r.externalId
      ? `x|${r.externalId}`
      : `c|${r.bookingDate}|${r.amountCents}|${fold(r.counterparty ?? "")}|${fold(r.description ?? "")}`;
    const occurrence = seenBase.get(base) ?? 0;
    seenBase.set(base, occurrence + 1);
    const id = await stableId(`${accountId}|${r.status}|${base}|${occurrence}`);

    if (r.status === "booked") {
      if (existingIds.has(id)) {
        result.updated++;
      } else {
        const key = `${r.bookingDate}|${r.amountCents}`;
        const k = seenKey.get(key) ?? 0;
        seenKey.set(key, k + 1);
        if (k < (otherSourceCount.get(key) ?? 0)) {
          result.skipped++;
          continue;
        }
        result.inserted++;
      }
    }

    const merchant = normalizeMerchant(r.counterparty, r.description);
    const isNew = r.status === "pending" || !existingIds.has(id);
    const userCategory = isNew ? userChoiceFor(id, r, merchant) : null;
    rows.push({
      id,
      accountId,
      bookingDate: r.bookingDate,
      valueDate: r.valueDate,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      counterparty: r.counterparty,
      counterpartyIban: r.counterpartyIban,
      description: r.description,
      reference: r.reference,
      mcc: r.mcc,
      merchant,
      // placeholders (enrichment runs right after ingestion), unless the user had chosen
      category: userCategory ?? (r.amountCents >= 0 ? "income" : "other"),
      categorySource: userCategory ? "user" : "default",
      isTransfer: false,
      source,
      raw: r.raw === undefined ? null : JSON.stringify(r.raw),
    });
  }

  await repo.batch([
    ...(opts.replacePending ? [repo.deletePendingStatement(accountId)] : []),
    ...repo.upsertStatements(rows, new Date().toISOString()),
  ]);
  return result;
}
