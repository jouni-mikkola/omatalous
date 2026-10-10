import { daysBetween, fold, normalizeMerchant, type RawTransaction, UNKNOWN_MERCHANT } from "@banking/core";
import { bankSignature, type FinanceRepo, type StoredParty, WRITE_CHUNK } from "../db/finance-repo.ts";
import type { StoredTransaction } from "../db/rows.ts";
import { yieldToLoop } from "../platform/yield.ts";
import { stableId } from "../platform/ids.ts";

export interface IngestResult {
  fetched: number;
  inserted: number;
  updated: number;
  /** Already stored: given by another source (a CSV covering the same days) or by an earlier import of the same kind in another layout. */
  skipped: number;
  /**
   * Rows written or removed. Zero when the rows were all stored already with the same bank fields: nothing was
   * written then, and there is nothing to process again.
   */
  changed: number;
}

/** How many days after a pending row's date its booked row may be dated. */
const BOOKING_DELAY_DAYS = 7;

interface Party {
  merchant: string;
  counterparty: string | null;
  description: string | null;
}

/**
 * Whether two rows with the same day and amount can be one payment that reached us twice, as a bank row and a
 * CSV row or as a pending row and its booked row. The texts differ between sources, so the merchant names only
 * have to agree on their first word, or one row's text has to name the other's merchant. A row without a
 * merchant says nothing and agrees with any. Two different shops that charged the same amount on the same day
 * disagree, and both are kept.
 */
export function sameParty(a: Party, b: Party): boolean {
  if (a.merchant === UNKNOWN_MERCHANT || b.merchant === UNKNOWN_MERCHANT) return true;
  const ma = fold(a.merchant).trim();
  const mb = fold(b.merchant).trim();
  if (ma === mb) return true;
  const first = (m: string) => m.split(/\s+/)[0] ?? "";
  if (first(ma).length >= 3 && first(ma) === first(mb)) return true;
  const text = (p: Party) => fold([p.counterparty, p.description].filter(Boolean).join(" "));
  return (mb.length >= 4 && text(a).includes(mb)) || (ma.length >= 4 && text(b).includes(ma));
}

/** The candidate that names the same merchant exactly, else the first. */
function closest<T extends Party>(candidates: readonly T[], party: Party): T | undefined {
  return candidates.find((c) => fold(c.merchant) === fold(party.merchant)) ?? candidates[0];
}

