/**
 * Re-seals every bank key with a new app secret. All sealed values are opened with the old secret first;
 * if any fails nothing is written. The new values are written in one transaction.
 */
import { SecretBox } from "../security/secretbox.ts";
import { AAD, ACTIVE, PENDING } from "../connectors/enable-banking/app-setup.ts";
import type { Services } from "./context.ts";

export interface ResealResult {
  userKeys: number;
  instanceKeys: number;
}

type Sealed = { kind: "user"; userId: string; sealed: string } | { kind: "instance"; key: string; json: Record<string, unknown>; sealed: string };

async function collect(s: Services): Promise<Sealed[]> {
  const out: Sealed[] = [];
  for (const c of await s.users.allBankCredentials()) out.push({ kind: "user", userId: c.userId, sealed: c.privateKeyEnc });
  for (const key of [ACTIVE, PENDING]) {
    const raw = await s.settings.get(key);
    if (!raw) continue;
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (typeof json.keyEnc === "string") out.push({ kind: "instance", key, json, sealed: json.keyEnc });
  }
  return out;
}

/** True when the first sealed value opens with this secret (nothing sealed: true). */
export async function databaseOpensWith(s: Services, secret: string): Promise<boolean> {
  const first = (await collect(s))[0];
  if (!first) return true;
  try {
    await (await SecretBox.fromSecret(secret)).open(first.sealed, first.kind === "user" ? first.userId : AAD);
    return true;
  } catch {
    return false;
  }
}

export async function resealAll(s: Services, oldSecret: string, newSecret: string): Promise<ResealResult> {
  const oldBox = await SecretBox.fromSecret(oldSecret);
  const newBox = await SecretBox.fromSecret(newSecret);
  const items = await collect(s);
  const statements = [];
  const now = s.now().toISOString();
  for (const item of items) {
    const context = item.kind === "user" ? item.userId : AAD;
    let plain: string;
    try {
      plain = await oldBox.open(item.sealed, context);
    } catch {
      throw new Error(`A ${item.kind === "user" ? "user" : "shared app"} key cannot be opened with the current secret. Nothing was changed.`);
    }
    const sealed = await newBox.seal(plain, context);
    if (item.kind === "user") {
      statements.push({ sql: "UPDATE bank_credentials SET private_key_enc = ?, updated_at = ? WHERE user_id = ?", params: [sealed, now, item.userId] });
    } else {
      statements.push({ sql: "UPDATE settings SET value = ?, updated_at = ? WHERE key = ?", params: [JSON.stringify({ ...item.json, keyEnc: sealed }), now, item.key] });
    }
  }
  await s.db.batch(statements);
  return { userKeys: items.filter((i) => i.kind === "user").length, instanceKeys: items.filter((i) => i.kind === "instance").length };
}
