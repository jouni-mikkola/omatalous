/** The monthly spending goals the user set per category. Own rows only. */
import type { Row } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class CategoryGoalRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The goals in cents by category id; a category with no goal is missing. */
  async categoryGoals(): Promise<Record<string, number>> {
    const rows = await this.ctx.db.all<Row>("SELECT category, monthly_cents FROM category_goal WHERE user_id = ? ORDER BY category", [this.ctx.userId]);
    return Object.fromEntries(rows.map((r) => [String(r.category), Number(r.monthly_cents)]));
  }

  /** One goal per user and category: a later one replaces the earlier. `at` is an ISO timestamp. */
  async setCategoryGoal(category: string, cents: number, at: string): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO category_goal (user_id, category, monthly_cents, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, category) DO UPDATE SET monthly_cents = excluded.monthly_cents, updated_at = excluded.updated_at",
      [this.ctx.userId, category, cents, at],
    );
  }

  async clearCategoryGoal(category: string): Promise<void> {
    await this.ctx.db.run("DELETE FROM category_goal WHERE user_id = ? AND category = ?", [this.ctx.userId, category]);
  }
}
