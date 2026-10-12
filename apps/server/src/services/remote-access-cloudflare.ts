/**
 * Cloudflare as Asetukset > Palvelin > Etäkäyttö (services/remote-access.ts) uses it: the saved API token, a client
 * for it, and every refusal turned into one of a few fixed kinds. Cloudflare's own words stop here.
 */
import { UpstreamError, UserError } from "../platform/errors.ts";
import { CloudflareApi, type Zone } from "../providers/cloudflare/api.ts";
import { CloudflareClient, CloudflareError } from "../providers/cloudflare/client.ts";
import { CloudflareExit, labelFor, type Reporter } from "../providers/cloudflare/reconcile.ts";
import type { Services } from "./context.ts";

/** The sealed API token with what the last check of it saw: `{ keyEnc, savedAt, zones }`. */
export const TOKEN_KEY = "instance_cloudflare";
/** Sealing context: the sealed token opens nowhere else (a bank key's row, another setting). */
export const AAD = "instance:cloudflare";

export interface StoredToken {
  keyEnc: string;
  savedAt: string;
  zones: string[];
}

/** A setting that holds JSON, or null when there is none or it does not parse. */
export async function readJson<T>(s: Services, key: string): Promise<T | null> {
  const raw = await s.settings.get(key);
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The box that seals this copy's secrets, or the sentence an admin reads when APP_SECRET is missing. */
export async function sealedBox(s: Services) {
  const box = await s.secretBox();
  if (!box) throw new UserError("Palvelimen salausavain (APP_SECRET) puuttuu. Katso palvelimen loki.");
  return box;
}

/** The reconcile steps say their progress in English for a terminal. Nobody reads it here. */
export const QUIET: Reporter = { say: () => {}, secret: () => {} };

export type Refusal = "token" | "permission" | "zero-trust" | "taken" | "zone" | "unreachable" | "other";
/** What the admin is told, one sentence per kind. Cloudflare's own message is never passed on. */
export const SAYS: Record<Refusal, string> = {
  token: "Cloudflare ei hyväksynyt API-tunnistetta. Se on väärä, vanhentunut tai poistettu. Tallenna uusi tunniste.",
  permission: "API-tunnisteelta puuttuu tähän tarvittava oikeus. Tarkista tunnisteen oikeudet Cloudflaresta ohjeen mukaan.",
  "zero-trust": "Zero Trust ei ole käytössä tällä Cloudflare-tilillä. Ota se käyttöön Cloudflaren hallinnassa (ilmainen Free-taso riittää) ja yritä uudelleen.",
  taken: "Osoite on jo käytössä Cloudflaressa, eikä tämä asennus ole tehnyt sitä. Valitse toinen osoite tai poista vanha Cloudflaren hallinnasta.",
  zone: "Osoite ei kuulu yhteenkään verkkotunnukseen, jonka API-tunniste näkee. Valitse osoite tunnisteen verkkotunnuksen alta.",
  unreachable: "Cloudflareen ei saatu yhteyttä. Yritä hetken päästä uudelleen.",
  other: "Cloudflare ei hyväksynyt muutosta. Yritä hetken päästä uudelleen.",
};
/** The same kinds for the event list. */
export const SHORT: Record<Refusal, string> = {
  token: "API-tunniste ei kelpaa",
  permission: "API-tunnisteen oikeus puuttuu",
  "zero-trust": "Zero Trust ei ole käytössä",
  taken: "osoite on jo käytössä",
  zone: "osoite ei kuulu tunnisteen verkkotunnuksiin",
  unreachable: "Cloudflare ei vastaa",
  other: "Cloudflare hylkäsi muutoksen",
};

export function refusalOf(e: unknown): Refusal {
  if (e instanceof CloudflareExit) return e.code === 4 ? "zero-trust" : e.reason === "taken" || e.reason === "zone" ? e.reason : "other";
  if (e instanceof CloudflareError) return e.status === 401 ? "token" : e.status === 403 ? "permission" : e.status === 0 || e.status >= 500 ? "unreachable" : "other";
  return "other";
}

/**
 * A failed Cloudflare step as the 502 the browser gets. The log line holds the kind and a status, never the error's
 * own message: Cloudflare's text is outside data and could repeat what was sent to it.
 */
export function upstream(e: unknown, step: string): Error {
  if (e instanceof UserError || e instanceof UpstreamError) return e;
  const kind = refusalOf(e);
  const what = e instanceof CloudflareError ? `HTTP ${e.status}` : e instanceof CloudflareExit ? `stop ${e.code}` : e instanceof Error ? e.name : "error";
  return new UpstreamError(`cloudflare ${step}: ${kind} (${what})`, SAYS[kind]);
}

/**
 * A client for the token that also tells whether a call may have written something. A write Cloudflare refused (4xx)
 * made nothing. One with no answer, or a fault on Cloudflare's side, may have been carried out all the same.
 */
export function clientFor(s: Services, token: string): { api: CloudflareApi; wrote: () => boolean } {
  let wrote = false;
  const send = s.fetch ?? fetch;
  const counting = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const writes = (init?.method ?? "GET") !== "GET";
    try {
      const answer = await send(input, init);
      if (writes && (answer.status < 400 || answer.status >= 500)) wrote = true;
      return answer;
    } catch (e) {
      if (writes) wrote = true;
      throw e;
    }
  }) as typeof fetch;
  return { api: new CloudflareApi(new CloudflareClient(token, counting)), wrote: () => wrote };
}

/** The saved API token, or null: none saved, no app secret, or sealed with another secret. */
export async function openToken(s: Services): Promise<string | null> {
  const stored = await readJson<StoredToken>(s, TOKEN_KEY);
  const box = stored ? await s.secretBox() : null;
  if (!stored || !box) return null;
  try {
    return await box.open(stored.keyEnc, AAD);
  } catch {
    return null;
  }
}

/**
 * A host the installer set up for this copy counts as this copy's: the Access application at it carries the audience
 * tag this app checks (CF_ACCESS_AUD in its `.env`), which only the run that made the application could hand it.
 */
export async function setUpForThisCopy(s: Services, api: CloudflareApi, zone: Zone, hostname: string): Promise<boolean> {
  const aud = s.config.access?.aud;
  if (!aud) return false;
  try {
    return (await api.listApps(zone.accountId)).some((a) => a.domain === hostname && a.name === labelFor(hostname) && a.aud === aud);
  } catch {
    return false;
  }
}
