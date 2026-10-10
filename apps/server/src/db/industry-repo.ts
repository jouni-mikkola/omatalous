/**
 * Cache of trade register answers per merchant name (migration 0002), and
 * which user's lookups asked about which name. The answers are public
 * company data shared by all users; FinanceRepo reads one only for a user
 * whose own lookup asked about that name.
 */
import type { IndustryMatch } from "@banking/core";
import type { Db, Statement } from "./types.ts";

export type IndustryStatus = IndustryMatch["status"] | "error";

export interface IndustryEntry {
  merchant: string;
  status: IndustryStatus;
  checkedAt: string;
}

/** How long an answer is trusted before the name is looked up again. */
const RECHECK_DAYS: Record<IndustryStatus, number> = { found: 365, none: 60, ambiguous: 60, error: 1 };

/** Names per statement: keeps each one small and well under SQLite's bound-parameter limit. */
const CHUNK = 90;

export class IndustryRepo {
  constructor(private readonly db: Db) {}

  /**
   * Records that `userId`'s lookup asked about these names and returns the
   * ones that were not recorded before. Only recorded names count for the
   * user, so an answer found for another member stays hidden until then.
   */
  async recordRequests(userId: string, merchants: readonly string[]): Promise<string[]> {
    const names = [...new Set(merchants)];
    const known = new Set<string>();
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      const rows = await this.db.all<{ merchant: string }>(
        `SELECT merchant FROM merchant_industry_users WHERE user_id = ? AND merchant IN (${chunk.map(() => "?").join(", ")})`,
        [userId, ...chunk],
      );
      for (const r of rows) known.add(r.merchant);
    }
    const fresh = names.filter((m) => !known.has(m));
    const statements: Statement[] = [];
    // two parameters per row
    for (let i = 0; i < fresh.length; i += CHUNK / 2) {
      const chunk = fresh.slice(i, i + CHUNK / 2);
      statements.push({
        sql: `INSERT OR IGNORE INTO merchant_industry_users (user_id, merchant) VALUES ${chunk.map(() => "(?, ?)").join(", ")}`,
        params: chunk.flatMap((m) => [userId, m]),
      });
    }
    if (statements.length) await this.db.batch(statements);
    return fresh;
  }

  /** Users whose lookups asked about any of these names. */
  async requestedBy(merchants: readonly string[]): Promise<Set<string>> {
    const users = new Set<string>();
    const names = [...new Set(merchants)];
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      const rows = await this.db.all<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM merchant_industry_users WHERE merchant IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      for (const r of rows) users.add(r.user_id);
    }
    return users;
  }

  /** Industry codes of the names the register found, for deciding which answers give a category. */
  async codes(merchants: readonly string[]): Promise<Map<string, { code: string; codeSet: string }>> {
    const out = new Map<string, { code: string; codeSet: string }>();
    const names = [...new Set(merchants)];
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      const rows = await this.db.all<{ merchant: string; industry_code: string; code_set: string }>(
        `SELECT merchant, industry_code, code_set FROM merchant_industry
         WHERE status = 'found' AND industry_code IS NOT NULL AND code_set IS NOT NULL AND merchant IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      for (const r of rows) out.set(r.merchant, { code: r.industry_code, codeSet: r.code_set });
    }
    return out;
  }

  /** Names from `merchants` with no answer yet, or an answer older than its recheck time. */
  async due(merchants: readonly string[], now: Date): Promise<string[]> {
    const known = new Map<string, IndustryEntry>();
    for (let i = 0; i < merchants.length; i += CHUNK) {
      const chunk = merchants.slice(i, i + CHUNK);
      const rows = await this.db.all<{ merchant: string; status: IndustryStatus; checked_at: string }>(
        `SELECT merchant, status, checked_at FROM merchant_industry WHERE merchant IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      for (const r of rows) known.set(r.merchant, { merchant: r.merchant, status: r.status, checkedAt: r.checked_at });
    }
    return merchants.filter((m) => {
      const e = known.get(m);
      if (!e) return true;
      const days = RECHECK_DAYS[e.status] ?? 1;
      return now.getTime() - Date.parse(e.checkedAt) > days * 86_400_000;
    });
  }

  async save(merchant: string, m: IndustryMatch, now: Date): Promise<void> {
    await this.db.run(
      `INSERT INTO merchant_industry (merchant, status, business_id, company_name, industry_code, code_set, industry_label, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(merchant) DO UPDATE SET status = excluded.status, business_id = excluded.business_id, company_name = excluded.company_name,
         industry_code = excluded.industry_code, code_set = excluded.code_set, industry_label = excluded.industry_label,
         checked_at = excluded.checked_at`,
      [merchant, m.status, m.businessId, m.companyName, m.code, m.codeSet, m.label, now.toISOString()],
    );
  }

  /** A failed lookup must not replace an earlier good answer. */
  async saveError(merchant: string, now: Date): Promise<void> {
    await this.db.run(
      `INSERT INTO merchant_industry (merchant, status, checked_at) VALUES (?, 'error', ?)
       ON CONFLICT(merchant) DO UPDATE SET checked_at = excluded.checked_at WHERE merchant_industry.status = 'error'`,
      [merchant, now.toISOString()],
    );
  }
}
