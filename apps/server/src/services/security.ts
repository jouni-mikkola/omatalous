/**
 * Security events and the notices built from them. Events hold a kind, a
 * time, the address and browser of the request and a short detail, never a
 * password, token or financial data. Maintenance code (ops_* kinds) writes
 * through recordEvent too.
 */
import type { SecurityEvent } from "../db/security-repo.ts";
import { waitingCopy } from "../db/startup-gate.ts";
import type { Services } from "./context.ts";
import { type HealthProbes, healthNotices, markHealthSeen } from "./db-health.ts";
import { INDUSTRY_NOTICE_KEY } from "./instance.ts";

export const EVENT_KINDS = [
  "login_ok",
  "login_fail",
  "lockout",
  "new_device",
  "password_changed",
  "password_reset_by_admin",
  "session_revoked",
  "user_created",
  "user_deleted",
  // Asetukset > Palvelin > Etäkäyttö (remote-access.ts)
  "remote_access_on",
  "remote_access_off",
  "remote_access_failed",
  "remote_access_reverted",
  "cloudflare_token_saved",
  "cloudflare_token_removed",
  // an update the host helper took back by itself, as it is told to each admin (ops-watchdog.ts; the event is ops_watchdog)
  "watchdog_notice",
  // the check before the start (db/startup-gate.ts)
  "db_damaged",
  "db_restored",
  // the household's data emptied from the browser (reset.ts)
  "data_reset",
] as const;

/** Maintenance requests and results use kinds that start with ops_. */
const OPS_KIND = /^ops_[a-z0-9_]{1,40}$/;

export const MAX_EVENTS = 2000;
export const EVENT_DAYS = 90;
const DETAIL_MAX = 200;

export function validKind(kind: string): boolean {
  return (EVENT_KINDS as readonly string[]).includes(kind) || OPS_KIND.test(kind);
}

export interface EventInput {
  kind: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
  /** Show it once to `userId` as a notice. */
  notify?: boolean;
}

/** Control characters out, length capped: the detail may hold a user name typed by a stranger. */
const clean = (v: string | null | undefined, max: number) => (v ? v.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max) : null);

export async function recordEvent(s: Services, e: EventInput): Promise<void> {
  if (!validKind(e.kind)) throw new Error(`unknown security event kind: ${e.kind.slice(0, 40)}`);
  try {
    const id = await s.security.insert({
      at: s.now().toISOString(),
      userId: e.userId ?? null,
      kind: e.kind,
      ip: clean(e.ip, 64),
      userAgent: clean(e.userAgent, 200),
      detail: clean(e.detail, DETAIL_MAX),
      notify: !!e.notify,
    });
    if (id % 200 === 0) await pruneEvents(s);
    // fixed key=value line, so docker logs can be searched for these
    if (e.kind === "login_fail" || e.kind === "lockout" || e.kind === "new_device") {
      console.log(`security event=${e.kind} ip=${clean(e.ip, 64) ?? "-"}`);
    }
  } catch (err) {
    // a full disk or a locked database must not turn a login into an error
    console.error("security event not recorded:", (err as Error).message);
  }
}

export async function pruneEvents(s: Services): Promise<void> {
  await s.security.prune(new Date(s.now().getTime() - EVENT_DAYS * 86_400_000).toISOString(), MAX_EVENTS);
}