/**
 * Stores transactions for one account. Ids are derived from the bank's own
 * id when there is one, otherwise from the transaction content plus an
 * occurrence counter (two identical coffees on the same day stay two rows).
 *
 * Pending transactions are replaced wholesale on every sync because banks
 * give them a new identity once they are booked. A booked row also removes
 * the pending row it replaces when that row is not replaced by the sync:
 * one listed in the same answer, or one left in the account when a CSV
 * brings the booked row. It takes the user's category with it.
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
  const result: IngestResult = { fetched: raws.length, inserted: 0, updated: 0, skipped: 0, changed: 0 };

  const dates = booked.map((r) => r.bookingDate).sort();
  const existing = dates.length ? await repo.transactionKeys(accountId, dates[0]!, dates[dates.length - 1]!) : [];
  const existingSignature = new Map(existing.map((e) => [e.id, e.signature]));
  const existingIds = new Set(existingSignature.keys());

  // ids first: the occurrence counter numbers identical rows in the order they came
  const seenBase = new Map<string, number>();
  const entries: { r: RawTransaction; id: string; party: Party }[] = [];
  for (const r of [...booked, ...pending]) {
    // a first sync or a big CSV is tens of thousands of rows: give the event loop back now and then
    if (entries.length % 2000 === 1999) await yieldToLoop();
    const base = r.externalId
      ? `x|${r.externalId}`
      : `c|${r.bookingDate}|${r.amountCents}|${fold(r.counterparty ?? "")}|${fold(r.description ?? "")}`;
    const occurrence = seenBase.get(base) ?? 0;
    seenBase.set(base, occurrence + 1);
    const id = stableId(`${accountId}|${r.status}|${base}|${occurrence}`);
    entries.push({ r, id, party: { merchant: normalizeMerchant(r.counterparty, r.description), counterparty: r.counterparty, description: r.description } });
  }

  // Rows stored for the same day and amount that this import does not name: a new row is a duplicate only if it is one
  // of them. Another source's rows qualify. So do rows of the same source from an earlier import, which the same
  // purchase reaches under another id when the file has another layout. A row with the bank's own id is never a twin of
  // a same-source row, because two ids are two payments.
  const importIds = new Set(entries.map((e) => e.id));
  const others = new Map<string, StoredParty[]>();
  const earlier = new Map<string, StoredParty[]>();
  for (const e of existing) {
    if (e.source === source && importIds.has(e.id)) continue;
    const key = `${e.bookingDate}|${e.amountCents}`;
    const into = e.source === source ? earlier : others;
    const group = into.get(key);
    if (group) group.push(e);
    else into.set(key, [e]);
  }
  const usedOthers = new Set<string>();

  // pending rows that a booked row replaces: those in this answer, and those already stored
  const stored = await repo.pendingRows(accountId);
  const takenStored = new Set<string>();
  const droppedPending = new Set<string>();
  const pendingEntries = entries.filter((e) => e.r.status === "pending");
  type Candidate = { r: RawTransaction; party: Party };
  /** Stored pending rows with the row's amount and party, dated `from` to `to` days before it. */
  const storedLike = (e: Candidate, from: number, to: number, onlyUser: boolean) =>
    stored.filter((p) => {
      const days = daysBetween(p.bookingDate, e.r.bookingDate);
      return !takenStored.has(p.id) && (!onlyUser || p.categorySource === "user") && p.amountCents === e.r.amountCents && days >= from && days <= to && sameParty(p, e.party);
    });
  /**
   * A new booked row replaces the pending row it is dated on or up to a week after: one in this answer
   * (dropped) or one stored. Returns the user's category on that pending row. A sync that replaces all stored
   * pending rows only carries the category, so a few days either way are allowed there.
   */
  const replaceOldPending = (e: Candidate): string | null => {
    const inAnswer = closest(
      pendingEntries
        .filter((p) => {
          const days = daysBetween(p.r.bookingDate, e.r.bookingDate);
          return !droppedPending.has(p.id) && p.r.amountCents === e.r.amountCents && days >= 0 && days <= BOOKING_DELAY_DAYS && sameParty(p.party, e.party);
        })
        .map((p) => ({ ...p.party, id: p.id })),
      e.party,
    );
    if (inAnswer) droppedPending.add(inAnswer.id);
    const sameRow = inAnswer ? stored.find((p) => p.id === inAnswer.id && !takenStored.has(p.id)) : undefined;
    const row = sameRow ?? closest(storedLike(e, opts.replacePending ? -BOOKING_DELAY_DAYS : 0, BOOKING_DELAY_DAYS, opts.replacePending), e.party);
    if (row) takenStored.add(row.id);
    return row?.categorySource === "user" ? row.category : null;
  };

  const rows: Omit<StoredTransaction, "userId">[] = [];
  for (const [i, entry] of entries.entries()) {
    if (i % 2000 === 1999) await yieldToLoop();
    const { r, id, party } = entry;
    let userCategory: string | null = null;
    if (r.status === "booked") {
      if (existingIds.has(id)) {
        result.updated++;
      } else {
        const key = `${r.bookingDate}|${r.amountCents}`;
        const candidates = [...(others.get(key) ?? []), ...(r.externalId ? [] : (earlier.get(key) ?? []))];
        const twin = closest(candidates.filter((o) => !usedOthers.has(o.id) && sameParty(o, party)), party);
        if (twin) {
          usedOthers.add(twin.id);
          result.skipped++;
          continue;
        }
        result.inserted++;
        userCategory = replaceOldPending(entry);
      }
    } else {
      if (droppedPending.has(id)) continue;
      // a pending row sent again keeps the user's category, also when the bank changed its identity or text a little
      const same = stored.find((p) => p.id === id);
      const moved = same ?? closest(storedLike(entry, -BOOKING_DELAY_DAYS, BOOKING_DELAY_DAYS, true), party);
      if (moved) takenStored.add(moved.id);
      userCategory = moved?.categorySource === "user" ? moved.category : null;
    }

    const row: Omit<StoredTransaction, "userId"> = {
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
      merchant: party.merchant,
      // placeholders (enrichment runs right after ingestion), unless the user had chosen
      category: userCategory ?? (r.amountCents >= 0 ? "income" : "other"),
      categorySource: userCategory ? "user" : "default",
      isTransfer: false,
      source,
      raw: r.raw === undefined ? null : JSON.stringify(r.raw),
    };
    // a row stored already with the same bank fields is not written again (a sync re-reads ten days)
    if (r.status === "booked" && existingSignature.get(id) === bankSignature(row)) continue;
    rows.push(row);
  }

  // the pending rows of a sync replace the stored ones; when they are the same rows, nothing is replaced
  const bookedRows = rows.filter((r) => r.status === "booked");
  const pendingRows = rows.filter((r) => r.status === "pending");
  const storedPending = new Map(stored.map((p) => [p.id, p.signature]));
  const pendingChanged =
    opts.replacePending && (pendingRows.length !== storedPending.size || pendingRows.some((r) => storedPending.get(r.id) !== bankSignature(r)));
  const writes = [...bookedRows, ...(pendingChanged ? pendingRows : [])];
  // a sync that does not replace pending rows (a CSV) removes only the ones its booked rows replace
  const removals = opts.replacePending ? [] : [...takenStored];
  result.changed = writes.length + removals.length + (pendingChanged ? storedPending.size : 0);
  if (!pendingChanged && !writes.length && !removals.length) return result;

  const at = new Date().toISOString();
  const statements = [
    ...(pendingChanged ? [repo.deletePendingStatement(accountId)] : []),
    ...repo.upsertStatements(writes, at),
    ...removals.map((id) => repo.deletePendingByIdStatement(accountId, id)),
  ];
  // reprocess runs next; if the process dies first the mark brings it back (services/enrich.ts, hourly tick)
  if (statements.length <= WRITE_CHUNK) {
    await repo.batch([...statements, ...repo.unprocessedStatements(at)]);
    return result;
  }
  // A big import goes in transactions of a couple of thousand rows with the event loop given back in between. The
  // mark is in the first one, so a stop halfway leaves it set, and in the last one again, because a reprocess that ran
  // in between clears the mark it saw. Ids are derived from the rows, so a repeated import fills in what is missing.
  for (let i = 0; i < statements.length; i += WRITE_CHUNK) {
    const chunk = statements.slice(i, i + WRITE_CHUNK);
    const first = i === 0;
    const last = i + WRITE_CHUNK >= statements.length;
    await repo.batch([...chunk, ...(first || last ? repo.unprocessedStatements(at) : [])]);
    if (!last) await yieldToLoop();
  }
  return result;
}
