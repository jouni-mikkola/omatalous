/** Second sign-in factors (migrations 0021 and 0029, table user_factor): an authenticator secret, passkeys and recovery code hashes per user. */
import { randomToken } from "../platform/ids.ts";
import type { Row } from "./rows.ts";
import type { Db, Statement } from "./types.ts";

interface TotpFactor {
  id: string;
  /** Sealed with the server's key (security/secretbox.ts), never the plain secret. */
  sealed: string;
  lastStep: number | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function parseTransports(raw: unknown): string[] {
  try {
    const list: unknown = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface Passkey {
  id: string;
  credentialId: string;
  /** The COSE public key, base64url. A public key is not a secret, so it is stored as it is. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** The host it was made for; null on none (a row from before this column). */
  rpId: string | null;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class FactorRepo {
  constructor(private readonly db: Db) {}

  async totp(userId: string): Promise<TotpFactor | null> {
    const r = await this.db.first<Row>("SELECT id, secret, last_step, created_at, last_used_at FROM user_factor WHERE user_id = ? AND kind = 'totp'", [userId]);
    if (!r) return null;
    return {
      id: String(r.id),
      sealed: String(r.secret),
      lastStep: r.last_step === null ? null : Number(r.last_step),
      createdAt: String(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : String(r.last_used_at),
    };
  }

  async hasTotp(userId: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS x FROM user_factor WHERE user_id = ? AND kind = 'totp'", [userId])) !== null;
  }

  /** A second factor of either kind: what the sign-in asks a second step for. */
  async hasAny(userId: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS x FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'passkey')", [userId])) !== null;
  }

  /** A factor that works at `host`: the authenticator app, or a passkey made for that host. */
  async hasFactorFor(userId: string, host: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS x FROM user_factor WHERE user_id = ? AND (kind = 'totp' OR (kind = 'passkey' AND rp_id = ?))", [userId, host])) !== null;
  }

  async passkeys(userId: string): Promise<Passkey[]> {
    const rows = await this.db.all<Row>(
      "SELECT id, credential_id, secret, last_step, transports, rp_id, label, created_at, last_used_at FROM user_factor WHERE user_id = ? AND kind = 'passkey' ORDER BY created_at, id",
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      credentialId: String(r.credential_id),
      publicKey: String(r.secret),
      counter: r.last_step === null ? 0 : Number(r.last_step),
      transports: parseTransports(r.transports),
      rpId: r.rp_id === null ? null : String(r.rp_id),
      label: String(r.label ?? ""),
      createdAt: String(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : String(r.last_used_at),
    }));
  }

  /** Adds a passkey, and the recovery codes when the user has none yet (`hashes` empty otherwise). False when the credential id is taken. */
  async addPasskey(userId: string, p: { credentialId: string; publicKey: string; counter: number; transports: string[]; rpId: string; label: string }, hashes: string[], now: string): Promise<boolean> {
    if ((await this.db.first("SELECT 1 AS x FROM user_factor WHERE credential_id = ?", [p.credentialId])) !== null) return false;
    try {
      await this.db.batch([
        {
          sql: "INSERT INTO user_factor (id, user_id, kind, secret, label, last_step, created_at, last_used_at, credential_id, transports, rp_id) VALUES (?, ?, 'passkey', ?, ?, ?, ?, NULL, ?, ?, ?)",
          params: [randomToken(), userId, p.publicKey, p.label, p.counter, now, p.credentialId, JSON.stringify(p.transports), p.rpId],
        },
        ...this.recoveryRows(userId, hashes, now),
      ]);
    } catch {
      // the unique index: the same credential was added between the check and here
      return false;
    }
    return true;
  }

  async usePasskey(id: string, counter: number, now: string): Promise<void> {
    await this.db.run("UPDATE user_factor SET last_step = ?, last_used_at = ? WHERE id = ? AND kind = 'passkey'", [counter, now, id]);
  }

  /**
   * Takes one passkey away; the recovery codes go with the last second factor. False when the user has no such passkey,
   * or, with `keepOne`, when it is the only factor left: the check and the delete are one statement, so two removals
   * at once cannot take both.
   */
  async removePasskey(userId: string, id: string, keepOne = false): Promise<boolean> {
    const r = await this.db.run(
      "DELETE FROM user_factor WHERE id = ? AND user_id = ? AND kind = 'passkey' AND (? = 0 OR EXISTS (SELECT 1 FROM user_factor o WHERE o.user_id = ? AND o.id <> ? AND o.kind IN ('totp', 'passkey')))",
      [id, userId, keepOne ? 1 : 0, userId, id],
    );
    if (r.changes === 0) return false;
    await this.dropRecoveryWithoutFactor(userId);
    return true;
  }

  /**
   * Takes the authenticator secret away, and the recovery codes when no passkey is left. With `keepOne` it stays unless a
   * passkey is there to take its place; the check and the delete are one statement, as in `removePasskey`. False when
   * it stayed.
   */
  async removeTotp(userId: string, keepOne = false): Promise<boolean> {
    const r = await this.db.run(
      "DELETE FROM user_factor WHERE user_id = ? AND kind = 'totp' AND (? = 0 OR EXISTS (SELECT 1 FROM user_factor o WHERE o.user_id = ? AND o.kind = 'passkey'))",
      [userId, keepOne ? 1 : 0, userId],
    );
    if (r.changes === 0 && keepOne) return false;
    await this.dropRecoveryWithoutFactor(userId);
    return true;
  }

  private async dropRecoveryWithoutFactor(userId: string): Promise<void> {
    await this.db.run(
      "DELETE FROM user_factor WHERE user_id = ? AND kind = 'recovery' AND NOT EXISTS (SELECT 1 FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'passkey'))",
      [userId, userId],
    );
  }

  async recoveryLeft(userId: string): Promise<number> {
    return Number((await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM user_factor WHERE user_id = ? AND kind = 'recovery'", [userId]))?.c ?? 0);
  }

  private recoveryRows(userId: string, hashes: string[], now: string): Statement[] {
    return hashes.map((hash) => ({
      sql: "INSERT INTO user_factor (id, user_id, kind, secret, label, last_step, created_at, last_used_at) VALUES (?, ?, 'recovery', ?, NULL, NULL, ?, NULL)",
      params: [randomToken(), userId, hash, now],
    }));
  }

  /** The factor and its recovery codes in one transaction; whatever the user had before is gone. `step` is the code that confirmed it. */
  async enable(userId: string, sealed: string, step: number, hashes: string[], now: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'recovery')", params: [userId] },
      {
        sql: "INSERT INTO user_factor (id, user_id, kind, secret, label, last_step, created_at, last_used_at) VALUES (?, ?, 'totp', ?, NULL, ?, ?, ?)",
        params: [randomToken(), userId, sealed, step, now, now],
      },
      ...this.recoveryRows(userId, hashes, now),
    ]);
  }

  async replaceRecovery(userId: string, hashes: string[], now: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM user_factor WHERE user_id = ? AND kind = 'recovery'", params: [userId] }, ...this.recoveryRows(userId, hashes, now)]);
  }

  /** Takes a step in one statement: false when it was no later than the last one, so two requests with one code cannot both pass. */
  async useStep(id: string, step: number, now: string): Promise<boolean> {
    const r = await this.db.run("UPDATE user_factor SET last_step = ?, last_used_at = ? WHERE id = ? AND (last_step IS NULL OR last_step < ?)", [step, now, id, step]);
    return r.changes > 0;
  }

  /** Deletes the code's row: false when there was none (never made, or used already). */
  async useRecovery(userId: string, hash: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM user_factor WHERE user_id = ? AND kind = 'recovery' AND secret = ?", [userId, hash])).changes > 0;
  }

  async removeAll(userId: string): Promise<void> {
    await this.db.run("DELETE FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'recovery', 'passkey')", [userId]);
  }

  /** Every sealed secret, for the rotation of the server's key (services/secret-rotation.ts). */
  async allSealed(): Promise<{ id: string; userId: string; sealed: string }[]> {
    return (await this.db.all<Row>("SELECT id, user_id, secret FROM user_factor WHERE kind = 'totp'")).map((r) => ({ id: String(r.id), userId: String(r.user_id), sealed: String(r.secret) }));
  }
}
