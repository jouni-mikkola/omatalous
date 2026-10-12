/**
 * What Asetukset > Palvelin > Etäkäyttö decides from the state the server reports: which block shows, what the admin
 * can do now, what the form starts with. No React here, so the rules are tested without a page.
 */
import type { RemoteAccessState } from "./remote-access-api.ts";

/** The permissions of the Cloudflare API token, as Cloudflare shows them (apps/server providers/cloudflare/api.ts, PERMISSION). */
export const TOKEN_PERMISSIONS = [
  "Zone: Zone: Read",
  "Zone: DNS: Edit",
  "Account: Cloudflare Tunnel: Edit",
  "Account: Access: Apps and Policies: Edit",
  "Account: Access: Organizations, Identity Providers, and Groups: Edit",
] as const;

/** The page where a token is made. No query string: nothing of the copy goes to Cloudflare. */
export const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

/** Where the installer route is written down, for a host whose helper cannot do this. */
export const TUNNEL_GUIDE = "https://github.com/jouni-mikkola/omatalous/blob/main/docs/ADVANCED.md#cloudflare-tunnel";

/** A change waits, Cloudflare is removing its side or a new address is on trial: look again soon. Otherwise now and then. */
export function pollDelay(s: RemoteAccessState): number {
  return s.pending !== null || s.cloudflare.removal === "waiting" || onTrial(s) ? 3000 : 60_000;
}

/** On, and nobody has come in through the new address yet. The server takes it off by itself at `revertAt`. */
export function onTrial(s: RemoteAccessState): boolean {
  return s.access.on && !s.access.confirmed;
}

/** "2026-10-12T11:35:00Z" as the clock time the admin reads, "13.35". */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fi-FI", { hour: "numeric", minute: "2-digit" });
}

/** The time the trial ends is behind us and the server has not taken the address off yet (the helper is busy or off). */
export function trialOverdue(revertAt: string | null, now: number): boolean {
  return revertAt !== null && Date.parse(revertAt) <= now;
}

/** A host the installer made: this page did not make it, so the server refuses to change it from here. Only off is possible. */
export function isInstallerHost(s: RemoteAccessState): boolean {
  return s.access.on && !s.access.emailsKnown;
}

export type Stage =
  /** The copy has its own domain (Caddy): remote access is not set up beside it. */
  | "domain"
  /** The host runs behind the tunnel. */
  | "on"
  /** Cloudflare has what this page made, but the host is not behind it (a failed turning on, or one that waits to be removed). */
  | "left"
  | "off";

export function stageOf(s: RemoteAccessState): Stage {
  if (s.access.on) return "on";
  if (s.access.mode === "domain") return "domain";
  if (s.cloudflare.hostname !== null) return "left";
  return "off";
}

/** Why the helper cannot do this change: it is not there, or it is too old to know the action. */
export function helperProblem(s: RemoteAccessState): "off" | "old" | null {
  if (s.helper.status === "off") return "off";
  if (!s.helper.knowsAccess) return "old";
  return null;
}

/**
 * The server's rule: it answers the exact sentence when one of these fails. The page also waits while Cloudflare is
 * removing its side, so a new turning on does not start in the middle of it.
 */
export function canTurnOn(s: RemoteAccessState): boolean {
  return helperProblem(s) === null && s.token.saved && s.token.usable && s.access.mode !== "domain" && s.pending === null && s.cloudflare.removal !== "waiting" && !isInstallerHost(s);
}

/** The server answers 409 while a change or a removal from Cloudflare waits, because both end with this token. */
export function canRemoveToken(s: RemoteAccessState): boolean {
  return s.pending === null && s.cloudflare.removal !== "waiting";
}

/** Cloudflare's side of the address stays in place until the token has taken it away: the token is needed for the off. */
export function tokenNeededForOff(s: RemoteAccessState): boolean {
  return s.cloudflare.hostname !== null;
}

/** The addresses that reach only the server machine itself (the server's own test, LOCAL_ONLY in services/remote-access.ts). */
const LOCAL_ADDRESS = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/;

export function isLocalAddress(address: string): boolean {
  return LOCAL_ADDRESS.test(address);
}

