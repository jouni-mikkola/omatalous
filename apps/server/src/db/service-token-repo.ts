/** Service tokens (migration 0024, table service_tokens): the SHA-256 of each token, never the token. */
import type { Row } from "./rows.ts";
import type { Db } from "./types.ts";

export interface ServiceTokenInfo {
  id: string;
  userId: string;
  username: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

const toInfo = (r: Row): ServiceTokenInfo => ({
  id: String(r.id),
  userId: String(r.user_id),
  username: String(r.username),
  name: String(r.name),
  createdAt: String(r.created_at),
  expiresAt: String(r.expires_at),
  lastUsedAt: r.last_used_at === null ? null : String(r.last_used_at),
  lastUsedIp: r.last_used_ip === null ? null : String(r.last_used_ip),
});

const SELECT = "SELECT t.id, t.user_id, u.username, t.name, t.created_at, t.expires_at, t.last_used_at, t.last_used_ip FROM service_tokens t JOIN users u ON u.id = t.user_id";

export class ServiceTokenRepo {
  constructor(private readonly db: Db) {}

  async create(t: { id: string; tokenHash: string; userId: string; name: string; createdAt: string; expiresAt: string }): Promise<void> {
    await this.db.run("INSERT INTO service_tokens (id, token_hash, user_id, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", [
      t.id,
      t.tokenHash,
      t.userId,
      t.name,
      t.createdAt,
      t.expiresAt,
    ]);
  }

  async byHash(tokenHash: string): Promise<ServiceTokenInfo | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE t.token_hash = ?`, [tokenHash]);
    return r ? toInfo(r) : null;
  }

  async list(): Promise<ServiceTokenInfo[]> {
    return (await this.db.all<Row>(`${SELECT} ORDER BY t.created_at DESC`)).map(toInfo);
  }

  async remove(id: string): Promise<ServiceTokenInfo | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE t.id = ?`, [id]);
    if (!r) return null;
    await this.db.run("DELETE FROM service_tokens WHERE id = ?", [id]);
    return toInfo(r);
  }

  /** Drops the tokens that ended before `now`; the count. */
  async removeExpired(now: string): Promise<number> {
    return (await this.db.run("DELETE FROM service_tokens WHERE expires_at < ?", [now])).changes;
  }

  async touch(id: string, at: string, ip: string | null): Promise<void> {
    await this.db.run("UPDATE service_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?", [at, ip?.slice(0, 64) ?? null, id]);
  }
}
