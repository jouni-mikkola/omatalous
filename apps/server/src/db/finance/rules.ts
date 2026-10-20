/** The user's category rules, including the "all of this merchant" rules that the category settings write. */
import { type CategoryRule, getCategory, namesUnknownMerchant, type RuleField } from "@banking/core";
import type { Row } from "../rows.ts";
import { type FinanceContext, writeBatch } from "./context.ts";

/** Rules made with "all of this merchant". */
const MERCHANT_RULE_FIELDS = "('merchant', 'merchant_exact')";

/** The part of a stored row `settleMerchantRules` reads. */
interface SettleRow {
  merchant: string;
  categorySource: string;
  amountCents: number;
}

/**
 * The money a rule's category reaches, as categorising reads a rule: an income category only money in (+1), a debt one only
 * money out (-1; money in under a debt category is credit drawn, which the reprocess tells), any other both (0): a
 * spending rule also reaches a refund or a sale at the name.
 */
function directionOf(category: string): 1 | -1 | 0 {
  const kind = getCategory(category).kind;
  return kind === "income" ? 1 : kind === "debt" ? -1 : 0;
}
const moneySql = (category: string) => {
  const way = directionOf(category);
  return way > 0 ? " AND amount_cents > 0" : way < 0 ? " AND amount_cents < 0" : "";
};

/** Whether the settle writes this category onto the row: the SQL of `settleMerchantRules` says the same. */
const settleReaches = (category: string, row: Pick<SettleRow, "categorySource" | "amountCents">) =>
  row.categorySource !== "user" && row.categorySource !== "transfer" && (directionOf(category) === 0 || Math.sign(row.amountCents) === directionOf(category));

export class RulesRepo {
  constructor(private readonly ctx: FinanceContext) {}

  async listRules(): Promise<CategoryRule[]> {
    return (await this.ctx.db.all<Row>("SELECT * FROM category_rules WHERE user_id = ? ORDER BY priority, id", [this.ctx.userId])).map((r) => ({
      id: Number(r.id),
      field: String(r.field) as RuleField,
      pattern: String(r.pattern),
      category: String(r.category),
      priority: Number(r.priority),
    }));
  }

  async ruleCount(): Promise<number> {
    return (await this.ctx.db.first<{ n: number }>("SELECT count(*) AS n FROM category_rules WHERE user_id = ?", [this.ctx.userId]))?.n ?? 0;
  }