/**
 * Where the copy answers after an off: "home" (an address on the home network), or "local" when the server machine
 * alone would reach it, the helper has not said where, or the copy is not behind the tunnel and the off changes nothing there.
 */
export function afterOffKind(s: RemoteAccessState): "home" | "local" {
  const address = s.access.afterOff;
  return address !== null && !isLocalAddress(address) ? "home" : "local";
}

/** An off of a host behind the tunnel that leaves the app on the server machine alone is sent only with an explicit choice. */
export function needsLocalChoice(s: RemoteAccessState): boolean {
  return stageOf(s) === "on" && afterOffKind(s) === "local";
}

/**
 * Off is offered while something stands to be taken away, once no change waits and the removal is not already under
 * way. A host behind the tunnel is taken out of it by the helper; what only Cloudflare still has is removed without it.
 */
export function canTurnOff(s: RemoteAccessState): boolean {
  const stage = stageOf(s);
  if (s.pending !== null || s.cloudflare.removal === "waiting") return false;
  if (stage === "on") return helperProblem(s) === null;
  return stage === "left";
}

/** The address the form starts with. Once there is one it stays: another address means off first, then on. */
export function startHostname(s: RemoteAccessState): { host: string; locked: boolean } {
  const known = s.access.on ? (s.access.hostname ?? s.cloudflare.hostname) : s.cloudflare.hostname;
  if (known) return { host: known, locked: true };
  return { host: s.suggestedHostname ?? "", locked: false };
}

/** The emails the form starts with: the list the page set, else the one Cloudflare has, else none. */
export function startEmails(s: RemoteAccessState): string[] {
  if (s.access.on && s.access.emailsKnown) return s.access.emails;
  return s.cloudflare.emails;
}

/** One a line is the way to write them; a comma, a semicolon or a space between two also separates. Case is the server's job. */
export function parseEmails(text: string): string[] {
  return text.split(/[\s,;]+/).filter((e) => e !== "");
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The page's own check, before the password is asked: the same sentences the server answers. Whether an address is
 * valid for Cloudflare is the server's to say.
 */
export function emailProblem(emails: string[]): string | null {
  if (emails.length === 0) return "Anna vähintään yksi sähköpostiosoite, jolla saa kirjautua.";
  if (emails.length > 50) return "Sähköpostiosoitteita voi olla enintään 50.";
  const bad = emails.findIndex((e) => !LOOKS_LIKE_EMAIL.test(e));
  return bad >= 0 ? `Osoite ${bad + 1} ei ole sähköpostiosoite.` : null;
}

/** "https://Talous.Example.fi/" typed into the address field is the address talous.example.fi. */
export function cleanHostname(text: string): string {
  return text.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** "Se näkee verkkotunnuksen x." for one zone, "Se näkee verkkotunnukset x ja y." for more, nothing without one. */
export function zonesSentence(zones: string[]): string {
  if (zones.length === 0) return "";
  return `Se näkee ${zones.length === 1 ? "verkkotunnuksen" : "verkkotunnukset"} ${zoneList(zones)}.`;
}

/** The host the tunnel gives, as far as the state knows it: the change under way, the host that is on, else what Cloudflare has. */
export function tunnelHost(s: RemoteAccessState): string | null {
  return s.pending?.hostname ?? s.access.hostname ?? s.cloudflare.hostname;
}

/**
 * The server stopped answering the page with 403 (`Pääsy estetty.`, plain text) after the page had read the state: the
 * home address no longer answers because remote access is on. A member never has a state, so a 403 without one is hers.
 */
export function homeStoppedAnswering(s: RemoteAccessState | null, errorStatus: number | null): s is RemoteAccessState {
  return errorStatus === 403 && s !== null && (s.access.on || s.pending?.want === "tunnel") && tunnelHost(s) !== null;
}

/** The address of the tunnel host, to open once through Cloudflare's sign-in. */
export function tunnelUrl(host: string): string {
  return `https://${host}`;
}

/** The zones the token sees, a few by name and the rest counted. */
export function zoneList(zones: string[], shown = 4): string {
  if (zones.length <= shown) return zones.length > 1 ? `${zones.slice(0, -1).join(", ")} ja ${zones[zones.length - 1]}` : (zones[0] ?? "");
  return `${zones.slice(0, shown).join(", ")} ja ${zones.length - shown} muuta`;
}
