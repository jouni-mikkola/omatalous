/** What the user said about a subscription or an alert: in use, cancelled, dismissed. Own rows only. */
import type { MarkKind, UserMark } from "@banking/core";
import type { Row } from "../rows.ts";
import { type FinanceContext, writeBatch } from "./context.ts";

export class MarksRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The user's marks, newest first. */
  async listMarks(): Promise<UserMark[]> {
    const rows = await this.ctx.db.all<Row>("SELECT subject, mark, marked_at FROM user_marks WHERE user_id = ? ORDER BY marked_at DESC, subject", [this.ctx.userId]);
    return rows.map((r) => ({ subject: String(r.subject), mark: String(r.mark) as MarkKind, markedAt: String(r.marked_at) }));
  }

  /** One mark per subject: a later choice replaces the earlier one and takes its time. `at` is an ISO timestamp. */
  async setMark(subject: string, mark: MarkKind, at: string): Promise<void> {
    await this.ctx.db.run(
      "INSERT INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, subject) DO UPDATE SET mark = excluded.mark, marked_at = excluded.marked_at",
      [this.ctx.userId, subject, mark, at],
    );
  }

  async clearMark(subject: string): Promise<void> {
    await this.ctx.db.run("DELETE FROM user_marks WHERE user_id = ? AND subject = ?", [this.ctx.userId, subject]);
  }

  /**
   * A merchant's name was derived again: its mark follows. When the new name has a mark already, that one stays and
   * the old one is dropped.
   */
  async renameMerchantMarks(renames: ReadonlyMap<string, string>): Promise<void> {
    await writeBatch(
      this.ctx.db,
      [...renames].flatMap(([from, to]) => [
        { sql: "UPDATE OR IGNORE user_marks SET subject = ? WHERE user_id = ? AND subject = ?", params: [`merchant:${to}`, this.ctx.userId, `merchant:${from}`] },
        { sql: "DELETE FROM user_marks WHERE user_id = ? AND subject = ?", params: [this.ctx.userId, `merchant:${from}`] },
      ]),
    );
  }
}
