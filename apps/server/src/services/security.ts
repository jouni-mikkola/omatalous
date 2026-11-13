/**
 * Security events and the notices built from them. Events hold a kind, a
 * time, the address and browser of the request and a short detail, never a
 * password, token or financial data. Maintenance code (ops_* kinds) writes
 * through recordEvent too.
 */
import { LOCALE, type MessageCode } from "@banking/core";
import type { SecurityEvent } from "../db/security-repo.ts";
import { waitingCopy } from "../db/startup-gate.ts";
import type { Services } from "./context.ts";
import { type HealthProbes, healthNotices } from "./db-health.ts";
import { INDUSTRY_NOTICE_KEY } from "./instance.ts";
import { EXTENSIONS } from "../extensions.ts";

export const EVENT_KINDS = [
  "login_ok",
  "login_fail",
  "lockout",
  "new_device",
  "password_changed",
  "password_reset_by_admin",
  "password_rehashed",
  "session_revoked",
  "user_created",
  "user_deleted",
  "role_changed",
  // the bank keys: a member's own application (credentials.ts) and the household's shared one (app-setup.ts)
  "bank_key_saved",
  "bank_key_removed",
  "bank_app_key_made",
  "bank_app_saved",
  "bank_app_removed",
  // the second sign-in factor (second-factor.ts)
  "factor_on",
  "factor_off",
  "factor_removed_by_admin",
  "recovery_codes_made",
  "recovery_code_used",
  // passkeys (passkeys.ts)
  "passkey_added",
  "passkey_removed",
  "passkey_used",
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
  // the first-run wizard finished (routes/admin.ts)
  "setup_completed",
  // read-only keys for scripts and agents (service-tokens.ts)
  "service_token_made",
  "service_token_removed",
  "service_token_used",
  "service_token_refused",
  // a numeric limit changed in the settings (routes/admin.ts, platform/limits.ts)
  "limits_changed",
  // the notices outside the browser turned on or off, or their address or token changed (outside-notices.ts)
  "notices_changed",
  // the target of the copy to another machine, its keys or its switch changed (offsite.ts)
  "offsite_changed",
  // the code of the add-on module and what its check did (services/modules/, docs/MODULES.md)
  "module_code_set",
  "module_code_removed",
  "module_installed",
  "module_refused",
] as const;

/** Maintenance requests and results use kinds that start with ops_. */
const OPS_KIND = /^ops_[a-z0-9_]{1,40}$/;

export const MAX_EVENTS = 2000;
export const EVENT_DAYS = 90;
const DETAIL_MAX = 200;

export function validKind(kind: string): boolean {
  return (EVENT_KINDS as readonly string[]).includes(kind) || OPS_KIND.test(kind) || EXTENSIONS.some((e) => e.securityEvents?.includes(kind));
}

export interface EventInput {
  kind: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
  /** Show it to `userId` as a notice for `NOTICE_HOURS`. */
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
  /** Stable while the notice lasts: an event's `e<number>` or the word of a condition. The list is keyed by it. */
  id: string;
  kind: string;
  at: string | null;
  text: string;
  /** The message code and parameters of the text, for a browser that reads another language; `{when}` is made from `at`. A notice with no code is shown as its text. */
  code?: MessageCode;
  params?: Record<string, string | number>;
  /** The device of a sign-in from a new one ("Chrome, Windows"), for the first page's row; left out on every other notice. */
  detail?: string;
  /**
   * On a notice of an event only (an event's own, or the failed sign-ins of the day): whether the user has opened the
   * first page's line or the security log since it happened (`markNoticesSeen`). A notice of a state has none: it lasts
   * while its cause does.
   */
  seen?: boolean;
}

/**
 * The one name of a rollback. The host helper writes the same words (scripts/lib/ops-watchdog.sh), the watchdog report
 * builds its sentence from them (ops-watchdog.ts) and the security list gives the event this name (web Security.tsx).
 */
export const ROLLBACK_NAME = "Edellinen versio palautettiin";

const INDUSTRY_NOTICE = INDUSTRY_NOTICE_KEY;

/**
 * How long the notice of an event is shown. One about something that happened goes after this time, and is `seen` once
 * the user has opened its line or the security log; one about a state (a full disk, a damaged database) goes when the
 * state ends.
 */
export const NOTICE_HOURS = 72;
/** The settings key of the time a user last opened the line of a notice or the security log (`notices_seen:<user id>`). */
export const NOTICES_SEEN = "notices_seen:";

/** The user has read the notices of the events so far: the first page's line opened, or the security log. */
export async function markNoticesSeen(s: Services, userId: string): Promise<void> {
  await s.settings.set(`${NOTICES_SEEN}${userId}`, s.now().toISOString());
}

/** Failed sign-ins of the last day that make a notice. Fewer are a mistyped password, which needs nothing done. */
export const LOGIN_FAIL_NOTICE = 3;

/** "24.10. klo 1.30": no zero before the hour (docs/UI_STYLE.md, Dates and times). */
export const fiTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: tz, day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * A database that was found damaged at start and stayed (db/startup-gate.ts). Two cases the admin must tell apart:
 * no intact copy at all, or an intact copy that could not be put in place, which room on the disk and a restart mend.
 */
function damagedNotice(detail: string | null): string {
  const copy = waitingCopy(detail);
  // no copy in the data folder: one the household kept elsewhere is put back on the server (docs/ADVANCED.md)
  if (!copy) return "Tietokanta on vaurioitunut, emmekä löytäneet ehjää varmuuskopiota. Palauta muualle tallennettu varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.";
  return `Tietokanta on vaurioitunut. Ehjä varmuuskopio ${copy} on tallessa, mutta emme saaneet sitä käyttöön. Vapauta levyltä tilaa ja käynnistä sovellus uudelleen: sovellus palauttaa varmuuskopion käynnistyksessä. Jos se ei auta, palauta varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.`;
}

