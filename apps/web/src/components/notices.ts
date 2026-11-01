// Decision: which notice of the server the household reads first, and where it is mended
import { localeOf, messageFromWire } from "@banking/core";
import { dateTime, language, timeZone } from "../format.ts";
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
}

/** One line of the notices on Yhteenveto: its text and where it leads. */
export interface NoticeLine {
  id: string;
  title: string;
  href: string;
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

/** The day and time of a notice's sentence, as the server's own Finnish text writes it: "24.10. 01.30", in the instance's time zone. */
const whenOf = (at: string): string => new Intl.DateTimeFormat(localeOf(language()), { timeZone: timeZone(), day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at));

/** The sentence of a notice in the member's language; a notice with no code, or one this build does not know, keeps the server's text. */
export function noticeText(n: SecurityNotice): string {
  if (!n.code) return n.text;
  return messageFromWire(n.code, { ...n.params, when: n.at ? whenOf(n.at) : "" }, language()) ?? n.text;
}

/**
 * A notice of the server is one line that leads where the banner led. A sign-in from a new device is told as a title
 * ("Kirjautuminen uudelta laitteelta 12.10. klo 15.30 (Chrome, Windows)"); every other notice is its own sentence.
 */
function lineOf(n: SecurityNotice): NoticeLine {
  const title = n.kind === "new_device" && n.at && n.detail ? t("notice.new_device_title", { when: dateTime(n.at), device: n.detail }) : noticeText(n);
  const href = n.kind === "industry_lookup_off" ? settingsCardHash(SETTINGS_ANCHOR.server) : MAINTENANCE.has(n.kind) ? settingsCardHash(SETTINGS_ANCHOR.maintenance) : settingsCardHash(SETTINGS_ANCHOR.login);
  return { id: n.id, title, href };
}

/** The lines of the notices that are no banner, in the server's order. */
export const securityRows = (notices: readonly SecurityNotice[]): NoticeLine[] => notices.filter((n) => !BANNER_KINDS.has(n.kind)).map(lineOf);
