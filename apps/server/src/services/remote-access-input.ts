/** What the browser sends to Asetukset > Palvelin > Etäkäyttö (services/remote-access.ts), checked field by field. */
import { UserError } from "../platform/errors.ts";
import { ACCESS_HOSTNAME, ACCESS_HOSTNAME_MAX } from "./access-request.ts";

/** As many as the installer takes (cli-cloudflare.ts): Cloudflare Zero Trust Free covers 50 users. */
const MAX_EMAILS = 50;

/** Cloudflare's API tokens: 40 characters of this alphabet, the newer ones longer with a prefix (cfut_, cfat_). */
const API_TOKEN = /^[A-Za-z0-9_-]{30,200}$/;
const EMAIL_LOCAL = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*$/;

export function parseApiToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (!API_TOKEN.test(token)) throw new UserError("Tämä ei ole Cloudflaren API-tunniste. Kopioi tunniste Cloudflaresta kokonaan ja ilman välilyöntejä.");
  return token;
}

export function parseHostname(value: unknown): string {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!host || host.length > ACCESS_HOSTNAME_MAX || !ACCESS_HOSTNAME.test(host)) throw new UserError("Anna osoite muodossa talous.oma.fi (ilman https://-alkua ja polkua).");
  return host;
}

/**
 * The addresses Access lets in. They go to Cloudflare and never to the helper, so this is their only check: printable
 * ASCII before anything is lower-cased (a letter that only looks like one is not folded into it), one `@`, a host of
 * the hostname form. An address given twice is kept once.
 */
export function parseEmails(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new UserError("Anna vähintään yksi sähköpostiosoite, jolla saa kirjautua.");
  if (value.length > MAX_EMAILS) throw new UserError(`Sähköpostiosoitteita voi olla enintään ${MAX_EMAILS}.`);
  const out: string[] = [];
  value.forEach((entry, i) => {
    const typed = typeof entry === "string" ? entry.trim() : "";
    const email = /^[\x21-\x7e]{3,254}$/.test(typed) ? typed.toLowerCase() : "";
    const at = email.indexOf("@");
    const local = email.slice(0, Math.max(at, 0));
    // the host pattern has no @ in it, so a second one fails here
    if (at < 1 || local.length > 64 || !EMAIL_LOCAL.test(local) || !ACCESS_HOSTNAME.test(email.slice(at + 1))) throw new UserError(`Osoite ${i + 1} ei ole sähköpostiosoite.`);
    if (!out.includes(email)) out.push(email);
  });
  return out;
}

/** A missing password is the empty one, which checkPassword (ops.ts) refuses as wrong. */
export function parsePassword(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 1024) throw new UserError("Virheellinen kenttä.");
  return value;
}
