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
import type { EnableBankingConfig } from "../../platform/config.ts";
import { EnableBankingClient, EnableBankingError } from "./client.ts";
import { canonicalPrivateKey, KeyProblem } from "../../security/private-key.ts";
import { generateKeyAndCertificate } from "../../security/x509.ts";
import { BANKS, type BankOption, DEFAULT_BANK, findAspsp, offeredFrom } from "./banks.ts";
import type { EbAspsp } from "./types.ts";
import type { Services } from "../../services/context.ts";
import { readJson, sealedBox } from "../../services/remote-access-cloudflare.ts";
import { recordEvent } from "../../services/security.ts";
import type { RequestInfo } from "../../services/users.ts";
import { UserError } from "../../platform/errors.ts";
import { strictObject } from "../../platform/validate.ts";
import { DEFAULT_RELAY_URL, type RedirectMode, redirectModeOf } from "../../services/instance.ts";

export const ACTIVE = "instance_bank_app";
export const PENDING = "instance_bank_app_pending";
/** What the last test of the saved app learned about it (see CheckedApp). */
export const CHECKED = "instance_bank_app_checked";
/** Said when Enable Banking reports the application as not active yet; the wizard shows it as it is. */
export const INACTIVE_MESSAGE = "Sovellus ei ole vielä aktiivinen. Linkitä tilit Enable Bankingissa: Activate by linking accounts.";
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

/**
 * The `active` flag Enable Banking reported at the last test, for the application with this id. Kept so that
 * "Lisää pankkiyhteys" can stay off without a call to Enable Banking on every page load.
 */
interface CheckedApp {
  appId: string;
  active: boolean;
  checkedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAppId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(id)) throw new UserError("Application ID on muotoa 12345678-abcd-… (Control Panel > API applications).");
  return id.toLowerCase();
}

/** The id of the application in use: the saved one, else the one from the environment. The key stays sealed. */
async function activeAppId(s: Services): Promise<string | null> {
  return (await readJson<StoredApp>(s, ACTIVE))?.appId ?? s.config.enableBanking?.appId ?? null;
}

/** The instance-wide credentials in use: saved in the browser, else from the environment. */
export async function instanceCredentials(s: Services): Promise<(EnableBankingConfig & { source: "web" | "env" }) | null> {
  const stored = await readJson<StoredApp>(s, ACTIVE);
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
  /** The project's return page, and the privacy and terms pages beside it that the registration form asks for. */
  relayUrl: string;
  privacyUrl: string;
  termsUrl: string;
  /** Set when the last test found the application not active yet: the sentence to show, and no bank can be connected. */
  inactiveMessage: string | null;
}

/** The addresses the registration form asks for besides the redirect URL: the relay's own pages, on one host. */
export function registrationUrls(s: Services): { relayUrl: string; privacyUrl: string; termsUrl: string } {
  const relayUrl = s.config.bank.relayUrl ?? DEFAULT_RELAY_URL;
  return { relayUrl, privacyUrl: relayPageUrl(relayUrl, "privacy"), termsUrl: relayPageUrl(relayUrl, "terms") };
}

/** A page on the relay site: the return page's sibling folder, so the one relay address decides the host. */
export function relayPageUrl(relayUrl: string, page: "privacy" | "terms"): string {
  const base = new URL(relayUrl);
  // without the slash "../" would leave one folder too many: .../talous/callback is the file callback in .../talous/
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(`../${page}/`, base).toString();
}

/** True when the last test of the app now in use (same Application ID) said Enable Banking does not count it as active. */
async function knownInactive(s: Services, appId: string | null): Promise<boolean> {
  const checked = await readJson<CheckedApp>(s, CHECKED);
  return !!appId && checked?.appId === appId && checked.active === false;
}

/** The shared app is set up, but Enable Banking has said it is not active: no bank can be connected through it yet. */
export async function instanceAppInactive(s: Services): Promise<boolean> {
  return knownInactive(s, await activeAppId(s));
}

