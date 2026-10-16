/**
 * Re-seals every bank key, the Cloudflare API token (remote-access.ts) and every second-factor secret
 * (second-factor.ts) with a new app secret. All sealed values are
 * opened with the old secret first; if any fails nothing is written. The new values are written in one transaction.
 */
import { SecretBox } from "../security/secretbox.ts";
import { AAD, ACTIVE, PENDING } from "../connectors/enable-banking/app-setup.ts";
import type { Services } from "./context.ts";
import { AAD as CLOUDFLARE_AAD, TOKEN_KEY as CLOUDFLARE_KEY } from "./remote-access-cloudflare.ts";

export interface ResealResult {
  userKeys: number;
  instanceKeys: number;
}

type Sealed = { kind: "user"; userId: string; sealed: string } | { kind: "factor"; id: string; userId: string; sealed: string } |{ kind: "instance"; key: string; aad: string; json: Record<string, unknown>; sealed: string };

async function collect(s: Services): Promise<Sealed[]> {
  const out: Sealed[] = [];
  for (const c of await s.users.allBankCredentials()) out.push({ kind: "user", userId: c.userId, sealed: c.privateKeyEnc });
  // each settings key with the context its value was sealed under
  for (const [key, aad] of [[ACTIVE, AAD], [PENDING, AAD], [CLOUDFLARE_KEY, CLOUDFLARE_AAD]] as const) {
    const raw = await s.settings.get(key);
    if (!raw) continue;
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (typeof json.keyEnc === "string") out.push({ kind: "instance", key, aad, json, sealed: json.keyEnc });
  }
  // last, so the Cloudflare token stays what the first check tries (triedAgainstToken)
  for (const f of await s.factors.allSealed()) out.push({ kind: "factor", ...f });
  return out;
}

/** What a value was sealed under: the user's id for a bank key, `factor:<user id>` for a second-factor secret, else the setting's own context. */
const contextOf = (item: Sealed) => (item.kind === "user" ? item.userId : item.kind === "factor" ? `factor:${item.userId}` : item.aad);

const isToken = (item: Sealed | undefined) => item?.kind === "instance" && item.key === CLOUDFLARE_KEY;

/** The Cloudflare API token is the only sealed value, so it is what a secret is tried against (databaseOpensWith). */
export const triedAgainstToken = async (s: Services): Promise<boolean> => isToken((await collect(s))[0]);

/**
 * The stop for an API token that does not open, with the way past it: the page removes the token for the admin's
 * password alone, and a new one is saved there after the rotation.
 */
export const tokenStops = (how: string) => `The Cloudflare API token saved in Asetukset > Palvelin > Etäkäyttö ${how}. Remove it there and run the rotation again. Nothing was changed.`;

/** True when the first sealed value opens with this secret (nothing sealed: true). */
export async function databaseOpensWith(s: Services, secret: string): Promise<boolean> {
  const first = (await collect(s))[0];
  if (!first) return true;
  try {
    await (await SecretBox.fromSecret(secret)).open(first.sealed, contextOf(first));
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
    const context = contextOf(item);
    let plain: string;
    try {
      plain = await oldBox.open(item.sealed, context);
    } catch {
      if (isToken(item)) throw new Error(tokenStops("cannot be opened with the current secret"));
      throw new Error(`A ${item.kind === "instance" ? "shared app" : item.kind === "factor" ? "second-factor" : "user"} key cannot be opened with the current secret. Nothing was changed.`);
    }
    const sealed = await newBox.seal(plain, context);
    if (item.kind === "factor") {
      statements.push({ sql: "UPDATE user_factor SET secret = ? WHERE id = ?", params: [sealed, item.id] });
    } else if (item.kind === "user") {
      statements.push({ sql: "UPDATE bank_credentials SET private_key_enc = ?, updated_at = ? WHERE user_id = ?", params: [sealed, now, item.userId] });
    } else {
      statements.push({ sql: "UPDATE settings SET value = ?, updated_at = ? WHERE key = ?", params: [JSON.stringify({ ...item.json, keyEnc: sealed }), now, item.key] });
    }
  }
  await s.db.batch(statements);
  return { userKeys: items.filter((i) => i.kind === "user").length, instanceKeys: items.filter((i) => i.kind === "instance").length };
}
