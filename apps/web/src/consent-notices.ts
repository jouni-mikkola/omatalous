import { date, plural } from "./format.ts";
import type { Account, Connection } from "./types.ts";

/** Notices start this many days before a consent ends; the connections table offers a reconnect from then on. */
export const WARN_DAYS = 14;

/** The applications page of the Enable Banking Control Panel, where Link accounts is. */
export const CONTROL_PANEL = "https://enablebanking.com/cp/applications";

interface ConsentNotice {
  /** The connection the notice is about, or for left_out the account. */
  id: string;
  institution: string;
  /**
   * lapsed: its date passed; broken: closed before its date; expiring: ends within two weeks; left_out: an account that
   * stayed on an ended consent while a newer consent of the bank is active.
   */
  kind: "lapsed" | "broken" | "expiring" | "left_out";
  /** The date a lapsed consent ended. */
  endedOn: string | null;
  daysLeft: number | null;
  /** The account a left_out notice is about. */
  accountName?: string;
}

/**
 * The words for an account a newer consent of its bank did not bring. Connecting again does not help until the
 * account is linked: a restricted application leaves the others out of a session.
 */
export function leftOutText(accountName: string): string {
  return `${accountName} ei tullut mukaan uuteen yhteyteen. Linkitä se Enable Bankingissa (API applications > Omatalous > Link accounts) ja yhdistä uudelleen.`;
}

/**
 * One notice per connection that has ended or ends within two weeks, ended ones first and then the soonest. A
 * consent that ended has its own notice whatever the other consents are. A connection that owns no account is
 * history (its accounts moved to a newer consent) and says nothing. An ended consent that a newer one of the same bank
 * replaced names each account still on it instead: "katkesi" with "Yhdistä uudelleen" would send the user round to
 * a reconnect that cannot move them.
 */
export function consentNotices(connections: readonly Connection[], accounts: readonly Pick<Account, "id" | "name" | "connectionId">[]): ConsentNotice[] {
  const current = connections.filter((c) => !c.history);
  const ended = current.filter((c) => c.state === "lapsed" || c.state === "broken" || (c.state === "removed" && c.replaced));
  const notices = ended.flatMap((c): ConsentNotice[] =>
    c.replaced
      ? accounts
          .filter((a) => a.connectionId === c.id)
          .map((a) => ({ id: a.id, institution: c.institution, kind: "left_out", endedOn: null, daysLeft: null, accountName: a.name }))
      : [{ id: c.id, institution: c.institution, kind: c.state === "lapsed" ? "lapsed" : "broken", endedOn: c.state === "lapsed" ? c.validUntil : null, daysLeft: null }],
  );
  const expiring = current
    .filter((c) => c.state === "active" && c.daysLeft !== null && c.daysLeft <= WARN_DAYS)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .map((c): ConsentNotice => ({ id: c.id, institution: c.institution, kind: "expiring", endedOn: null, daysLeft: c.daysLeft }));
  return [...notices, ...expiring];
}

/** The connection stays active through its last day, so 0 means today. */
export function expiresIn(daysLeft: number): string {
  return daysLeft <= 0 ? "tänään" : daysLeft === 1 ? "huomenna" : `${daysLeft} päivän päästä`;
}

/** The same words as the connections table and Tietojen laatu; a consent that broke shows no date. */
export function consentNoticeText(n: ConsentNotice): string {
  if (n.kind === "left_out") return leftOutText(n.accountName ?? n.institution);
  if (n.kind === "lapsed") return `${n.institution}: yhteys vanhentui${n.endedOn ? ` ${date(n.endedOn)}` : ""}.`;
  if (n.kind === "broken") return `${n.institution}: yhteys katkesi.`;
  return `${n.institution}: yhteys vanhenee ${expiresIn(n.daysLeft ?? 0)}.`;
}

// ── accounts the bank handed over that the app may not read ─────────────────────────

interface UnlinkedAccount {
  id: string;
  institution: string;
  /** The name the bank gives the account (its product name when it gives one). */
  name: string;
  /** "•••• 0785": only the last four digits, of an IBAN or a card. */
  number: string;
}

/**
 * The last four digits of an IBAN, else a card's own mask, else "". This is how the notice shows a number: the
 * member's own page already has the whole IBAN (GET /api/meta), so this hides nothing from the page, it only keeps the
 * notice short.
 */
export function maskedNumber(a: { iban: string | null; cardMask?: string | null }): string {
  const iban = (a.iban ?? "").replace(/\s/g, "");
  return iban.length >= 4 ? `•••• ${iban.slice(-4)}` : (a.cardMask ?? "");
}

/**
 * The accounts of an active connection that the last fetch could not read because they are not linked in the
 * Control Panel. An account whose consent ended has an older story (the notices above), and a fetch that works
 * takes the account off the list by itself.
 */
