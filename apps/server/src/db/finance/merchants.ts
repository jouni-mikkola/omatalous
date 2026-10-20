/**
 * The user's rows seen by merchant: the names, the summaries for the category settings, one merchant's history,
 * the spending nothing recognised, and the trade register answers the user's own lookups found. The sums a page
 * shows take `own`: in the own view a row of a joint account adds the viewer's part, an account somebody else uses
 * alone adds nothing, and a row has the category and the transfer mark the view counts it by (`toldSql`).
 */
import { fold, isIndustryCodeSet, isUnnamedMobilePay, type MerchantBasis, merchantMonthly, monthEnd, type RegisterAnswer, type Transaction } from "@banking/core";
import { type Row, type StoredTransaction, TX_COLUMNS_LIGHT, toTransaction } from "../rows.ts";
import type { FinanceContext } from "./context.ts";
import { notLeftSql, type OwnRows, partSql, toldSql } from "./part-sql.ts";
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

/** The answer of `GET /merchants/uncategorised`: the biggest merchants, and the count and sum over all of them. */
interface UncategorisedList {
  items: UncategorisedMerchant[];
  count: number;
  totalCents: number;
}

/**
 * Everything one merchant's rows add up to, for the summary above a merchant-filtered transaction list. An own
 * transfer is counted as a row but not in the sums: it is money moved, not paid or received.
 */
export interface MerchantHistory {
  count: number;
  /** Rows that are own transfers. */
  transfers: number;
  /** Money out and in over the whole history, positive cents, own transfers left out. */
  outCents: number;
  inCents: number;
  firstDate: string;
  lastDate: string;
  /** The category most of its rows other than own transfers are in (that of the transfers when it has nothing else). */
  category: string;
  /** Money out per calendar month (`YYYY-MM`), own transfers left out: what `merchantMonthly` adds up. */
  outByMonth: Record<string, number>;
  /** Rows per calendar month, own transfers left out. */
  countByMonth: Record<string, number>;
}

const NO_BASIS: MerchantBasis = { months: [], series: new Map() };

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
  /**
   * Money out per month by `merchantMonthly`, whatever the period: an active series' own figure, else the last
   * complete months. 0 for a merchant that is only paid, null without a complete month.
   */
  monthlyCents: number | null;
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
  /** What `monthlyCents` reads; without it the figure is null. */
  basis?: MerchantBasis;
  /** The own view: the viewer's accounts it leaves out, the parts the sums are cut by, and the rows it counts otherwise than they are stored. */
  own?: OwnRows;
}

/** The merchants of a period and the complete months that `monthlyCents` of a merchant without a series divides by. */
export interface MerchantList {
  items: MerchantSummary[];
  months: number;
}

