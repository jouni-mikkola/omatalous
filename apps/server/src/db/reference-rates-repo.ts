/**
 * The published fixings of the euribor rates (migration 0032), one row per rate and day. They are public market data
 * of the whole install: no user id, and every member's loans read the same rows (`UserInputs.fixings`).
 */
import type { Fixings, IsoDate } from "@banking/core";
import type { EuriborReference, FixingRow } from "../providers/reference-rates/client.ts";
import type { Db, Statement } from "./types.ts";

/** Rows per statement: three parameters each, well under SQLite's bound-parameter limit. */
const CHUNK = 200;

export class ReferenceRatesRepo {
  constructor(private readonly db: Db) {}

  /** Writes the fixings, a day already stored taking the new rate. Returns how many rows were new. */
  async upsert(rows: readonly FixingRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const before = await this.count();
    const statements: Statement[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      statements.push({
        sql: `INSERT INTO reference_rates (reference, day, rate_milli) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}
              ON CONFLICT (reference, day) DO UPDATE SET rate_milli = excluded.rate_milli WHERE rate_milli <> excluded.rate_milli`,
        params: chunk.flatMap((r) => [r.reference, r.day, r.rateMilli]),
      });
    }
    await this.db.batch(statements);
    return (await this.count()) - before;
  }

  private async count(): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM reference_rates"))?.n ?? 0;
  }

  /** The newest day with a fixing, or null on an empty table. */
  async newestDay(): Promise<IsoDate | null> {
    return (await this.db.first<{ day: string | null }>("SELECT MAX(day) AS day FROM reference_rates"))?.day ?? null;
  }

  /** Every fixing of each rate, oldest first. A rate with none is left out. */
  async all(): Promise<Fixings> {
    const rows = await this.db.all<{ reference: EuriborReference; day: IsoDate; rate_milli: number }>("SELECT reference, day, rate_milli FROM reference_rates ORDER BY reference, day");
    const out: Partial<Record<EuriborReference, [IsoDate, number][]>> = {};
    for (const r of rows) (out[r.reference] ??= []).push([r.day, r.rate_milli]);
    return out;
  }

  /**
   * The fixings a loan with a balance from `day` on counts from: those from `day`, and of each rate the newest one before
   * it, which holds until the first one from `day`. The newest fixing alone on a day after the last one.
   */
  async since(day: IsoDate): Promise<Fixings> {
    const rows = await this.db.all<{ reference: EuriborReference; day: IsoDate; rate_milli: number }>(
      `SELECT reference, day, rate_milli FROM reference_rates r
       WHERE day >= ? OR day = (SELECT MAX(day) FROM reference_rates WHERE reference = r.reference AND day < ?)
       ORDER BY reference, day`,
      [day, day],
    );
    const out: Partial<Record<EuriborReference, [IsoDate, number][]>> = {};
    for (const r of rows) (out[r.reference] ??= []).push([r.day, r.rate_milli]);
    return out;
  }
}