/** Who a notice is for: `username` tells an admin's action on their own account (`ownAction`). */
type NoticeUser = { id: string; role: string; username?: string };

/**
 * An admin's reset or factor removal that the user did to their own account: no news to them. The command line is the
 * admin's own tool, so what it did to an admin's account counts as theirs; done to a member, it is told.
 */
function ownAction(e: SecurityEvent, user: NoticeUser): boolean {
  if (e.kind !== "password_reset_by_admin" && e.kind !== "factor_removed_by_admin") return false;
  return (user.username !== undefined && e.detail === `ylläpitäjä ${user.username}`) || (e.detail === "komentorivi" && user.role === "admin");
}

/**
 * The notices of the user now. `userAgent` is the browser that asks: its own sign-in from a new device is not told to
 * it, as whoever sits there knows. `probes`: a made disk in tests.
 */
export async function noticesFor(s: Services, user: NoticeUser, probes?: HealthProbes, userAgent?: string | null): Promise<Notice[]> {
  // two events in the same minute (two resets, say) read the same: one line says it
  const texts = new Set<string>();
  return (await everyNotice(s, user, probes, userAgent)).filter((n) => !texts.has(n.text) && texts.add(n.text));
}

/** Every notice of the user, the ones that read the same included. */
async function everyNotice(s: Services, user: NoticeUser, probes?: HealthProbes, userAgent?: string | null): Promise<Notice[]> {
  const tz = s.instance.current.timezone;
  const out: Notice[] = [];
  // the state of this start, not an event: it is told while the server runs on the damaged file
  if (user.role === "admin" && s.dbDamaged !== undefined) {
    const copy = waitingCopy(s.dbDamaged);
    out.push({ id: "db_damaged", kind: "db_damaged", at: null, text: damagedNotice(s.dbDamaged), ...(copy ? { code: "notice.db_damaged_waiting" as const, params: { copy } } : { code: "notice.db_damaged_none" as const }) });
  }
  const here = userAgent ? userAgent.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200) : null;
  const seenAt = (await s.settings.get(`${NOTICES_SEEN}${user.id}`)) ?? "";
  const events: Notice[] = [];
  for (const e of await s.security.noticeEvents(user.id, new Date(s.now().getTime() - NOTICE_HOURS * 3600_000).toISOString())) {
    if (e.kind === "new_device" && here !== null && e.userAgent === here) continue;
    if (ownAction(e, user)) continue;
    if (e.kind === "password_reset_by_admin") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Ylläpitäjä nollasi salasanasi ${fiTime(e.at, tz)}. Jos et tiennyt siitä, kysy ylläpitäjältä.`, code: "notice.reset_by_admin" });
    else if (e.kind === "new_device") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Tunnuksellasi kirjautui joku uudelta laitteelta (${e.detail ?? "tuntematon"}) ${fiTime(e.at, tz)}. Jos et kirjautunut itse, vaihda salasana ja kirjaa kaikki istunnot ulos.`, code: "notice.new_device", params: { device: e.detail ?? "tuntematon" }, detail: e.detail ?? "tuntematon" });
    else if (e.kind === "factor_removed_by_admin") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Ylläpitäjä poisti kaksivaiheisen kirjautumisen tunnuksestasi ${fiTime(e.at, tz)}. Jos et tiennyt siitä, kysy ylläpitäjältä.`, code: "notice.factor_removed" });
    else if (e.kind === "recovery_code_used") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `Tunnuksellesi kirjautui joku palautuskoodilla ${fiTime(e.at, tz)}. Jos et kirjautunut itse, vaihda salasana ja tee uudet palautuskoodit.`, code: "notice.recovery_used" });
    else if (e.kind === "ops_notice") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? "Ylläpitotoiminto"} ${fiTime(e.at, tz)}. Jos et tiennyt siitä, kysy ylläpitäjältä.` });
    else if (e.kind === "watchdog_notice") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? ROLLBACK_NAME} (${fiTime(e.at, tz)}).` });
    else if (e.kind === "db_restored") events.push({ id: `e${e.id}`, kind: e.kind, at: e.at, text: `${e.detail ?? "Palautimme tietokannan varmuuskopiosta"}. Sen jälkeen tehdyt muutokset katosivat. Haemme pankkitapahtumat uudelleen seuraavassa haussa.` });
  }
  out.push(...events.map((n) => ({ ...n, seen: n.at! <= seenAt })));
  const dayAgo = new Date(s.now().getTime() - 86_400_000).toISOString();
  const failed = await s.security.countSince(user.id, "login_fail", dayAgo);
  if (failed >= LOGIN_FAIL_NOTICE) {
    // seen until a sign-in fails after the user last looked
    const seen = (await s.security.countSince(user.id, "login_fail", seenAt > dayAgo ? seenAt : dayAgo)) === 0;
    out.push({ id: "fails", kind: "login_fail", at: null, text: `Tunnuksellasi epäonnistui ${failed} kirjautumista viime vuorokauden aikana.`, code: "notice.login_fail_many", params: { count: failed }, seen });
  }
  if (user.role === "admin" && (await s.settings.get(INDUSTRY_NOTICE))) {
    out.push({
      id: "industry",
      kind: "industry_lookup_off",
      at: null,
      text: "Kauppiaiden toimialahaku kaupparekisteristä on pois päältä. Ota se käyttöön:",
      code: "notice.industry_off",
    });
  }
  // the safety net: copies, the disk and the host helper (db-health.ts), for admins
  out.push(...(await healthNotices(s, user, probes)));
  return out;
}

export type { SecurityEvent };