export async function bankAppStatus(s: Services): Promise<BankAppStatus> {
  const [stored, pending] = await Promise.all([readJson<StoredApp>(s, ACTIVE), readJson<PendingKey>(s, PENDING)]);
  const source = stored ? "web" : s.config.enableBanking ? "env" : null;
  const appId = stored?.appId ?? s.config.enableBanking?.appId ?? null;
  return {
    source,
    // the env app id is no secret, and only the admin sees this status
    appId,
    savedAt: stored?.savedAt ?? null,
    pendingSince: pending?.createdAt ?? null,
    hasCertificate: !!(pending?.certificatePem ?? stored?.certificatePem),
    canStoreKeys: !!s.config.appSecret,
    redirectUrl: s.redirectUrl(),
    redirectMode: redirectModeOf(s.instance.current),
    ...registrationUrls(s),
    inactiveMessage: (await knownInactive(s, appId)) ? INACTIVE_MESSAGE : null,
  };
}

/** Step 1: a new key pair; replaces an earlier pending one, never the active app. */
export async function generatePendingKey(s: Services): Promise<{ certificatePem: string }> {
  const b = await sealedBox(s);
  const host = new URL(s.instance.current.appBaseUrl).hostname;
  const { privateKeyPem, certificatePem } = await generateKeyAndCertificate({ commonName: `talous ${host}`.slice(0, 64), now: s.now() });
  const pending: PendingKey = { keyEnc: await b.seal(privateKeyPem, AAD), certificatePem, createdAt: s.now().toISOString() };
  await s.settings.set(PENDING, JSON.stringify(pending));
  return { certificatePem };
}

/** The certificate to upload to Enable Banking: the pending one first. */
export async function downloadableCertificate(s: Services): Promise<string | null> {
  const pending = await readJson<PendingKey>(s, PENDING);
  if (pending) return pending.certificatePem;
  return (await readJson<StoredApp>(s, ACTIVE))?.certificatePem ?? null;
}

export interface ActivationResult {
  verified: boolean;
  message: string;
  /** Enable Banking's own `active` flag of the application, when it could be read. */
  active?: boolean;
  /** Enable Banking answered 401: the Application ID and the key do not belong together. */
  keyRefused?: true;
}

/** Step 3: Application ID + the pending key (or an uploaded .pem) become the active app. */
export async function activateBankApp(s: Services, input: unknown): Promise<ActivationResult> {
  const o = strictObject(input, ["appId", "privateKeyPem"] as const);
  const appId = parseAppId(o.appId);
  const b = await sealedBox(s);

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
    const pending = await readJson<PendingKey>(s, PENDING);
    // no new key: a mistyped Application ID is corrected on the key already in use
    const active = pending ? null : await readJson<StoredApp>(s, ACTIVE);
    const key = pending ?? active;
    if (!key) throw new UserError("Luo ensin avain tai valitse Enable Bankingin lataama .pem-tiedosto.");
    stored = { appId, keyEnc: key.keyEnc, certificatePem: key.certificatePem, savedAt: s.now().toISOString() };
  }
  await s.settings.set(ACTIVE, JSON.stringify(stored));
  await s.settings.delete(PENDING);
  return testBankApp(s);
}

/**
 * What a failed Enable Banking call means for the person setting the app up, in plain words. A member's own app
 * (`own`) has no certificate from here: Enable Banking made the key, so the pair is the thing to check.
 */
function probeProblem(err: unknown, saved: boolean, own: boolean): ActivationResult {
  const kept = saved ? " Asetukset on tallennettu." : "";
  if (err instanceof EnableBankingError) {
    if (err.status === 401) {
      const message = own
        ? "Enable Banking ei tunnistanut sovellusta (401). Tarkista, että Application ID ja .pem-tiedosto ovat samasta sovelluksesta."
        : "Enable Banking ei tunnistanut sovellusta (401). Tarkista Application ID ja että Enable Bankingissa on Omatalouden luoma varmenne.";
      return { verified: false, keyRefused: true, message };
    }
    if (err.status === 403) {
      return { verified: false, message: "Enable Banking ei vielä päästä sovellusta pankkeihin (403). Paina Control Panelissa Activate by linking accounts ja valitse pankkisi." };
    }
    return { verified: false, message: `Enable Banking vastasi virheellä ${err.status}.${kept} Yritä myöhemmin uudelleen.` };
  }
  return { verified: false, message: `Enable Bankingiin ei saatu yhteyttä.${kept} Yritä myöhemmin uudelleen.` };
}

/**
 * Enable Banking's `active` flag of the application the key belongs to. A refusal of the key (401, 403) goes on to the
 * caller, which explains it. Any other failure leaves the flag unknown, and the bank list that follows says what is wrong.
 */
async function applicationActive(client: EnableBankingClient): Promise<boolean | undefined> {
  try {
    const { active } = await client.application();
    return typeof active === "boolean" ? active : undefined;
  } catch (err) {
    if (err instanceof EnableBankingError && (err.status === 401 || err.status === 403)) throw err;
    return undefined;
  }
}

