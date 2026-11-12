// Decision: which notice of the server the household reads first, and where it is mended
import { messageFromWire } from "@banking/core";
import { dateTime, language } from "../format.ts";
import { t } from "../text.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../routes.ts";

/** A notice of the server (`/api/security/notices`): `detail` is the device of a sign-in from a new one. */
export interface SecurityNotice {
  id: string;
  kind: string;
  at: string | null;
  text: string;
  /** The message code and parameters of the text (the server's security.ts), for the member's language. */
  code?: string;
  params?: Record<string, string | number>;
  detail?: string;
  /** On a notice of an event: whether the user has opened its line or the security log since. A notice of a state has none. */
  seen?: boolean;
}

/** The line of a notice on Yhteenveto: its text, where it leads and whether it tells of events (opening it marks them seen). */
export interface NoticeLine {
  id: string;
  title: string;
  href: string;
  events: boolean;
}

/**
 * The notice that must stop the user on every page, before the first page is reached: a damaged database is in the way
 * of the first page itself (an empty household shows no list). It stays a banner of the shell, and is no row here.
 */
const BANNER_KINDS: ReadonlySet<string> = new Set(["db_damaged"]);

/** The notices of the server that stay a banner of the shell; the others are rows. */
export const bannersOf = (notices: readonly SecurityNotice[]): SecurityNotice[] => notices.filter((n) => BANNER_KINDS.has(n.kind));

/** Notices about copies, the disk and the host helper: their text sends the admin to Asetukset > Ylläpito (the server's db-health.ts). */
const MAINTENANCE = new Set(["copy_missing", "copy_check_failed", "disk_low", "helper_silent"]);

/** The sentence of a notice in the member's language; a notice with no code, or one this build does not know, keeps the server's text. */
export function noticeText(n: SecurityNotice): string {
  if (!n.code) return n.text;
  return messageFromWire(n.code, { ...n.params, when: n.at ? dateTime(n.at) : "" }, language()) ?? n.text;
}

/** A sign-in from a new device is told as a title ("Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)"); every other notice is its own sentence. */
const titleOf = (n: SecurityNotice): string => (n.kind === "new_device" && n.at && n.detail ? t("notice.new_device_title", { when: dateTime(n.at), device: n.detail }) : noticeText(n));

/**
 * The one line Yhteenveto gives the notices, or null: never a list. A notice of a state (a copy, the disk, the helper,
 * the register lookup) needs the admin and stays until it is mended, so the first of them is the line and leads where it
 * is mended. Else the events the user has not seen: one is told by its own title, more by their count, and both lead to
 * Asetukset > Turvallisuus > Turvallisuusloki. Seen events and no notice at all are no line.
 */
export function noticeLine(notices: readonly SecurityNotice[]): NoticeLine | null {
  const rows = notices.filter((n) => !BANNER_KINDS.has(n.kind));
  const state = rows.find((n) => n.seen === undefined);
  if (state) return { id: state.id, title: titleOf(state), href: settingsCardHash(state.kind === "industry_lookup_off" ? SETTINGS_ANCHOR.server : MAINTENANCE.has(state.kind) ? SETTINGS_ANCHOR.maintenance : SETTINGS_ANCHOR.securityLog), events: false };
  const unseen = rows.filter((n) => n.seen === false);
  if (!unseen.length) return null;
  const href = settingsCardHash(SETTINGS_ANCHOR.securityLog);
  return unseen.length === 1 ? { id: unseen[0]!.id, title: titleOf(unseen[0]!), href, events: true } : { id: "events", title: t("notice.new_events", { count: unseen.length }), href, events: true };
}
