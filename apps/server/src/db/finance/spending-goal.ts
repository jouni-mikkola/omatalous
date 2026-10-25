/** The monthly spending goal the user set. Own row only. */
import type { Row } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class SpendingGoalRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The goal in cents, null when the user has none. */
  async spendingGoal(): Promise<number | null> {
    const row = await this.ctx.db.first<Row>("SELECT monthly_cents FROM spending_goal WHERE user_id = ?", [this.ctx.userId]);
    return row ? Number(row.monthly_cents) : null;
  }

  /** One goal per user: a later one replaces the earlier. `at` is an ISO timestamp. */
  async setSpendingGoal(cents: number, at: string): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO spending_goal (user_id, monthly_cents, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET monthly_cents = excluded.monthly_cents, updated_at = excluded.updated_at",
      [this.ctx.userId, cents, at],
    );
  }

  async clearSpendingGoal(): Promise<void> {
    await this.ctx.db.run("DELETE FROM spending_goal WHERE user_id = ?", [this.ctx.userId]);
  }
}