/** Signs a request with the given credentials and reads the application and the bank list: proves App ID and key belong together. */
async function probe(s: Services, appId: string, privateKeyPem: string, saved: boolean, own = false): Promise<ActivationResult> {
  try {
    const client = new EnableBankingClient({ appId, privateKeyPem, fetch: s.fetch });
    const active = await applicationActive(client);
    if (active === false) return { verified: false, active, message: INACTIVE_MESSAGE };
    const banks = await client.listAspsps(DEFAULT_BANK.country);
    // the saved application's own list is the one the picker offers banks from
    if (saved) bankLists.set(s, { appId, at: s.now().getTime(), aspsps: banks, ok: true, pending: null });
    const found = BANKS.some((bank) => findAspsp(bank, banks));
    const flag = active === undefined ? {} : { active };
    return found
      ? { verified: true, ...flag, message: "Yhteys toimii." }
      : { verified: false, ...flag, message: "Yhteys toimii, mutta sovelluksen pankkilistalla ei ole yhtään pankkia, jonka Omatalous osaa yhdistää." };
  } catch (err) {
    return probeProblem(err, saved, own);
  }
}

/** A good answer is kept for a day: banks come and go rarely, and the list is read on every page load. */
const BANK_LIST_MS = 24 * 3600_000;
/** A failed call is tried again after this, not on every page load. */
const BANK_LIST_RETRY_MS = 10 * 60_000;
/** A page load waits this long for Enable Banking. A slower answer is used by the next one. */
const BANK_LIST_WAIT_MS = 3000;

/**
 * The live bank list of one application. `aspsps` is the last good answer: null before there was one, and kept while a
 * refresh runs and after one that failed, so a slow or failing Enable Banking does not take the banks away. `ok` says
 * whether the last call answered, which decides how long the entry counts as fresh.
 */
interface BankList {
  appId: string;
  at: number;
  aspsps: EbAspsp[] | null;
  ok: boolean;
  pending: Promise<void> | null;
}
const bankLists = new WeakMap<object, BankList>();

/** Asks Enable Banking for the application's bank list. The promise never rejects: a failed call keeps `previous`'s answer. */
function askBankList(s: Services, appId: string, privateKeyPem: string, previous?: BankList): BankList {
  const list: BankList = { appId, at: s.now().getTime(), aspsps: previous?.appId === appId ? previous.aspsps : null, ok: false, pending: null };
  list.pending = new EnableBankingClient({ appId, privateKeyPem, fetch: s.fetch })
    .listAspsps(DEFAULT_BANK.country)
    .then(
      (aspsps) => {
        list.aspsps = aspsps;
        list.ok = true;
      },
      (err) => {
        // a key or an application Enable Banking refuses is told by the setup test; any other failure gets a line
        const refused = err instanceof EnableBankingError && (err.status === 401 || err.status === 403);
        if (!refused) console.error("bank list:", err instanceof EnableBankingError ? err.message : "no answer from Enable Banking");
      },
    )
    .then(() => {
      list.at = s.now().getTime();
      list.pending = null;
    });
  bankLists.set(s, list);
  return list;
}

/** Waits for a promise that never rejects, at most this long. */
async function atMost(pending: Promise<void> | null, ms: number): Promise<void> {
  if (!pending) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((done) => {
    timer = setTimeout(done, ms);
  });
  await Promise.race([pending, late]);
  clearTimeout(timer);
}

/**
 * The banks the picker offers: those of BANKS that the instance's own application lists at Enable Banking, each
 * named as that list writes it (banks.ts). Nordea alone with no application, with one that is not active yet and
 * when Enable Banking gives no answer, as before the other banks were added. Starting a bank does not read this
 * list: it takes an id of BANKS and asks Enable Banking itself (link.ts).
 */
export async function offeredBanks(s: Services): Promise<BankOption[]> {
  // the id without opening the key, as instanceAppInactive reads it: this runs on every page load
  const appId = await activeAppId(s);
  if (!appId || (await knownInactive(s, appId))) return [DEFAULT_BANK];
  let list = bankLists.get(s);
  if (list?.appId !== appId) list = undefined;
  const fresh = list && !list.pending && s.now().getTime() - list.at < (list.ok ? BANK_LIST_MS : BANK_LIST_RETRY_MS);
  if (!fresh) {
    if (!list?.pending) {
      const creds = await instanceCredentials(s);
      if (!creds) return [DEFAULT_BANK];
      list = askBankList(s, appId, creds.privateKeyPem, list);
    }
    await atMost(list.pending, BANK_LIST_WAIT_MS);
  }
  return list?.aspsps ? offeredFrom(list.aspsps) : [DEFAULT_BANK];
}