/** The dates the complete months of a basis run over, null without one. */
const basisRange = (basis: MerchantBasis): { from: string; to: string } | null =>
  basis.months.length ? { from: `${basis.months[0]}-01`, to: monthEnd(basis.months[basis.months.length - 1]!) } : null;

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

  /** What a payer's median reads: every row of money in, as far as its payer, sum and day (core `steadyPayers`). */
  async incomingPayerRows(): Promise<Pick<Transaction, "counterparty" | "counterpartyIban" | "amountCents" | "bookingDate">[]> {
    const rows = await this.ctx.db.all<Row>("SELECT counterparty, counterparty_iban, amount_cents, booking_date FROM transactions WHERE user_id = ? AND amount_cents > 0", [this.ctx.userId]);
    return rows.map((r) => ({ counterparty: r.counterparty === null ? null : String(r.counterparty), counterpartyIban: r.counterparty_iban === null ? null : String(r.counterparty_iban), amountCents: Number(r.amount_cents), bookingDate: String(r.booking_date) }));
  }

  /** The distinct merchant names of the user's rows. */
  async merchantNames(): Promise<string[]> {
    return (await this.ctx.db.all<{ merchant: string }>("SELECT merchant FROM transactions WHERE user_id = ? GROUP BY merchant", [this.ctx.userId])).map((r) => String(r.merchant));
  }

  /** Rows that returns matched (a refund, a friend's share) outside the given merchants: where they are, and whether they are MobilePay money naming no sender. */
  async matchedRowsOutside(merchants: readonly string[]): Promise<(Pick<Transaction, "accountId" | "bookingDate" | "amountCents"> & { wallet: boolean })[]> {
    const rows = await this.ctx.db.all<Row>("SELECT account_id, booking_date, amount_cents, merchant, counterparty, description FROM transactions WHERE user_id = ? AND category_source = 'match'", [this.ctx.userId]);
    const inside = new Set(merchants);
    return rows.filter((r) => !inside.has(String(r.merchant))).map((r) => ({ accountId: String(r.account_id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents), wallet: isUnnamedMobilePay({ counterparty: r.counterparty === null ? null : String(r.counterparty), description: r.description === null ? null : String(r.description) }) }));
  }

  /** Spending rows nothing categorised. The reference number tells an invoice from a transfer (core `isBusinessRow`). */
  uncategorisedSpending() {
    return this.spendingFiledBy(["default"]);
  }

  /**
   * The input of the trade register lookup: the rows nothing categorised, and those a guess filed (a lexicon stem, or an
   * earlier register answer), since a found entry replaces a stem's category. A list of its own: no figure of a page reads it.
   */
  registerLookupRows() {
    return this.spendingFiledBy(["default", "industry"]);
  }

  private async spendingFiledBy(sources: readonly ("default" | "industry")[]): Promise<
    (Pick<Transaction, "accountId" | "amountCents" | "isTransfer" | "categorySource" | "merchant" | "mcc" | "counterparty" | "counterpartyIban" | "description" | "source"> & { reference: string | null })[]
  > {
    const rows = await this.ctx.db.all<Row>(
      `SELECT account_id, source, category_source, amount_cents, merchant, mcc, counterparty, counterparty_iban, description, reference FROM transactions
       WHERE user_id = ? AND category_source IN (${sources.map(() => "?").join(", ")}) AND amount_cents < 0 AND is_transfer = 0`,
      [this.ctx.userId, ...sources],
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      source: String(r.source),
      amountCents: Number(r.amount_cents),
      isTransfer: false,
      categorySource: r.category_source === "industry" ? ("industry" as const) : ("default" as const),
      merchant: String(r.merchant),
      mcc: r.mcc === null ? null : String(r.mcc),
      counterparty: r.counterparty === null ? null : String(r.counterparty),
      counterpartyIban: r.counterparty_iban === null ? null : String(r.counterparty_iban),
      description: r.description === null ? null : String(r.description),
      reference: r.reference === null ? null : String(r.reference),
    }));
  }

  /**
   * One merchant's whole history in one grouped read per side (own rows, shared accounts in the household view).
   * It runs on idx_tx_user_merchant_date, so it reads only that merchant's rows however long the history is.
   * The same rows as the transaction list filtered to the merchant, so the counts agree.
   */
  async merchantHistory(merchant: string, accountIds?: readonly string[], own?: OwnRows): Promise<MerchantHistory | null> {
    // own transfers apart: they are rows of the merchant, but neither paid nor received, and not its category
    const categories = { paid: new Map<string, number>(), moved: new Map<string, number>() };
    const outByMonth: Record<string, number> = {};
    const countByMonth: Record<string, number> = {};
    let count = 0;
    let transfers = 0;
    let outCents = 0;
    let inCents = 0;
    let firstDate = "";
    let lastDate = "";
    const part = partSql(own?.parts ?? new Map(), "amount_cents");
    const told = toldSql(own);
    for (const side of this.list.filterSides({ merchant, own }, accountIds)) {
      const rows = await this.ctx.db.all<{ cat: string; m: string; moved: number; n: number; inc: number | null; outc: number | null; first: string; last: string }>(
        `SELECT ${told.category.sql} AS cat, substr(booking_date, 1, 7) AS m, ${told.moved.sql} != 0 AS moved, COUNT(*) AS n, SUM(CASE WHEN amount_cents > 0 THEN ${part.sql} END) AS inc,
                -SUM(CASE WHEN amount_cents < 0 THEN ${part.sql} END) AS outc, MIN(booking_date) AS first, MAX(booking_date) AS last
         FROM transactions INDEXED BY idx_tx_user_merchant_date WHERE ${side.where.join(" AND ")} GROUP BY cat, m, moved`,
        [...told.category.params, ...told.moved.params, ...part.params, ...part.params, ...side.params],
      );
      for (const r of rows) {
        const n = Number(r.n);
        count += n;
        const kept = Number(r.moved) ? categories.moved : categories.paid;
        kept.set(r.cat, (kept.get(r.cat) ?? 0) + n);
        if (!firstDate || r.first < firstDate) firstDate = r.first;
        if (r.last > lastDate) lastDate = r.last;
        if (Number(r.moved)) {
          transfers += n;
          continue;
        }
        inCents += Number(r.inc ?? 0);
        outCents += Number(r.outc ?? 0);
        outByMonth[r.m] = (outByMonth[r.m] ?? 0) + Number(r.outc ?? 0);
        countByMonth[r.m] = (countByMonth[r.m] ?? 0) + n;
      }
    }
    if (!count) return null;
    const ranked = [...(categories.paid.size ? categories.paid : categories.moved)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { count, transfers, outCents, inCents, firstDate, lastDate, category: ranked[0]![0], outByMonth, countByMonth };
  }

  /** Money-out rows nothing recognised: the `limit` biggest merchants, and the count and sum of all of them. */
  async uncategorisedMerchants(limit = 50, own?: OwnRows): Promise<UncategorisedList> {
    const part = partSql(own?.parts ?? new Map(), "amount_cents");
    const kept = notLeftSql(own);
    const told = toldSql(own);
    const nothingRecognised = `amount_cents < 0 AND category_source = 'default' AND ${told.category.sql} = 'other' AND ${told.moved.sql} = 0${kept.sql}`;
    const narrowed = [this.ctx.userId, ...told.category.params, ...told.moved.params, ...kept.params];
    const rows = await this.ctx.db.all<{ merchant: string; total: number; n: number; last: string }>(
      `SELECT merchant, -SUM(${part.sql}) AS total, COUNT(*) AS n, MAX(booking_date) AS last FROM transactions
       WHERE user_id = ? AND ${nothingRecognised} GROUP BY merchant ORDER BY total DESC, merchant LIMIT ?`,
      [...part.params, ...narrowed, limit],
    );
    const [all] = await this.ctx.db.all<{ merchants: number; total: number | null }>(
      `SELECT COUNT(DISTINCT merchant) AS merchants, -SUM(${part.sql}) AS total FROM transactions WHERE user_id = ? AND ${nothingRecognised}`,
      [...part.params, ...narrowed],
    );
    return {
      items: rows.map((r) => ({ merchant: String(r.merchant), totalCents: Number(r.total), count: Number(r.n), lastDate: String(r.last) })),
      count: Number(all?.merchants ?? 0),
      totalCents: Number(all?.total ?? 0),
    };
  }

  /**
   * The user's merchants, biggest spending first, for the category settings and the merchant list on Tapahtumat.
   * Transfers are left out because transfer detection decides those and a rule cannot.
   * `category` and `q` (matched on the folded name) narrow the list, `from` and `to` the rows it adds up, and `only`
   * the merchants. `monthlyCents` does not follow the period: it is `merchantMonthly` of `basis`, the figure Laskut and
   * the summary above a merchant's rows show too.
   */
  async merchantSummaries(f: MerchantFilter): Promise<MerchantList> {
    const basis = f.basis ?? NO_BASIS;
    const part = partSql(f.own?.parts ?? new Map(), "amount_cents");
    const kept = notLeftSql(f.own);
    const told = toldSql(f.own);
    const range = `${kept.sql}${f.from ? " AND booking_date >= ?" : ""}${f.to ? " AND booking_date <= ?" : ""}`;
    const params = [...told.category.params, ...part.params, ...part.params, this.ctx.userId, ...told.moved.params, ...kept.params, ...(f.from ? [f.from] : []), ...(f.to ? [f.to] : [])];
    // the first row of a merchant is its most common category
    const rows = await this.ctx.db.all<{ merchant: string; cat: string; n: number; total: number; income: number; first: string; last: string }>(
      `SELECT merchant, ${told.category.sql} AS cat, COUNT(*) AS n, SUM(CASE WHEN amount_cents < 0 THEN -${part.sql} ELSE 0 END) AS total,
              SUM(CASE WHEN amount_cents > 0 THEN ${part.sql} ELSE 0 END) AS income, MIN(booking_date) AS first, MAX(booking_date) AS last
       FROM transactions WHERE user_id = ? AND ${told.moved.sql} = 0${range}
       GROUP BY merchant, cat ORDER BY merchant, n DESC, cat`,
      params,
    );
    const months = basis.months.length;
    if (!rows.length) return { items: [], months };
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
          category: r.cat,
          count: Number(r.n),
          totalCents: Number(r.total),
          inCents: Number(r.income),
          monthlyCents: null,
          lastDate: r.last,
          rule: rules.get(r.merchant) ?? null,
          otherCategories: [],
        });
        continue;
      }
      // the total covers every category: the page shows the others, so a bank's loan instalments do not read as fees
      m.otherCategories.push({ category: r.cat, count: Number(r.n), totalCents: Number(r.total), inCents: Number(r.income) });
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
    const out = await this.outInRange(basisRange(basis), f.own);
    for (const m of items) m.monthlyCents = merchantMonthly(basis, m.merchant, out.get(m.merchant) ?? 0).monthlyCents;
    return { items, months };
  }

  /** Money out per merchant from `range.from` to `range.to`, own transfers left out; empty without a range. */
  private async outInRange(range: { from: string; to: string } | null, own?: OwnRows): Promise<Map<string, number>> {
    if (!range) return new Map();
    const part = partSql(own?.parts ?? new Map(), "amount_cents");
    const kept = notLeftSql(own);
    const { moved } = toldSql(own);
    const rows = await this.ctx.db.all<{ merchant: string; outc: number }>(
      `SELECT merchant, -SUM(${part.sql}) AS outc FROM transactions
       WHERE user_id = ? AND ${moved.sql} = 0 AND amount_cents < 0${kept.sql} AND booking_date >= ? AND booking_date <= ? GROUP BY merchant`,
      [...part.params, this.ctx.userId, ...moved.params, ...kept.params, range.from, range.to],
    );
    return new Map(rows.map((r) => [String(r.merchant), Number(r.outc)]));
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
  async industryCodes(sharedOwners: readonly string[] = []): Promise<Map<string, RegisterAnswer>> {
    const owners = [...new Set([this.ctx.userId, ...sharedOwners])];
    const rows = await this.ctx.db.all<{ merchant: string; industry_code: string | null; code_set: string | null; company_name: string | null }>(
      `SELECT m.merchant, m.industry_code, m.code_set, m.company_name FROM merchant_industry m
       WHERE m.status = 'found' AND (m.industry_code IS NOT NULL OR m.company_name IS NOT NULL)
         AND EXISTS (SELECT 1 FROM merchant_industry_users r WHERE r.merchant = m.merchant AND r.user_id IN (${owners.map(() => "?").join(", ")}))`,
      owners,
    );
    const out = new Map<string, RegisterAnswer>();
    for (const r of rows) {
      const known = r.industry_code !== null && isIndustryCodeSet(r.code_set);
      out.set(r.merchant, { code: known ? r.industry_code : null, codeSet: known && isIndustryCodeSet(r.code_set) ? r.code_set : null, companyName: r.company_name });
    }
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
