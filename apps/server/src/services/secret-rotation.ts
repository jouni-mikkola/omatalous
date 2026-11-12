/**
 * Re-seals every bank key, the Cloudflare API token (remote-access.ts) and every second-factor secret
 * (second-factor.ts), the add-on code (modules.ts) and the values the add-on module keeps (extensions.ts) with a new app secret. All sealed values are
 * opened with the old secret first; if any fails nothing is written. The new values are written in one transaction.
 */
import { SecretBox } from "../security/secretbox.ts";
import { AAD, ACTIVE, PENDING } from "../connectors/enable-banking/app-setup.ts";
import { EXTENSIONS, type ExtensionSealed } from "../extensions.ts";
import type { Services } from "./context.ts";
import { AAD as OFFSITE_AAD, KEY as OFFSITE_KEY } from "./offsite.ts";
import { AAD as NOTICES_AAD, KEY as NOTICES_KEY } from "./outside-notices.ts";
import { AAD as MODULE_AAD, KEY as MODULE_KEY } from "./modules.ts";
import { AAD as CLOUDFLARE_AAD, TOKEN_KEY as CLOUDFLARE_KEY } from "./remote-access-cloudflare.ts";

export interface ResealResult {
  userKeys: number;
  instanceKeys: number;
}

type Sealed =
  | { kind: "user"; userId: string; sealed: string }
  | { kind: "factor"; id: string; userId: string; sealed: string }
  | { kind: "extension"; id: string; value: ExtensionSealed; sealed: string }
  | { kind: "instance"; key: string; aad: string; json: Record<string, unknown>; sealed: string };

async function collect(s: Services): Promise<Sealed[]> {
  const out: Sealed[] = [];
  for (const c of await s.users.allBankCredentials()) out.push({ kind: "user", userId: c.userId, sealed: c.privateKeyEnc });
  // each settings key with the context its value was sealed under
  for (const [key, aad] of [[ACTIVE, AAD], [PENDING, AAD], [CLOUDFLARE_KEY, CLOUDFLARE_AAD], [NOTICES_KEY, NOTICES_AAD], [OFFSITE_KEY, OFFSITE_AAD], [MODULE_KEY, MODULE_AAD]] as const) {
    const raw = await s.settings.get(key);
    if (!raw) continue;
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (typeof json.keyEnc === "string") out.push({ kind: "instance", key, aad, json, sealed: json.keyEnc });
  }
  // last, so the Cloudflare token stays what the first check tries (triedAgainstToken)
  for (const f of await s.factors.allSealed()) out.push({ kind: "factor", ...f });
  for (const e of EXTENSIONS) for (const v of (await e.sealed?.(s.db)) ?? []) out.push({ kind: "extension", id: e.id, value: v, sealed: v.sealed });
  return out;
}

/** What a value was sealed under: the user's id for a bank key, `factor:<user id>` for a second-factor secret, else the setting's own context. */
function contextOf(item: Sealed): string {
  if (item.kind === "user") return item.userId;
  if (item.kind === "factor") return `factor:${item.userId}`;
  if (item.kind === "extension") return item.value.context;
  return item.aad;
}

const isToken = (item: Sealed | undefined) => item?.kind === "instance" && item.key === CLOUDFLARE_KEY;

/** The Cloudflare API token is the only sealed value, so it is what a secret is tried against (databaseOpensWith). */
export const triedAgainstToken = async (s: Services): Promise<boolean> => isToken((await collect(s))[0]);

/**
 * The stop for an API token that does not open, with the way past it: the page removes the token for the admin's
 * password alone, and a new one is saved there after the rotation.
 */
export const tokenStops = (how: string) => `The Cloudflare API token saved in Asetukset > Palvelin > Etäkäyttö ${how}. Remove it there and run the rotation again. Nothing was changed.`;

/**
 * True when the first sealed value of each kind (bank key, second factor, each shared setting, each extension) opens
 * with this secret (nothing sealed: true). One value alone would pass a database that holds values of two secrets.
 */
export async function databaseOpensWith(s: Services, secret: string): Promise<boolean> {
  const heads = new Map<string, Sealed>();
  for (const item of await collect(s)) {
    const group = item.kind === "instance" ? `instance:${item.key}` : item.kind === "extension" ? `extension:${item.id}` : item.kind;
    if (!heads.has(group)) heads.set(group, item);
  }
  const box = await SecretBox.fromSecret(secret);
  for (const item of heads.values()) {
    try {
      await box.open(item.sealed, contextOf(item));
    } catch {
      return false;
    }
  }
  return true;
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
      const what = { instance: "shared app", factor: "second-factor", extension: `${item.kind === "extension" ? item.id : ""} sign-in`, user: "user" }[item.kind];
      throw new Error(`A ${what} key cannot be opened with the current secret. Nothing was changed.`);
    }
    const sealed = await newBox.seal(plain, context);
    if (item.kind === "extension") {
      statements.push(item.value.reseal(sealed));
    } else if (item.kind === "factor") {
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
