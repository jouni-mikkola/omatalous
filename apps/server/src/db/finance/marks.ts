/** What the user said about a subscription or an alert: in use, cancelled, dismissed. Own rows only. */
import { type MarkKind, renamedMarkSubject, type UserMark } from "@banking/core";
import type { Row } from "../rows.ts";
import type { Statement } from "../types.ts";
import { type FinanceContext, writeBatch } from "./context.ts";
import { LoansRepo } from "./loans.ts";

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
   * Old names that an upgrade makes one name (`groups`: the new name, and the old names with rows, the new name itself
   * among them when it has rows). A mark is copied to the new name only when every old name carries the same one, and
   * the new name has none of its own: a name without the mark is a different choice. What the new name has is never
   * changed, and the old marks stay for a rollback.
   */
  async copyMerchantMarks(groups: ReadonlyMap<string, readonly string[]>): Promise<void> {
    const marks = await this.listMarks();
    const have = new Set(marks.map((m) => m.subject));
    const inserts: Statement[] = [];
    for (const [target, names] of groups) {
      if (names.includes(target)) continue;
      const by = new Map<string, Map<string, UserMark>>();
      for (const name of names) {
        for (const m of marks) {
          const to = renamedMarkSubject(m.subject, new Map([[name, target]]));
          if (to !== null && !have.has(to)) by.set(to, (by.get(to) ?? new Map()).set(name, m));
        }
      }
      for (const [to, from] of by) {
        const all = names.map((name) => from.get(name));
        if (all.some((m) => m === undefined) || new Set(all.map((m) => m!.mark)).size !== 1) continue;
        inserts.push({
          sql: "INSERT OR IGNORE INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, ?, ?)",
          params: [this.ctx.userId, to, all[0]!.mark, all.map((m) => m!.markedAt).sort().at(-1)!],
        });
      }
    }
    await writeBatch(this.ctx.db, inserts);
  }

  /**
   * A merchant's name was derived again: its marks follow, the old one on the merchant, the ones on its series and an
   * "Ei laina" answer on one (core `renamedMarkSubject` knows the subjects). When the new name has that mark already,
   * that one stays and the old one is dropped. A saved loan linked to one of its series gets the new key in the same
   * transaction (finance/loans.ts `seriesKeyMoves`).
   */
  async renameMerchantMarks(renames: ReadonlyMap<string, string>): Promise<void> {
    if (!renames.size) return;
    const moves = (await this.listMarks()).flatMap((m) => {
      const to = renamedMarkSubject(m.subject, renames);
      return to === null ? [] : [{ from: m.subject, to }];
    });
    await writeBatch(this.ctx.db, [
      ...moves.flatMap(({ from, to }) => [
        { sql: "UPDATE OR IGNORE user_marks SET subject = ? WHERE user_id = ? AND subject = ?", params: [to, this.ctx.userId, from] },
        { sql: "DELETE FROM user_marks WHERE user_id = ? AND subject = ?", params: [this.ctx.userId, from] },
      ]),
      ...(await new LoansRepo(this.ctx).seriesKeyMoves(renames)),
    ]);
  }
}
