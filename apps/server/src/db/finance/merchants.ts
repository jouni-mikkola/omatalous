/**
 * The user's rows seen by merchant: the names, the summaries for the category settings, one merchant's history,
 * the spending nothing recognised, and the trade register answers the user's own lookups found.
 */
import { fold, type IndustryCodeSet, isIndustryCodeSet, type Transaction } from "@banking/core";
import { type Row, type StoredTransaction, TX_COLUMNS_LIGHT, toTransaction } from "../rows.ts";
import type { FinanceContext } from "./context.ts";
import type { RulesRepo } from "./rules.ts";
import type { TransactionListRepo } from "./transaction-list.ts";

/** A merchant whose spending no rule, code or register answer recognised. */
export interface UncategorisedMerchant {
  merchant: string;
  /** Money spent, positive cents (like the dashboard's merchant totals). */
  totalCents: number;
  count: number;
  lastDate: string;
}

/** Everything one merchant's rows add up to, for the summary above a merchant-filtered transaction list. */
export interface MerchantHistory {
  count: number;
  /** Money out and in over the whole history, positive cents. */
  outCents: number;
  inCents: number;
  firstDate: string;
  lastDate: string;
  /** Calendar months with at least one row. */
  months: number;
  /** The category most of its rows are in. */
  category: string;
}

/** One merchant in the category settings. */
export interface MerchantSummary {
  merchant: string;
  /** The category most of its rows are in now. */
  category: string;
  count: number;
  /** Money out, positive cents. */
  totalCents: number;
  /** Money in, positive cents (a salary payer has only this). */
  inCents: number;
  lastDate: string;
  /** Money out per month of the period, rounded: `totalCents` over `MerchantList.months`. 0 for a merchant that is only paid. */
  monthlyCents: number;
  /** The "all of this merchant" rule, if the user made one. */
  rule: { id: number; category: string } | null;
  /** Rows in other categories than `category` (a bank: loan instalments and fees), most rows first. */
  otherCategories: { category: string; count: number; totalCents: number; inCents: number }[];
}

/** What narrows the merchant list. Dates are inclusive, and a missing one leaves that end of the history open. */
export interface MerchantFilter {
  q?: string;
  category?: string;
  from?: string;
  to?: string;
  /** Only these merchants (the ones with an active everyday-purchase series). */
  only?: ReadonlySet<string>;
  limit: number;
}

/** The merchants of a period and the number of calendar months the period spans, which `monthlyCents` divides by. */
export interface MerchantList {
  items: MerchantSummary[];
  months: number;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/**
 * Calendar months from `from` to `to`, both included, at least one. A part of a month counts as a whole one, so a
 * running month shows what it holds so far instead of a guess about the rest.
 */
export function monthSpan(from: string, to: string): number {
  return Math.max(1, monthIndex(to) - monthIndex(from) + 1);
}

export class MerchantsRepo {
  constructor(
    private readonly ctx: FinanceContext,
    private readonly rules: RulesRepo,
    private readonly list: TransactionListRepo,
  ) {}