/** "Chrome, Windows" from a User-Agent header: enough to recognise one's own devices. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Tuntematon laite";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Selain";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux|X11/.test(ua) ? "Linux" : null;
  return os ? `${browser}, ${os}` : browser;
}

/** The part of an address that stays the same for a device at home: /24 for IPv4, the first four groups for IPv6. */
export function ipPrefix(ip: string): string {
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}:`;
  return ip;
}

/** Records a successful login, and a new_device notice when this browser and address range is new to a user who has logged in before. */
export async function recordLogin(s: Services, userId: string, ip: string, userAgent: string | null): Promise<void> {
  const known = await s.security.hasAnyLogin(userId);
  const sameDevice = known && (await s.security.hasLoginFrom(userId, userAgent, ipPrefix(ip)));
  await recordEvent(s, { kind: "login_ok", userId, ip, userAgent });
  if (known && !sameDevice) {
    await recordEvent(s, { kind: "new_device", userId, ip, userAgent, detail: deviceLabel(userAgent), notify: true });
  }
}

// ── notices ──────────────────────────────────────────────

export interface Notice {
  /** Stable id for the dismissal; see dismissNotices. */
  id: string;
  kind: string;
  at: string | null;
  text: string;
}

/**
 * The one name of a rollback. The host helper writes the same words (scripts/lib/ops-watchdog.sh), the watchdog report
 * builds its sentence from them (ops-watchdog.ts) and the security list gives the event this name (web Security.tsx).
 */
export const ROLLBACK_NAME = "Edellinen versio palautettiin";

const INDUSTRY_NOTICE = INDUSTRY_NOTICE_KEY;
const failSeenKey = (userId: string) => `notice_fail_seen:${userId}`;

export const fiTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("fi-FI", { timeZone: tz, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * A database that was found damaged at start and stayed (db/startup-gate.ts). Two cases the admin must tell apart:
 * no intact copy at all, or an intact copy that could not be put in place, which room on the disk and a restart mend.
 */
function damagedNotice(detail: string | null): string {
  const copy = waitingCopy(detail);
  // no copy in the data folder: one the household kept elsewhere is put back on the server (docs/ADVANCED.md)
  if (!copy) return "Tietokanta on vaurioitunut, eikä ehjää varmuuskopiota löytynyt. Palauta muualle tallennettu varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.";
  return `Tietokanta on vaurioitunut. Ehjä varmuuskopio ${copy} on tallessa, mutta sitä ei saatu käyttöön. Vapauta levyltä tilaa ja käynnistä sovellus uudelleen: varmuuskopio palautetaan käynnistyksessä. Jos se ei auta, palauta varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.`;
}

/** `probes`: a made disk in tests. */
export async function noticesFor(s: Services, user: { id: string; role: string }, probes?: HealthProbes): Promise<Notice[]> {
  const tz = s.instance.current.timezone;
  const out: Notice[] = [];
  for (const e of await s.security.unseenNotices(user.id)) {
    if (e.kind === "password_reset_by_admin") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Ylläpitäjä nollasi salasanasi ${fiTime(e.at, tz)}. Jos et tiennyt siitä, kysy ylläpitäjältä.` });
    else if (e.kind === "new_device") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Tunnuksellasi kirjauduttiin uudelta laitteelta (${e.detail ?? "tuntematon"}) ${fiTime(e.at, tz)}. Jos et kirjautunut itse, vaihda salasana ja kirjaa kaikki istunnot ulos.` });
    else if (e.kind === "ops_notice") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? "Ylläpitotoiminto"} ${fiTime(e.at, tz)}. Jos et tiennyt siitä, kysy ylläpitäjältä.` });
    else if (e.kind === "watchdog_notice") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? ROLLBACK_NAME} (${fiTime(e.at, tz)}).` });
    else if (e.kind === "db_restored") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? "Tietokanta palautettiin varmuuskopiosta"}. Sen jälkeen tehdyt muutokset menetettiin. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.` });
    else if (e.kind === "db_damaged") out.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: damagedNotice(e.detail) });
  }
  const mark = await s.settings.get(failSeenKey(user.id));
  const since = mark && mark > new Date(s.now().getTime() - 86_400_000).toISOString() ? mark : new Date(s.now().getTime() - 86_400_000).toISOString();
  const failed = await s.security.countSince(user.id, "login_fail", since);
  if (failed > 0) {
    out.push({ id: "fails", kind: "login_fail", at: null, text: `${failed === 1 ? "Yksi epäonnistunut kirjautuminen" : `${failed} epäonnistunutta kirjautumista`} tunnuksellasi viime vuorokauden aikana.` });
  }
  if (user.role === "admin" && (await s.settings.get(INDUSTRY_NOTICE))) {
    out.push({
      id: "industry",
      kind: "industry_lookup_off",
      at: null,
      text: "Kauppiaiden toimialahaku YTJ:stä on pois päältä. Ota se käyttöön:",
    });
  }
  // the safety net: copies, the disk and the host helper (db-health.ts), for admins
  out.push(...(await healthNotices(s, user, probes)));
  return out;
}

/**
 * Marks the user's notices as read. The changed default is cleared for every admin; a notice about the safety net
 * is marked for this admin alone and comes back when its condition does (db-health.ts).
 */
export async function dismissNotices(s: Services, user: { id: string; role: string }, probes?: HealthProbes): Promise<void> {
  const now = s.now().toISOString();
  await s.security.markSeen(user.id, now);
  await s.settings.set(failSeenKey(user.id), now);
  if (user.role === "admin") await s.settings.delete(INDUSTRY_NOTICE);
  await markHealthSeen(s, user, probes);
}

export type { SecurityEvent };
