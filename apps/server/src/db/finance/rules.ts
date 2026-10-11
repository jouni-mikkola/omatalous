/** The user's category rules, including the "all of this merchant" rules that the category settings write. */
import { type CategoryRule, namesUnknownMerchant, type RuleField } from "@banking/core";
import type { Row } from "../rows.ts";
import { type FinanceContext, writeBatch } from "./context.ts";

/** Rules made with "all of this merchant". */
const MERCHANT_RULE_FIELDS = "('merchant', 'merchant_exact')";

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

  async deleteRule(id: number): Promise<void> {
    await this.ctx.db.run("DELETE FROM category_rules WHERE id = ? AND user_id = ?", [id, this.ctx.userId]);
  }
}
