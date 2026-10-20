/**
 * The rows of another currency than the euro (`foreign_rows`), keyed by the real account (`keyOf`) like the balance
 * record: a joint account fetched by both members is one set of rows. The euro tables never read them.
 */
import type { ForeignRowInput } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

interface ForeignRowRecord extends ForeignRowInput {
  accountKey: string;
}

const TEXT_MAX = 200;

export class ForeignRowRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /**
   * Keeps the rows of one fetch: a row of a key already held is updated in place, never doubled. Returns how many rows are
   * new or differ from what was held (a re-read of the overlap returns 0), so that only a real change moves the data version.
   */
  async storeForeignRows(accountKey: string, rows: readonly ForeignRowInput[], seenAt: string): Promise<number> {
    if (!rows.length) return 0;
    const held = new Map(
      (await this.ctx.db.all<Record<string, unknown>>("SELECT raw_key, booking_date, amount_minor, scale, currency, text FROM foreign_rows WHERE account_key = ?", [accountKey])).map((r) => [
        String(r.raw_key),
        `${r.booking_date}|${r.amount_minor}|${r.scale}|${r.currency}|${r.text ?? ""}`,
      ]),
    );
    let changed = 0;
    for (const r of rows) {
      const text = r.text ? r.text.slice(0, TEXT_MAX) : null;
      if (held.get(r.rawKey) !== `${r.bookingDate}|${r.amountMinor}|${r.scale}|${r.currency}|${text ?? ""}`) changed++;
    }
    await this.ctx.db.batch(
      rows.map((r) => ({
        sql: `INSERT INTO foreign_rows (account_key, raw_key, booking_date, amount_minor, scale, currency, text, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (account_key, raw_key) DO UPDATE SET booking_date = excluded.booking_date, amount_minor = excluded.amount_minor, scale = excluded.scale,
                currency = excluded.currency, text = excluded.text, seen_at = excluded.seen_at`,
        params: [accountKey, r.rawKey, r.bookingDate, r.amountMinor, r.scale, r.currency, r.text ? r.text.slice(0, TEXT_MAX) : null, seenAt],
      })),
    );
    return changed;
  }

  /** The rows of the given real accounts, newest day first. */
  async foreignRowsOf(keys: readonly string[]): Promise<ForeignRowRecord[]> {
    if (!keys.length) return [];
    const marks = keys.map(() => "?").join(",");
    return (
      await this.ctx.db.all<Record<string, unknown>>(
        `SELECT account_key, raw_key, booking_date, amount_minor, scale, currency, text FROM foreign_rows WHERE account_key IN (${marks}) ORDER BY booking_date DESC, raw_key`,
        [...keys],
      )
    ).map((r) => ({
      accountKey: String(r.account_key),
      rawKey: String(r.raw_key),
      bookingDate: String(r.booking_date),
      amountMinor: Number(r.amount_minor),
      scale: Number(r.scale),
      currency: String(r.currency),
      text: r.text === null ? null : String(r.text),
    }));
  }
}