  async hasMerchantRule(merchant: string): Promise<boolean> {
    return (await this.ctx.db.first(`SELECT 1 FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, [this.ctx.userId, merchant])) !== null;
  }

  /**
   * "All of this merchant": one rule per merchant, the latest choice
   * replacing an earlier one (also a whole-word rule for exactly this name,
   * which older versions made). It matches the exact name only, so "Matti
   * Meikäläinen" does not catch "Mobilepay Matti Meikäläinen", and runs
   * before the other user rules (priority 5): a broader rule made earlier
   * must not keep the merchant's other rows in the old category.
   */
  async setMerchantRule(merchant: string, category: string): Promise<void> {
    await writeBatch(this.ctx.db, [
      { sql: `DELETE FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, params: [this.ctx.userId, merchant] },
      {
        sql: "INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, 'merchant_exact', ?, ?, 5, ?)",
        params: [this.ctx.userId, merchant, category, new Date().toISOString()],
      },
    ]);
  }

  /** Back to automatic. Removes the merchant's "all of this merchant" rules and returns how many there were. */
  async deleteMerchantRules(merchant: string): Promise<number> {
    return (await this.ctx.db.run(`DELETE FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, [this.ctx.userId, merchant])).changes;
  }

  /** Rules a version up to 0.8.3 could store for the placeholder merchant of unnamed rows (core `namesUnknownMerchant`). Returns how many went. */
  async deleteUnknownMerchantRules(): Promise<number> {
    const ids = (await this.listRules()).filter(namesUnknownMerchant).map((r) => r.id!);
    await writeBatch(
      this.ctx.db,
      ids.map((id) => ({ sql: "DELETE FROM category_rules WHERE id = ? AND user_id = ?", params: [id, this.ctx.userId] })),
    );
    return ids.length;
  }

  async addRule(rule: Omit<CategoryRule, "id">): Promise<void> {
    await this.ctx.db.run("INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      this.ctx.userId,
      rule.field,
      rule.pattern,
      rule.category,
      rule.priority,
      new Date().toISOString(),
    ]);
  }

  /** The latest answer for a rule that exists: every rule in `ids` (own rows only) takes the category. */
  async setRuleCategory(ids: readonly number[], category: string): Promise<void> {
    await writeBatch(
      this.ctx.db,
      ids.map((id) => ({ sql: "UPDATE category_rules SET category = ? WHERE id = ? AND user_id = ?", params: [category, id, this.ctx.userId] })),
    );
  }

  /** Keeps "always this category for this merchant" rules working when a merchant's name is re-derived. */
  async renameMerchantRules(renames: ReadonlyMap<string, string>): Promise<void> {
    await writeBatch(
      this.ctx.db,
      [...renames].map(([from, to]) => ({
        sql: `UPDATE category_rules SET pattern = ? WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`,
        params: [to, this.ctx.userId, from],
      })),
    );
  }

  /**
   * For merchants whose names an upgrade makes one with others ("TORI.FI SOFA" and "TORI.FI LASTEN KIRJAT" both become
   * "Tori"): a rule made on one of them must not take the rest, and it cannot follow the new name. Each rule's category
   * is written onto the rows of its own name as the household's own choice (a row set by hand keeps its category) and the
   * rule is deleted, both in one batch. Call it while the rows still carry the old names. A row set by hand, or stored as
   * a transfer, keeps what it has, and a rule reaches only the money its category can describe (`directionOf`). Of two
   * rules that reach a row the lower priority number wins, as in categorising. Returns what the rows got: the category a
   * row of the old name was given, or undefined for a row the rules left alone. A rule on a name of `keep` is not deleted:
   * the old name keeps its rule for a rollback, and no row carries the name.
   */
  async settleMerchantRules(merchants: ReadonlySet<string>, keep: ReadonlySet<string> = new Set()): Promise<(row: SettleRow) => string | undefined> {
    const rules = (await this.listRules()).filter((r) => (r.field === "merchant" || r.field === "merchant_exact") && !namesUnknownMerchant(r) && merchants.has(r.pattern));
    await writeBatch(
      this.ctx.db,
      rules.flatMap((r) => [
        {
          sql: `UPDATE transactions SET category = ?, category_source = 'user' WHERE user_id = ? AND merchant = ? AND category_source NOT IN ('user', 'transfer')${moneySql(r.category)}`,
          params: [r.category, this.ctx.userId, r.pattern],
        },
        ...(keep.has(r.pattern) ? [] : [{ sql: "DELETE FROM category_rules WHERE id = ? AND user_id = ?", params: [r.id!, this.ctx.userId] }]),
      ]),
    );
    return (row) => rules.find((r) => r.pattern === row.merchant && settleReaches(r.category, row))?.category;
  }

  /**
   * Old names that an upgrade makes one name (`groups`: the new name, and the old names with rows, the new name itself
   * among them when it has rows). The household's rule is copied to the new name only when every one of those names
   * carries the same category, and the new name has no other: a name with no rule is a different choice. Otherwise the
   * new name gets nothing, and the rule of each old name is to be settled onto its own rows (`settleMerchantRules`,
   * which the caller asks for the names returned). A rule the new name already has is never deleted or changed, and the
   * old rules stay for a rollback.
   */
  async copyMerchantRules(groups: ReadonlyMap<string, readonly string[]>): Promise<Set<string>> {
    const rules = (await this.listRules()).filter((r) => (r.field === "merchant" || r.field === "merchant_exact") && !namesUnknownMerchant(r));
    const categoryOf = (name: string) => rules.find((r) => r.pattern === name)?.category;
    const settle = new Set<string>();
    for (const [target, names] of groups) {
      const categories = names.map(categoryOf);
      const own = categoryOf(target);
      const agree = categories[0] !== undefined && categories.every((c) => c === categories[0]) && (own === undefined || own === categories[0]);
      if (agree) {
        if (own === undefined) await this.setMerchantRule(target, categories[0]!);
      } else for (const name of names) if (name !== target && categoryOf(name) !== undefined) settle.add(name);
    }
    return settle;
  }

  async deleteRule(id: number): Promise<void> {
    await this.ctx.db.run("DELETE FROM category_rules WHERE id = ? AND user_id = ?", [id, this.ctx.userId]);
  }
}
