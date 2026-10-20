/** Security events (migration 0005). */
import type { Row } from "./rows.ts";
import type { Db } from "./types.ts";

export interface SecurityEvent {
  id: number;
  at: string;
  userId: string | null;
  /** The user the event concerns, for the list shown to admins. */
  username: string | null;
  kind: string;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
}

export interface NewSecurityEvent {
  at: string;
  userId: string | null;
  kind: string;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
  notify: boolean;
}

const toEvent = (r: Row): SecurityEvent => ({
  id: Number(r.id),
  at: String(r.at),
  userId: r.user_id === null ? null : String(r.user_id),
  username: r.username === null || r.username === undefined ? null : String(r.username),
  kind: String(r.kind),
  ip: r.ip === null ? null : String(r.ip),
  userAgent: r.user_agent === null ? null : String(r.user_agent),
  detail: r.detail === null ? null : String(r.detail),
});

export class SecurityRepo {
  constructor(private readonly db: Db) {}

  async insert(e: NewSecurityEvent): Promise<number> {
    await this.db.run("INSERT INTO security_events (at, user_id, kind, ip, user_agent, detail, notify) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      e.at,
      e.userId,
      e.kind,
      e.ip,
      e.userAgent,
      e.detail,
      e.notify ? 1 : 0,
    ]);
    return Number((await this.db.first<{ id: number }>("SELECT last_insert_rowid() AS id"))?.id ?? 0);
  }

  /** Newest first. `userId` limits the list to one member's events. */
  async list(opts: { userId?: string; kind?: string; kindPrefix?: string; limit: number }): Promise<SecurityEvent[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.userId) {
      where.push("e.user_id = ?");
      params.push(opts.userId);
    }
    if (opts.kind) {
      where.push("e.kind = ?");
      params.push(opts.kind);
    }
    if (opts.kindPrefix) {
      where.push("e.kind LIKE ? ESCAPE '\\'");
      params.push(`${opts.kindPrefix.replace(/[\\%_]/g, "\\$&")}%`);
    }
    params.push(opts.limit);
    return (
      await this.db.all<Row>(
        `SELECT e.*, u.username AS username FROM security_events e LEFT JOIN users u ON u.id = e.user_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.id DESC LIMIT ?`,
        params,
      )
    ).map(toEvent);
  }

  /** True when this user has signed in before from this browser and address range. */
  async hasLoginFrom(userId: string, userAgent: string | null, ipPrefix: string): Promise<boolean> {
    const r = await this.db.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM security_events WHERE user_id = ? AND kind = 'login_ok' AND COALESCE(user_agent, '') = ? AND COALESCE(ip, '') LIKE ? ESCAPE '\\'",
      [userId, userAgent ?? "", `${ipPrefix.replace(/[\\%_]/g, "\\$&")}%`],
    );
    return Number(r?.c ?? 0) > 0;
  }

  async hasAnyLogin(userId: string): Promise<boolean> {
    return Number((await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM security_events WHERE user_id = ? AND kind = 'login_ok'", [userId]))?.c ?? 0) > 0;
  }

  async countSince(userId: string, kind: string, since: string): Promise<number> {
    return Number(
      (await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM security_events WHERE user_id = ? AND kind = ? AND at > ?", [userId, kind, since]))?.c ?? 0,
    );
  }

  /** Unseen notices for a user, oldest first. */
  async unseenNotices(userId: string): Promise<SecurityEvent[]> {
    return (
      await this.db.all<Row>(
        "SELECT e.*, NULL AS username FROM security_events e WHERE e.user_id = ? AND e.notify = 1 AND e.seen_at IS NULL ORDER BY e.id",
        [userId],
      )
    ).map(toEvent);
  }

  async markSeen(userId: string, at: string): Promise<void> {
    await this.db.run("UPDATE security_events SET seen_at = ? WHERE user_id = ? AND notify = 1 AND seen_at IS NULL", [at, userId]);
  }

  /** Keeps the newest `maxRows` events no older than `before`. */
  async prune(before: string, maxRows: number): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM security_events WHERE at < ?", params: [before] },
      { sql: "DELETE FROM security_events WHERE id <= (SELECT id FROM security_events ORDER BY id DESC LIMIT 1 OFFSET ?)", params: [maxRows] },
    ]);
  }
}