  /** Every row of the given merchants, in the order `allTransactions` gives them. */
  async transactionsOfMerchants(merchants: readonly string[]): Promise<StoredTransaction[]> {
    const out: StoredTransaction[] = [];
    // keeps each statement well under SQLite's bound-parameter limit
    for (let i = 0; i < merchants.length; i += 500) {
      const chunk = merchants.slice(i, i + 500);
      const rows = await this.ctx.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? AND merchant IN (${chunk.map(() => "?").join(",")})`, [this.ctx.userId, ...chunk]);
      out.push(...rows.map(toTransaction));
    }
    return out.sort((a, b) => (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : a.id < b.id ? -1 : 1));
  }

  /** The distinct merchant names of the user's rows. */
  async merchantNames(): Promise<string[]> {
    return (await this.ctx.db.all<{ merchant: string }>("SELECT merchant FROM transactions WHERE user_id = ? GROUP BY merchant", [this.ctx.userId])).map((r) => String(r.merchant));
  }

  /** Rows that returns matched (a refund, a friend's share) outside the given merchants: where they are, not what they are. */
  async matchedRowsOutside(merchants: readonly string[]): Promise<Pick<Transaction, "accountId" | "bookingDate" | "amountCents">[]> {
    const rows = await this.ctx.db.all<Row>("SELECT account_id, booking_date, amount_cents, merchant FROM transactions WHERE user_id = ? AND category_source = 'match'", [this.ctx.userId]);
    const inside = new Set(merchants);
    return rows.filter((r) => !inside.has(String(r.merchant))).map((r) => ({ accountId: String(r.account_id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents) }));
  }

  /** Spending rows nothing categorised: the input of the trade register lookup. */
  async uncategorisedSpending(): Promise<Pick<Transaction, "accountId" | "amountCents" | "isTransfer" | "categorySource" | "merchant" | "mcc" | "counterparty" | "counterpartyIban" | "description" | "source">[]> {
    const rows = await this.ctx.db.all<Row>(
      `SELECT account_id, source, amount_cents, merchant, mcc, counterparty, counterparty_iban, description FROM transactions
       WHERE user_id = ? AND category_source = 'default' AND amount_cents < 0 AND is_transfer = 0`,
      [this.ctx.userId],
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      source: String(r.source),
      amountCents: Number(r.amount_cents),
      isTransfer: false,
      categorySource: "default" as const,
      merchant: String(r.merchant),
      mcc: r.mcc === null ? null : String(r.mcc),
      counterparty: r.counterparty === null ? null : String(r.counterparty),
      counterpartyIban: r.counterparty_iban === null ? null : String(r.counterparty_iban),
      description: r.description === null ? null : String(r.description),
    }));
  }

  /**
   * One merchant's whole history in one grouped read per side (own rows, shared accounts in the household view).
   * It runs on idx_tx_user_merchant_date, so it reads only that merchant's rows however long the history is.
   * The same rows as the transaction list filtered to the merchant, so the counts agree.
   */
  async merchantHistory(merchant: string, accountIds?: readonly string[]): Promise<MerchantHistory | null> {
    const months = new Set<string>();
    const categories = new Map<string, number>();
    let count = 0;
    let outCents = 0;
    let inCents = 0;
    let firstDate = "";
    let lastDate = "";
    for (const side of this.list.filterSides({ merchant }, accountIds)) {
      const rows = await this.ctx.db.all<{ category: string; m: string; n: number; inc: number | null; outc: number | null; first: string; last: string }>(
        `SELECT category, substr(booking_date, 1, 7) AS m, COUNT(*) AS n, SUM(CASE WHEN amount_cents > 0 THEN amount_cents END) AS inc,
                -SUM(CASE WHEN amount_cents < 0 THEN amount_cents END) AS outc, MIN(booking_date) AS first, MAX(booking_date) AS last
         FROM transactions INDEXED BY idx_tx_user_merchant_date WHERE ${side.where.join(" AND ")} GROUP BY category, m`,
        side.params,
      );
      for (const r of rows) {
        count += Number(r.n);
        inCents += Number(r.inc ?? 0);
        outCents += Number(r.outc ?? 0);
        months.add(r.m);
        categories.set(r.category, (categories.get(r.category) ?? 0) + Number(r.n));
        if (!firstDate || r.first < firstDate) firstDate = r.first;
        if (r.last > lastDate) lastDate = r.last;
      }
    }
    if (!count) return null;
    const category = [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    return { count, outCents, inCents, firstDate, lastDate, months: months.size, category };
  }

  /** Money-out rows nothing recognised, per merchant, biggest spending first. */
  async uncategorisedMerchants(limit = 50): Promise<UncategorisedMerchant[]> {
    const rows = await this.ctx.db.all<{ merchant: string; total: number; n: number; last: string }>(
      `SELECT merchant, -SUM(amount_cents) AS total, COUNT(*) AS n, MAX(booking_date) AS last FROM transactions
       WHERE user_id = ? AND amount_cents < 0 AND category_source = 'default' AND category = 'other' AND is_transfer = 0
       GROUP BY merchant ORDER BY total DESC, merchant LIMIT ?`,
      [this.ctx.userId, limit],
    );
    return rows.map((r) => ({ merchant: String(r.merchant), totalCents: Number(r.total), count: Number(r.n), lastDate: String(r.last) }));
  }

  /**
   * The user's merchants, biggest spending first, for the category settings and the merchant list on Tapahtumat.
   * Transfers are left out because transfer detection decides those and a rule cannot.
   * `category` and `q` (matched on the folded name) narrow the list, `from` and `to` the rows it adds up, and `only`
   * the merchants. A period that leaves an end open runs from the first or to the last row it finds, so the months
   * `monthlyCents` divides by are those with history in them, not the empty ones before an import or after the last row.
   */
  async merchantSummaries(f: MerchantFilter): Promise<MerchantList> {
    const range = `${f.from ? " AND booking_date >= ?" : ""}${f.to ? " AND booking_date <= ?" : ""}`;
    const params = [this.ctx.userId, ...(f.from ? [f.from] : []), ...(f.to ? [f.to] : [])];
    // the first row of a merchant is its most common category
    const rows = await this.ctx.db.all<{ merchant: string; category: string; n: number; total: number; income: number; first: string; last: string }>(
      `SELECT merchant, category, COUNT(*) AS n, SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS total,
              SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS income, MIN(booking_date) AS first, MAX(booking_date) AS last
       FROM transactions WHERE user_id = ? AND is_transfer = 0${range}
       GROUP BY merchant, category ORDER BY merchant, n DESC, category`,
      params,
    );
    if (!rows.length) return { items: [], months: 1 };
    const months = monthSpan(f.from ?? rows.reduce((min, r) => (r.first < min ? r.first : min), rows[0]!.first), f.to ?? rows.reduce((max, r) => (r.last > max ? r.last : max), rows[0]!.last));
    // rules come in the order they run, so the first one for a name is the one that applies
    const rules = new Map<string, { id: number; category: string }>();
    for (const r of await this.rules.listRules()) {
      if ((r.field === "merchant" || r.field === "merchant_exact") && !rules.has(r.pattern)) rules.set(r.pattern, { id: r.id!, category: r.category });
    }
    const merchants = new Map<string, MerchantSummary>();
    for (const r of rows) {
      const m = merchants.get(r.merchant);
      if (!m) {
        merchants.set(r.merchant, {
          merchant: r.merchant,
          category: r.category,
          count: Number(r.n),
          totalCents: Number(r.total),
          inCents: Number(r.income),
          monthlyCents: 0,
          lastDate: r.last,
          rule: rules.get(r.merchant) ?? null,
          otherCategories: [],
        });
        continue;
      }
      // the total covers every category: the page shows the others, so a bank's loan instalments do not read as fees
      m.otherCategories.push({ category: r.category, count: Number(r.n), totalCents: Number(r.total), inCents: Number(r.income) });
      m.count += Number(r.n);
      m.totalCents += Number(r.total);
      m.inCents += Number(r.income);
      if (r.last > m.lastDate) m.lastDate = r.last;
    }
    const q = f.q ? fold(f.q.trim()) : "";
    const items = [...merchants.values()]
      .filter((m) => (!f.category || m.category === f.category) && (!f.only || f.only.has(m.merchant)) && (!q || fold(m.merchant).includes(q)))
      .sort((a, b) => b.totalCents - a.totalCents || b.inCents - a.inCents || b.count - a.count || a.merchant.localeCompare(b.merchant))
      .slice(0, f.limit);
    for (const m of items) m.monthlyCents = Math.round(m.totalCents / months);
    return { items, months };
  }

  async hasMerchant(merchant: string): Promise<boolean> {
    return (await this.ctx.db.first("SELECT 1 FROM transactions WHERE user_id = ? AND merchant = ? AND is_transfer = 0 LIMIT 1", [this.ctx.userId, merchant])) !== null;
  }

  /**
   * Register industry codes for the names this user's own lookups asked
   * about (merchant_industry_users), or those of `sharedOwners` (owners of
   * accounts shared with this user that are in view). The register table is
   * shared, but an answer found for another member does not show up here.
   */
  async industryCodes(sharedOwners: readonly string[] = []): Promise<Map<string, { code: string; codeSet: IndustryCodeSet }>> {
    const owners = [...new Set([this.ctx.userId, ...sharedOwners])];
    const rows = await this.ctx.db.all<{ merchant: string; industry_code: string; code_set: string }>(
      `SELECT m.merchant, m.industry_code, m.code_set FROM merchant_industry m
       WHERE m.status = 'found' AND m.industry_code IS NOT NULL
         AND EXISTS (SELECT 1 FROM merchant_industry_users r WHERE r.merchant = m.merchant AND r.user_id IN (${owners.map(() => "?").join(", ")}))`,
      owners,
    );
    const out = new Map<string, { code: string; codeSet: IndustryCodeSet }>();
    for (const r of rows) if (isIndustryCodeSet(r.code_set)) out.set(r.merchant, { code: r.industry_code, codeSet: r.code_set });
    return out;
  }

  /**
   * Register details (business id, industry) for the transactions list:
   * names that this user's lookups, or those of `sharedOwners` (owners of
   * accounts shared with this user that are in view), asked about.
   */
  async industryDetails(
    merchants: readonly string[],
    sharedOwners: readonly string[] = [],
  ): Promise<Map<string, { companyName: string | null; businessId: string | null; label: string | null }>> {
    const out = new Map<string, { companyName: string | null; businessId: string | null; label: string | null }>();
    const owners = [...new Set([this.ctx.userId, ...sharedOwners])];
    const names = [...new Set(merchants)];
    // keeps each statement well under SQLite's bound-parameter limit
    const size = 99 - owners.length;
    if (size < 1) throw new Error("too many account owners for one statement");
    for (let i = 0; i < names.length; i += size) {
      const chunk = names.slice(i, i + size);
      const rows = await this.ctx.db.all<{ merchant: string; company_name: string | null; business_id: string | null; industry_label: string | null }>(
        `SELECT m.merchant, m.company_name, m.business_id, m.industry_label FROM merchant_industry m
         WHERE m.status = 'found' AND m.merchant IN (${chunk.map(() => "?").join(", ")})
           AND EXISTS (SELECT 1 FROM merchant_industry_users r WHERE r.merchant = m.merchant AND r.user_id IN (${owners.map(() => "?").join(", ")}))`,
        [...chunk, ...owners],
      );
      for (const r of rows) out.set(r.merchant, { companyName: r.company_name, businessId: r.business_id, label: r.industry_label });
    }
    return out;
  }
}
