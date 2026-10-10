/**
 * The household's shared Enable Banking application, set up by an admin in
 * the browser:
 *
 *   1. "Luo avain": the server creates an RSA key + self-signed certificate.
 *      The key is sealed with the app secret at once and never leaves the
 *      server; the admin downloads only the (public) certificate.
 *   2. The admin registers the app at Enable Banking with that certificate
 *      and gets an Application ID.
 *   3. "Tallenna" with the Application ID activates the key and tests it
 *      against the API.
 *
 * Alternatively the admin uploads the .pem that Enable Banking generated in
 * the browser (validated and re-encoded, see security/private-key.ts).
 * A saved app wins over EB_APP_ID / EB_PRIVATE_KEY from the environment.
 */
import type { EnableBankingConfig } from "../config.ts";
import { EnableBankingClient, EnableBankingError } from "../providers/enable-banking/client.ts";
import { canonicalPrivateKey, KeyProblem } from "../security/private-key.ts";
import { generateKeyAndCertificate } from "../security/x509.ts";
import { DEFAULT_BANK } from "./banks.ts";
import type { Services } from "./context.ts";
import { UserError } from "./errors.ts";
import { type RedirectMode, redirectModeOf, strictObject } from "./instance.ts";

export const ACTIVE = "instance_bank_app";
export const PENDING = "instance_bank_app_pending";
/** Sealing context: a sealed instance key cannot be copied into a user's row, or the other way round. */
export const AAD = "instance:enablebanking";

interface StoredApp {
  appId: string;
  keyEnc: string;
  /** Present when the key was generated here (so the certificate can be downloaded again). */
  certificatePem: string | null;
  savedAt: string;
}

interface PendingKey {
  keyEnc: string;
  certificatePem: string;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAppId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(id)) throw new UserError("Application ID on muotoa 12345678-abcd-… (Control Panel > API applications).");
  return id.toLowerCase();
}