export function unlinkedAccounts(connections: readonly Connection[], accounts: readonly Pick<Account, "id" | "bankName" | "name" | "iban" | "cardMask" | "connectionId" | "problem">[]): UnlinkedAccount[] {
  const active = new Map(connections.filter((c) => !c.history && c.state === "active").map((c) => [c.id, c.institution]));
  return accounts.flatMap((a) => {
    const institution = a.connectionId ? active.get(a.connectionId) : undefined;
    return institution !== undefined && a.problem?.kind === "not_linked" ? [{ id: a.id, institution, name: a.bankName || a.name, number: maskedNumber(a) }] : [];
  });
}

/** The line above the list. */
export function unlinkedTitle(count: number): string {
  return count === 1 ? "Yksi tili ei ole linkitetty Enable Bankingissa." : `${count} tiliä ei ole linkitetty Enable Bankingissa.`;
}

/** The one step that fixes it: who takes it depends on whose Enable Banking application reads the accounts. */
export function unlinkedStep(count: number, canFix: boolean): string {
  const them = count === 1 ? "se" : "ne";
  const where = "API applications > Omatalous > Link accounts";
  return canFix
    ? `Linkitä ${them} Control Panelissa (${where}). Paina sen jälkeen Hae nyt.`
    : `Ylläpitäjä linkittää ${them} Control Panelissa (${where}). Paina sen jälkeen Hae nyt.`;
}

// ── the calendar reminder ───────────────────────────────────────────────────────────

/** The reminder falls this many days before the consent ends. */
const REMINDER_DAYS = 7;

/** "voimassa 14.1.2027 asti, vielä 93 päivää"; the last day says so. Empty for a consent that is not active. */
export function validityText(c: Pick<Connection, "state" | "validUntil" | "daysLeft">): string {
  if (c.state !== "active" || !c.validUntil) return "";
  if (c.daysLeft === null) return `voimassa ${date(c.validUntil)} asti`;
  if (c.daysLeft <= 0) return "voimassa enää tänään";
  return `voimassa ${date(c.validUntil)} asti, vielä ${plural(c.daysLeft, "päivä", "päivää")}`;
}

/** The day of the reminder (YYYY-MM-DD), counted from the date the page shows for the end. Null without a date. */
export function reminderDay(validUntil: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(validUntil ?? "");
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - REMINDER_DAYS));
  return Number.isNaN(day.getTime()) ? null : day.toISOString().slice(0, 10);
}

/**
 * Text value of an iCalendar property (RFC 5545 3.3.11). CRLF, a lone CR, LF, NEL and the Unicode line and paragraph
 * separators all become the escaped newline, and other control characters are dropped, so a bank name from outside can
 * never end the line it sits in.
 */
function icsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|[\r\n\x85\p{Zl}\p{Zp}]/gu, "\\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** Lines are cut at 75 octets, the rest continues after CRLF and a space (RFC 5545 3.1); a character is never split. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A short code of an id, so the event of one consent keeps its identity in a calendar without the id being in the file. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

interface Reminder {
  /** YYYY-MM-DD */
  day: string;
  filename: string;
  /** The .ics file. */
  ics: string;
}

/**
 * A calendar file with one all-day event seven days before the consent ends. It names the bank, the end date and the
 * address of the app (`origin`, as the page was opened), and nothing of an account. Null without an end date or with
 * an address that is not http or https. `stamp` is the time of the file (DTSTAMP).
 */
export function renewalReminder(c: Pick<Connection, "id" | "institution" | "validUntil">, origin: string, stamp: Date): Reminder | null {
  const day = reminderDay(c.validUntil);
  let address: URL;
  try {
    address = new URL(origin);
  } catch {
    return null;
  }
  if (!day || !c.validUntil || !/^https?:$/.test(address.protocol)) return null;
  const link = `${address.origin}/#/settings`;
  const title = `Omatalous: pankkiyhteys vanhenee ${date(c.validUntil)}`;
  const compact = (iso: string) => iso.replaceAll("-", "");
  const after = new Date(`${day}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Omatalous//Pankkiyhteys//FI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:renewal-${shortHash(c.id)}-${compact(c.validUntil.slice(0, 10))}@omatalous`,
    `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
    `DTSTART;VALUE=DATE:${compact(day)}`,
    `DTEND;VALUE=DATE:${compact(after.toISOString().slice(0, 10))}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(`${c.institution}: yhteys vanhenee ${date(c.validUntil)}. Avaa Omatalous ja valitse Asetukset > Pankkiyhteydet > Yhdistä uudelleen.\n${link}`)}`,
    `URL:${link}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(title)}`,
    "TRIGGER;RELATED=START:PT9H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const slug = c.institution.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${["pankkiyhteys", slug, c.validUntil.slice(0, 10)].filter(Boolean).join("-")}.ics`;
  return { day, filename, ics: `${lines.map(foldLine).join("\r\n")}\r\n` };
}
