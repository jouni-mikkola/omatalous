// Decision: what the user must act on, as one short list of one-line rows
import { type Insight, insightDismissSubject, type MarkKind, OVERVIEW_INSIGHTS } from "@banking/core";
import { query } from "../api.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import { partAnchor } from "../part.ts";
import type { Account, DashboardData } from "../types.ts";

/** The most rows the list shows; the link to Säästövinkit holds the rest. */
export const MAX_ROWS = 4;

/** The most alerts the list takes in (core cuts at six too); insights stop at core's `OVERVIEW_INSIGHTS`, the data-quality warning is one. */
const MAX_ALERTS = 6;

type Alert = DashboardData["alerts"][number];

/** The tone as a word for a screen reader; only a warning is drawn differently. */
const READ: Record<Insight["tone"], string> = { good: "Hyvä", warning: "Huomio", info: "Tiedoksi" };

/** What a button of a row sends: a mark on a subject (`PUT /api/marks`), or the security notices read (`POST /api/security/notices/seen`). */
export type Send = { subject: string; mark: MarkKind } | "seen";

/** One button of a row. */
interface Answer {
  label: "Käytössä" | "Lopetettu" | "Kuittaa";
  /** The button's accessible name: the label and what it is about. */
  name: string;
  send: Send;
}

export interface Notice {
  /** What `answered` holds for the row: the alert's or the insight's own id, and the security notice's. */
  id: string;
  kind: "security" | "quality" | "account" | "alert" | "insight";
  title: string;
  detail: string;
  /** "Huomio", "Tiedoksi" or "Hyvä", read before the title. */
  read: string;
  warning: boolean;
  href: string | null;
  /** The words of the link, where the row has a link of its own at the right and its text is no link. */
  link?: string;
  answers: Answer[];
}