async function read<T>(s: Services, key: string): Promise<T | null> {
  const raw = await s.settings.get(key);
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function box(s: Services) {
  const b = await s.secretBox();
  if (!b) throw new UserError("Palvelimen salausavain (APP_SECRET) puuttuu. Katso palvelimen loki.");
  return b;
}

/** The instance-wide credentials in use: saved in the browser, else from the environment. */
export async function instanceCredentials(s: Services): Promise<(EnableBankingConfig & { source: "web" | "env" }) | null> {
  const stored = await read<StoredApp>(s, ACTIVE);
  if (stored) {
    const b = await s.secretBox();
    if (!b) console.error("shared bank app is saved but APP_SECRET is missing: it cannot be opened");
    else {
      try {
        return { appId: stored.appId, privateKeyPem: await b.open(stored.keyEnc, AAD), source: "web" };
      } catch {
        // sealed with another app secret (e.g. the secrets volume was recreated): set the app up again
        console.error("shared bank app cannot be decrypted with the current APP_SECRET");
      }
    }
  }
  return s.config.enableBanking ? { ...s.config.enableBanking, source: "env" } : null;
}

/** Cheap check for /api/meta: no decryption. */
export async function hasInstanceCredentials(s: Services): Promise<boolean> {
  return (!!s.config.appSecret && (await s.settings.get(ACTIVE)) !== null) || !!s.config.enableBanking;
}

export interface BankAppStatus {
  source: "web" | "env" | null;
  appId: string | null;
  savedAt: string | null;
  /** A generated key is waiting for its Application ID. */
  pendingSince: string | null;
  /** A certificate can be downloaded (pending, or the active generated one). */
  hasCertificate: boolean;
  /** False without APP_SECRET: nothing can be stored encrypted. */
  canStoreKeys: boolean;
  redirectUrl: string;
  /** How the browser comes back from the bank; decides what the admin registers and how linking is explained. */
  redirectMode: RedirectMode;
}

export async function bankAppStatus(s: Services): Promise<BankAppStatus> {
  const [stored, pending] = await Promise.all([read<StoredApp>(s, ACTIVE), read<PendingKey>(s, PENDING)]);
  const source = stored ? "web" : s.config.enableBanking ? "env" : null;
  return {
    source,
    // the env app id is no secret, and only the admin sees this status
    appId: stored?.appId ?? s.config.enableBanking?.appId ?? null,
    savedAt: stored?.savedAt ?? null,
    pendingSince: pending?.createdAt ?? null,
    hasCertificate: !!(pending?.certificatePem ?? stored?.certificatePem),
    canStoreKeys: !!s.config.appSecret,
    redirectUrl: s.redirectUrl(),
    redirectMode: redirectModeOf(s.instance.current),
  };
}

/** Step 1: a new key pair; replaces an earlier pending one, never the active app. */
export async function generatePendingKey(s: Services): Promise<{ certificatePem: string }> {
  const b = await box(s);
  const host = new URL(s.instance.current.appBaseUrl).hostname;
  const { privateKeyPem, certificatePem } = await generateKeyAndCertificate({ commonName: `talous ${host}`.slice(0, 64), now: s.now() });
  const pending: PendingKey = { keyEnc: await b.seal(privateKeyPem, AAD), certificatePem, createdAt: s.now().toISOString() };
  await s.settings.set(PENDING, JSON.stringify(pending));
  return { certificatePem };
}

/** The certificate to upload to Enable Banking: the pending one first. */
export async function downloadableCertificate(s: Services): Promise<string | null> {
  const pending = await read<PendingKey>(s, PENDING);
  if (pending) return pending.certificatePem;
  return (await read<StoredApp>(s, ACTIVE))?.certificatePem ?? null;
}

export interface ActivationResult {
  verified: boolean;
  message: string;
}

/** Step 3: Application ID + the pending key (or an uploaded .pem) become the active app. */
export async function activateBankApp(s: Services, input: unknown): Promise<ActivationResult> {
  const o = strictObject(input, ["appId", "privateKeyPem"] as const);
  const appId = parseAppId(o.appId);
  const b = await box(s);

  let stored: StoredApp;
  if (o.privateKeyPem !== undefined) {
    let pem: string;
    try {
      pem = await canonicalPrivateKey(o.privateKeyPem);
    } catch (err) {
      if (err instanceof KeyProblem) throw new UserError(err.message);
      throw err;
    }
    stored = { appId, keyEnc: await b.seal(pem, AAD), certificatePem: null, savedAt: s.now().toISOString() };
  } else {
    const pending = await read<PendingKey>(s, PENDING);
    // no new key: a mistyped Application ID is corrected on the key already in use
    const active = pending ? null : await read<StoredApp>(s, ACTIVE);
    const key = pending ?? active;
    if (!key) throw new UserError("Luo ensin avain tai valitse Enable Bankingin lataama .pem-tiedosto.");
    stored = { appId, keyEnc: key.keyEnc, certificatePem: key.certificatePem, savedAt: s.now().toISOString() };
  }
  await s.settings.set(ACTIVE, JSON.stringify(stored));
  await s.settings.delete(PENDING);
  return testBankApp(s);
}

/** What a failed Enable Banking call means for the person setting the app up, in plain words. */
function probeProblem(err: unknown, saved: boolean): ActivationResult {
  const kept = saved ? " Asetukset on tallennettu." : "";
  if (err instanceof EnableBankingError) {
    if (err.status === 401) {
      return { verified: false, message: "Enable Banking ei tunnistanut sovellusta (401). Tarkista, että Application ID on kopioitu kokonaan ja että Enable Bankingiin ladattu varmenne on sama, jonka Omatalous loi." };
    }
    if (err.status === 403) {
      return { verified: false, message: "Enable Banking tunnisti sovelluksen mutta ei vielä anna sen käyttää pankkeja (403). Sovellus on Inactive tai tilejä ei ole linkitetty. Paina Control Panelissa Activate by linking accounts ja valitse Nordea." };
    }
    return { verified: false, message: `Enable Banking vastasi virheellä ${err.status}.${kept} Kokeile myöhemmin uudelleen.` };
  }
  return { verified: false, message: `Enable Bankingiin ei saatu yhteyttä.${kept} Kokeile myöhemmin uudelleen.` };
}

/** Signs a request with the given credentials and lists banks: proves App ID and key belong together. */
async function probe(s: Services, appId: string, privateKeyPem: string, saved: boolean): Promise<ActivationResult> {
  try {
    const client = new EnableBankingClient({ appId, privateKeyPem, fetch: s.fetch });
    const banks = await client.listAspsps(DEFAULT_BANK.country);
    const found = banks.some((a) => a.name.toLowerCase() === DEFAULT_BANK.aspspName.toLowerCase());
    return found
      ? { verified: true, message: "Yhteys toimii." }
      : { verified: false, message: `Yhteys toimii, mutta ${DEFAULT_BANK.name} ei ole sovelluksen pankkilistalla.` };
  } catch (err) {
    return probeProblem(err, saved);
  }
}

/** Signs a request with the active credentials and lists banks. */
export async function testBankApp(s: Services): Promise<ActivationResult> {
  const creds = await instanceCredentials(s);
  if (!creds) return { verified: false, message: "Yhteistä sovellusta ei ole määritetty." };
  return probe(s, creds.appId, creds.privateKeyPem, true);
}

const CHECK_WINDOW_MS = 10 * 60_000;
const CHECK_MAX = 8;
const recentChecks = new WeakMap<object, number[]>();

/**
 * Tries a pasted Application ID with the pending key (or an uploaded one) before anything is saved, so the
 * wizard can say right away what is wrong. Each call is one Enable Banking request, so it is rate limited.
 */
export async function checkAppId(s: Services, input: unknown): Promise<ActivationResult> {
  const o = strictObject(input, ["appId", "privateKeyPem"] as const);
  const appId = parseAppId(o.appId);
  const now = s.now().getTime();
  const recent = (recentChecks.get(s) ?? []).filter((t) => now - t < CHECK_WINDOW_MS);
  if (recent.length >= CHECK_MAX) throw new UserError("Liian monta testiä peräkkäin. Odota muutama minuuttia.");
  recentChecks.set(s, [...recent, now]);

  let pem: string;
  if (o.privateKeyPem !== undefined) {
    try {
      pem = await canonicalPrivateKey(o.privateKeyPem);
    } catch (err) {
      if (err instanceof KeyProblem) throw new UserError(err.message);
      throw err;
    }
  } else {
    const key = (await read<PendingKey>(s, PENDING)) ?? (await read<StoredApp>(s, ACTIVE));
    if (!key) throw new UserError("Luo ensin avain tai valitse Enable Bankingin lataama .pem-tiedosto.");
    pem = await (await box(s)).open(key.keyEnc, AAD);
  }
  return probe(s, appId, pem, false);
}

export async function removeBankApp(s: Services): Promise<void> {
  await s.settings.delete(ACTIVE);
  await s.settings.delete(PENDING);
}