/**
 * The live list `offeredBanks` reads, as last answered and without asking for it: null with no application, with one
 * that is not active and before the first answer. The same array as long as that answer is kept, so what hangs on
 * the list (the logos of routes/bank-logos.ts) can live exactly as long as it does.
 */
export async function knownBankList(s: Services): Promise<readonly EbAspsp[] | null> {
  const appId = await activeAppId(s);
  const list = bankLists.get(s);
  return appId && list?.appId === appId && !(await knownInactive(s, appId)) ? list.aspsps : null;
}

/** A member's own Application ID and key tried against Enable Banking before they are saved (credentials.ts). */
export function testOwnKey(s: Services, appId: string, privateKeyPem: string): Promise<ActivationResult> {
  return probe(s, appId, privateKeyPem, false, true);
}

/** Signs a request with the active credentials, reads the application and lists banks. */
export async function testBankApp(s: Services): Promise<ActivationResult> {
  const creds = await instanceCredentials(s);
  if (!creds) return { verified: false, message: "Yhteistä sovellusta ei ole määritetty." };
  const result = await probe(s, creds.appId, creds.privateKeyPem, true);
  if (result.active !== undefined) {
    await s.settings.set(CHECKED, JSON.stringify({ appId: creds.appId, active: result.active, checkedAt: s.now().toISOString() } satisfies CheckedApp));
  } else if (result.verified) {
    // the bank list answered but the flag could not be read: an app that works is not held back by an older answer
    await s.settings.delete(CHECKED);
  }
  return result;
}

const TOO_MANY_TESTS = "Liian monta testiä peräkkäin. Odota muutama minuutti.";
/** The key checkAppId counts under on `s.keyTestLimiter`: one window for the whole instance. No user id reads like it. */
const APP_ID_CHECKS = "app-id";

/**
 * Counts a member's test of their own key (credentials.ts) on `s.keyTestLimiter`: per user, eight in a window of ten
 * minutes that starts with the member's first test. It runs before the key is imported, so a refused test costs no
 * signature and no call to Enable Banking, and the count is made in one step, so parallel requests cannot all pass
 * before the first is counted. The first refusal of a window is a `lockout` event, as with the other limits.
 */
export async function countKeyTest(s: Services, userId: string, req: RequestInfo): Promise<void> {
  const attempt = s.keyTestLimiter.consume(userId, s.now().getTime());
  if (attempt.wait <= 0) return;
  if (attempt.first) await recordEvent(s, { kind: "lockout", userId, ...req, detail: "avaimen testi" });
  throw new UserError(TOO_MANY_TESTS);
}

/**
 * Tries a pasted Application ID with the pending key (or an uploaded one) before anything is saved, so the
 * wizard can say right away what is wrong. Each call is one Enable Banking request, so it is rate limited.
 */
export async function checkAppId(s: Services, input: unknown): Promise<ActivationResult> {
  const o = strictObject(input, ["appId", "privateKeyPem"] as const);
  const appId = parseAppId(o.appId);
  if (s.keyTestLimiter.consume(APP_ID_CHECKS, s.now().getTime()).wait > 0) throw new UserError(TOO_MANY_TESTS);

  let pem: string;
  if (o.privateKeyPem !== undefined) {
    try {
      pem = await canonicalPrivateKey(o.privateKeyPem);
    } catch (err) {
      if (err instanceof KeyProblem) throw new UserError(err.message);
      throw err;
    }
  } else {
    const key = (await readJson<PendingKey>(s, PENDING)) ?? (await readJson<StoredApp>(s, ACTIVE));
    if (!key) throw new UserError("Luo ensin avain tai valitse Enable Bankingin lataama .pem-tiedosto.");
    pem = await (await sealedBox(s)).open(key.keyEnc, AAD);
  }
  return probe(s, appId, pem, false);
}

export async function removeBankApp(s: Services): Promise<void> {
  await s.settings.delete(ACTIVE);
  await s.settings.delete(PENDING);
  await s.settings.delete(CHECKED);
  bankLists.delete(s);
}
