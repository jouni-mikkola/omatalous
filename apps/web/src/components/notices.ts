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

/** A line of Asetukset > Turvallisuus: a notice's text, where it is mended (a state's only), and whether it is news to the user. */
export interface NoticeRow {
  id: string;
  title: string;
  /** Where a state is mended; an event is read in the log on the same page, so it has none. */
  href: string | null;
  /** An event the user has not seen: the dot on the user menu counts these. A state lasts until it is mended, so it is never news (it would hold the dot however often the page is read). */
  news: boolean;
}

/** Notices about the disk and the host helper: their text sends the admin to Asetukset > Ylläpito (the server's db-health.ts). */
const MAINTENANCE = new Set(["disk_low", "helper_silent"]);

/** The sentence of a notice in the member's language; a notice with no code, or one this build does not know, keeps the server's text. */
function noticeText(n: SecurityNotice): string {
  if (!n.code) return n.text;
  return messageFromWire(n.code, { ...n.params, when: n.at ? dateTime(n.at) : "" }, language()) ?? n.text;
}

/** A sign-in from a new device is told as a title ("Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)"); every other notice is its own sentence. */
const titleOf = (n: SecurityNotice): string => (n.kind === "new_device" && n.at && n.detail ? t("notice.new_device_title", { when: dateTime(n.at), device: n.detail }) : noticeText(n));

/**
 * The lines Asetukset > Turvallisuus gives the notices: the states that need the admin first, each leading where it is
 * mended, then the events of their time, seen or not.
 */
export function noticeRows(notices: readonly SecurityNotice[]): NoticeRow[] {
  const rows = notices;
  const states = rows.filter((n) => n.seen === undefined).map((n) => ({ id: n.id, title: titleOf(n), href: settingsCardHash(n.kind === "industry_lookup_off" ? SETTINGS_ANCHOR.server : MAINTENANCE.has(n.kind) ? SETTINGS_ANCHOR.maintenance : SETTINGS_ANCHOR.securityLog), news: false }));
  const events = rows.filter((n) => n.seen !== undefined).map((n) => ({ id: n.id, title: titleOf(n), href: null, news: n.seen === false }));
  return [...states, ...events];
}

/** How many lines are news: the count beside the dot on the user menu, 0 for no dot. */
export const newsCount = (notices: readonly SecurityNotice[]): number => noticeRows(notices).filter((r) => r.news).length;
