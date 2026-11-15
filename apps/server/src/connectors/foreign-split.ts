import { foreignCurrencyOf, fold, parseForeignAmount, type RawTransaction } from "@banking/core";
import type { ForeignRowInput } from "../db/rows.ts";
import { stableId } from "../platform/ids.ts";

/** What a fetch holds once split by the currency each row names for its own amount. */
interface SplitRows {
  /** Rows in euros: the only ones the app counts. */
  euro: RawTransaction[];
  /** Booked rows in another currency, to keep in the bank's own figure. */
  foreign: ForeignRowInput[];
  /** Rows in another currency that are not kept (pending, or an amount that is not a plain decimal), by currency. */
  skipped: Map<string, number>;
}

/** The bank's own text of the amount and its direction, from the row as the bank sent it; the cents are the fallback for a source that keeps no text. */
function bankAmount(r: RawTransaction): { text: unknown; indicator: unknown } {
  const t = r.raw as { transaction_amount?: { amount?: unknown }; credit_debit_indicator?: unknown } | null | undefined;
  const text = t?.transaction_amount?.amount;
  return text === undefined ? { text: (Math.abs(r.amountCents) / 100).toFixed(2), indicator: r.amountCents < 0 ? "DBIT" : "CRDT" } : { text, indicator: t?.credit_debit_indicator };
}

/**
 * The app counts in euros: another currency's amount would be added to them as if it were euros. A row's own currency
 * decides, nothing else (a euro row on a dollar account is a euro row; a row without a currency is `XXX`, not euros). A
 * booked row in another currency is kept apart; the identity of a row is the bank's id, or its content and an occurrence
 * counter, so two equal purchases stay two rows and a re-read of the overlap is the same row.
 */
export function splitByCurrency(raws: readonly RawTransaction[], accountKey: string): SplitRows {
  const out: SplitRows = { euro: [], foreign: [], skipped: new Map() };
  const seen = new Map<string, number>();
  const skip = (currency: string) => out.skipped.set(currency, (out.skipped.get(currency) ?? 0) + 1);
  for (const r of raws) {
    const currency = foreignCurrencyOf(r.currency);
    if (currency === "EUR") {
      out.euro.push(r);
      continue;
    }
    const { text, indicator } = bankAmount(r);
    const amount = r.status === "booked" ? parseForeignAmount(text, indicator) : null;
    if (!amount) {
      skip(currency);
      continue;
    }
    const base = r.externalId ? `x|${r.externalId}` : `c|${r.bookingDate}|${amount.minor}|${currency}|${fold(r.counterparty ?? "")}|${fold(r.description ?? "")}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    out.foreign.push({
      rawKey: stableId(`${accountKey}|${base}|${occurrence}`),
      bookingDate: r.bookingDate,
      amountMinor: amount.minor,
      scale: amount.scale,
      currency,
      text: [r.counterparty, r.description].filter((x): x is string => !!x?.trim()).join(" ").trim() || null,
    });
  }
  return out;
}

/** The note of a fetch about rows in another currency that it did not keep, or null. */
export function skippedNote(skipped: ReadonlyMap<string, number>, accountName: string): string | null {
  const n = [...skipped.values()].reduce((a, b) => a + b, 0);
  return n ? `${accountName}: ohitettu ${n === 1 ? "1 rivi, jonka" : `${n} riviä, joiden`} valuutta ei ole EUR (${[...skipped.keys()].join(", ")}).` : null;
}