/** A notice of the server (`/api/security/notices`): `detail` is the device of a sign-in from a new one. */
export interface SecurityNotice {
  id: string;
  kind: string;
  at: string | null;
  text: string;
  detail?: string;
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

const dismiss = (title: string, send: Send): Answer => ({ label: "Kuittaa", name: `Kuittaa: ${title}`, send });

/** "12.10. klo 15.30" in the viewer's own time. */
const dayTime = (iso: string): string => new Date(iso).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * A notice of the server is one row that leads where the banner led, and Kuittaa reads them all, as the banner's button
 * did. A sign-in from a new device is told as a title ("Uusi kirjautuminen 12.10. klo 15.30 (Chrome, Windows)"); every other
 * notice is its own sentence, whole in the title attribute when the line cuts it.
 */
function securityNotice(n: SecurityNotice): Notice {
  const title = n.kind === "new_device" && n.at && n.detail ? `Uusi kirjautuminen ${dayTime(n.at)} (${n.detail})` : n.text;
  const href = n.kind === "industry_lookup_off" ? "#/settings?section=server" : MAINTENANCE.has(n.kind) ? "#/settings?section=maintenance" : `#/settings#${SETTINGS_ANCHOR.login}`;
  return { id: n.id, kind: "security", title, detail: "", read: READ.warning, warning: true, href, answers: [dismiss(title, "seen")] };
}

/**
 * An alert opens its merchant's whole history (a double charge or a forgotten subscription shows in context) or its
 * category's rows of the chosen month. An alert about one payment opens that payee's rows of the payment's day, behind
 * a link that says what to do there. The question about a forgotten service is answered with Käytössä or Lopetettu on
 * that one series; every alert can be set aside with Kuittaa.
 */
function alertNotice(a: Alert, range: { from: string; to: string }): Notice {
  const subject = a.kind === "forgotten" ? a.markSubject : undefined;
  const question: Answer[] =
    subject && a.merchant
      ? [
          { label: "Käytössä", name: `Käytössä: ${a.merchant}`, send: { subject, mark: "in_use" } },
          { label: "Lopetettu", name: `Lopetettu: ${a.merchant}`, send: { subject, mark: "cancelled" } },
        ]
      : [];
  const filter = a.row ? { merchant: a.row.merchant, from: a.row.date, to: a.row.date } : a.merchant ? { merchant: a.merchant } : a.category ? { category: a.category, from: range.from, to: range.to } : null;
  const link = a.kind === "uncategorised" ? { link: "Luokittele" } : {};
  // two rows of one title are told apart by their detail, so the button's name carries it
  const answers = [...question, dismiss(a.row ? `${a.title} ${a.detail}` : a.title, { subject: `alert:${a.id}`, mark: "dismissed" })];
  return { id: a.id, kind: "alert", title: a.title, detail: a.detail, read: READ[a.tone], warning: a.tone === "warning", href: filter && `#/transactions${query(filter)}`, ...link, answers };
}

/** What /meta tells of an account that a notice about its split is built from. */
type Noted = Pick<Account, "id" | "name" | "split" | "offer" | "questions">;

/** A short fixed-length digest of a text (FNV-1a), for a subject that must stay under the mark's length whatever the keys are. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(16);
}

/**
 * The three notices about an account's split, each closed by the member's mark on its subject. The subject holds the figure
 * the notice is about, so a changed figure is another subject and the row comes back: the day the app set the split, the
 * percents of the offer, the keys of the open questions. A mark is `alert:`-prefixed, the form the marks route takes.
 */
function accountNotices(accounts: readonly Noted[]): Notice[] {
  const notice = (a: Noted, subject: string, title: string): Notice => ({
    id: subject,
    kind: "account",
    title,
    detail: "",
    read: READ.info,
    warning: false,
    href: `#/settings#${partAnchor(a.id)}`,
    link: "Katso",
    answers: [dismiss(title, { subject, mark: "dismissed" })],
  });
  return accounts.flatMap((a) => [
    ...(a.split?.by === "app" ? [notice(a, `alert:split:${a.id}:${a.split.at}`, `Tilin ${a.name} jako muuttui`)] : []),
    ...(a.offer ? [notice(a, `alert:offer:${a.id}:${a.offer.map((o) => `${o.userId ?? ""}=${o.percent}`).join(",")}`, `Tilin ${a.name} jako ei vastaa maksuja`)] : []),
    ...(a.questions?.length ? [notice(a, `alert:questions:${a.id}:${digest(a.questions.map((q) => `${q.kind}:${q.key}`).sort().join(","))}`, `Kenen rahaa tilillä ${a.name} on?`)] : []),
  ]);
}

/** Core decides when a changed figure brings a dismissed insight back (`insightDismissSubject`). */
function insightNotice(i: Insight): Notice {
  return {
    id: i.id,
    kind: "insight",
    title: i.title,
    detail: i.detail,
    read: READ[i.tone],
    warning: i.tone === "warning",
    href: i.merchant ? `#/transactions${query({ merchant: i.merchant })}` : null,
    answers: [dismiss(i.title, { subject: insightDismissSubject(i), mark: "dismissed" })],
  };
}

/**
 * The rows in one order: the notices of the server (a new sign-in first), the data-quality warning, the notices of an
 * account's split (those the member has not closed with a mark), the alerts in core's
 * order (six at most), the insights (three at most, and only while Säästövinkit is switched off: with it on, Muut havainnot
 * tells them; one that only tells good news is no row). What the household has answered is left out before the cut, so
 * the next one takes its place. `rows` are the first `MAX_ROWS`, `total` is how many there are, the link to the rest
 * counts them. No row is no list.
 */
export function noticesOf(
  data: Pick<DashboardData, "dataNotice" | "alerts" | "insights">,
  options: {
    range: { from: string; to: string };
    answered: ReadonlySet<string>;
    insights: boolean;
    security?: readonly SecurityNotice[];
    /** The member's own accounts as /meta tells them, and the subjects of their marks. */
    accounts?: readonly Noted[];
    marked?: ReadonlySet<string>;
  },
): { rows: Notice[]; total: number } {
  const { range, answered } = options;
  const banners = new Set(bannersOf(options.security ?? []));
  const security = (options.security ?? []).filter((n) => !banners.has(n));
  const quality: Notice[] = data.dataNotice
    ? [{ id: data.dataNotice.id, kind: "quality", title: data.dataNotice.title, detail: data.dataNotice.detail, read: READ.warning, warning: true, href: `#/settings#${SETTINGS_ANCHOR.quality}`, answers: [] }]
    : [];
  const alerts = data.alerts.filter((a) => !answered.has(a.id)).slice(0, MAX_ALERTS);
  const insights = options.insights ? data.insights.filter((i) => i.tone !== "good" && !answered.has(i.id)).slice(0, OVERVIEW_INSIGHTS) : [];
  const split = accountNotices(options.accounts ?? []).filter((n) => !answered.has(n.id) && !options.marked?.has(n.id));
  const all = [...security.map(securityNotice), ...quality, ...split, ...alerts.map((a) => alertNotice(a, range)), ...insights.map(insightNotice)];
  return { rows: all.slice(0, MAX_ROWS), total: all.length };
}
