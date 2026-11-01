/** The days views were opened (migration 0030, table view_opens). Writes are per user; the admin's list reads every member. */
import type { Row } from "./rows.ts";
import type { Db } from "./types.ts";

export class ViewOpensRepo {
  constructor(private readonly db: Db) {}

  /** The user's rows: the cap on what one member can store. */
  async count(userId: string): Promise<number> {
    const r = await this.db.first<Row>("SELECT COUNT(*) AS n FROM view_opens WHERE user_id = ?", [userId]);
    return Number(r?.n ?? 0);
  }

  /** The user opened these views on `day`: the first day stays, the last day moves forward only. */
  async record(userId: string, views: readonly string[], day: string): Promise<void> {
    for (const view of views) {
      await this.db.run(
        "INSERT INTO view_opens (user_id, view, first_day, last_day) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, view) DO UPDATE SET last_day = MAX(last_day, excluded.last_day), first_day = MIN(first_day, excluded.first_day)",
        [userId, view, day, day],
      );
    }
  }

  /** Per view, the latest day any member opened it, and the day anyone first did (`since`, null before any open). */
  async lastOpened(): Promise<{ since: string | null; views: { view: string; lastDay: string }[] }> {
    const rows = await this.db.all<Row>("SELECT view, MAX(last_day) AS last_day FROM view_opens GROUP BY view ORDER BY last_day, view");
    const first = await this.db.first<Row>("SELECT MIN(first_day) AS d FROM view_opens");
    return { since: first?.d == null ? null : String(first.d), views: rows.map((r) => ({ view: String(r.view), lastDay: String(r.last_day) })) };
  }
}
