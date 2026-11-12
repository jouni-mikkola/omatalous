/**
 * Notices outside the browser (Asetukset > Palvelin), off by default. When an admin turns them on, the hourly tick sends
 * a short message (in the language of the admin who saved the setting) to a webhook (an https address) or to an ntfy topic for four things: a bank consent about to
 * end, a low disk, a database copy that is missing or failed its check, and an update the host helper took back.
 *
 * Decision: the household learns of what needs a person without opening the app. A message says what happened and
 * where in the app to look; it holds no sum, account number, bank name or person's name. The address and the token are
 * sealed in one value under their own context (the address is a secret too: a webhook's path, a topic's name) and are
 * never returned or logged. Each event is sent once: its key is claimed before the send and released if the send fails.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type Language, isLanguage, WARN_DAYS } from "@banking/core";
import { UserError } from "../platform/errors.ts";
import { parseBoolean, parseNoticeAddress, parseNoticeToken } from "../platform/validate.ts";
import { connectionView } from "./accounts.ts";
import type { Services } from "./context.ts";
import { conditions, type HealthProbes } from "./db-health.ts";
import { recordEvent } from "./security.ts";

/** The row: `{ enabled, keyEnc }`. `keyEnc` is the sealed `{ address, token }`. */
export const KEY = "instance_notices";
/** Sealing context: the sealed value opens nowhere else. */
export const AAD = "instance:notices";

/** The public ntfy server a bare topic goes to. */
const NTFY_HOST = "ntfy.sh";

const SENT_PREFIX = "notice_sent:";
/** Longer than any condition lasts in practice; a sent key older than this may be sent again. */
const SENT_KEEP_MS = 400 * 86_400_000;
const SEND_TIMEOUT_MS = 10_000;

interface Row {
  enabled: boolean;
  keyEnc: string | null;
  /** The language of the admin who saved the setting last: the message goes to a phone with no member behind it. */
  language: Language;
}
interface Target {
  address: string;
  token: string | null;
}

type NoticeKind = "consent" | "disk" | "backup" | "update";

/** The words of each notice. No number, name or amount: only what happened and where to look. */
const TEXTS: Record<Language, Record<NoticeKind, { title: string; message: string }>> = {
  fi: {
    consent: { title: "Pankkisuostumus päättyy pian", message: "Uusi suostumus ennen kuin pankin haku pysähtyy. Katso Asetukset > Pankit ja tilit." },
    disk: { title: "Palvelimen levy on lähes täynnä", message: "Siivoa levy ennen kuin tallennus pysähtyy. Katso Asetukset > Palvelin ja ylläpito." },
    backup: { title: "Varmuuskopio ei ole kunnossa", message: "Ehjää varmuuskopiota ei ole tuoreena. Ota uusi kopio kohdassa Asetukset > Palvelin ja ylläpito." },
    update: { title: "Päivitys palautettiin", message: "Edellinen versio palautettiin, koska päivitys ei onnistunut. Katso Asetukset > Palvelin ja ylläpito." },
  },
  en: {
    consent: { title: "Bank consent ends soon", message: "Renew the consent before the bank sync stops. See Settings > Banks and accounts." },
    disk: { title: "The server disk is almost full", message: "Free some space before saving stops. See Settings > Server and maintenance." },
    backup: { title: "The backup is not in order", message: "There is no recent intact backup. Take a new one in Settings > Server and maintenance." },
    update: { title: "The update was taken back", message: "The previous version was restored because the update failed. See Settings > Server and maintenance." },
  },
};

async function readRow(s: Services): Promise<Row> {
  const raw = await s.settings.get(KEY);
  try {
    const j = raw ? (JSON.parse(raw) as Partial<Row>) : {};
    return { enabled: j.enabled === true, keyEnc: typeof j.keyEnc === "string" ? j.keyEnc : null, language: isLanguage(j.language) ? j.language : "fi" };
  } catch {
    return { enabled: false, keyEnc: null, language: "fi" };
  }
}

async function openTarget(s: Services, row: Row): Promise<Target | null> {
  if (!row.keyEnc) return null;
  const box = await s.secretBox();
  if (!box) return null;
  try {
    const j = JSON.parse(await box.open(row.keyEnc, AAD)) as Partial<Target>;
    return typeof j.address === "string" ? { address: j.address, token: typeof j.token === "string" ? j.token : null } : null;
  } catch {
    return null;
  }
}

/** What the browser may see: whether it is on, where it goes by host only, and whether a token is kept. Never the address or the token. */
export async function noticesView(s: Services) {
  const row = await readRow(s);
  const target = await openTarget(s, row);
  const host = target ? (target.address.startsWith("https://") ? new URL(target.address).hostname : NTFY_HOST) : null;
  return { enabled: row.enabled, configured: target !== null, kind: target ? (target.address.startsWith("https://") ? ("webhook" as const) : ("ntfy" as const)) : null, host, hasToken: !!target?.token, secret: { available: !!s.config.appSecret } };
}

/**
 * `{ enabled?, address?, token? }`, already checked for other keys by the route. An absent field stays as it is; `token: null` takes the token away. Turning on needs
 * an address. Every change is a security event that names what changed, never a value.
 */
export async function saveNotices(s: Services, o: Partial<Record<"enabled" | "address" | "token", unknown>>, who: { userId: string; language?: Language; ip?: string | null; userAgent?: string | null }): Promise<ReturnType<typeof noticesView>> {
  const row = await readRow(s);
  const old = await openTarget(s, row);
  const enabled = o.enabled === undefined ? row.enabled : parseBoolean(o.enabled);
  const address = o.address === undefined ? old?.address : parseNoticeAddress(o.address);
  // a token belongs to the address it was saved with: a new address without a new token sends none
  const token = o.token === undefined ? (o.address === undefined ? (old?.token ?? null) : null) : o.token === null ? null : parseNoticeToken(o.token);
  if (enabled && !address) throw UserError.of("check.notice_needs_address");
  // a stored value that cannot be opened now (no secret box) is kept as it is unless a new address replaces it
  let keyEnc: string | null = o.address === undefined && o.token === undefined ? row.keyEnc : null;
  if (address && (o.address !== undefined || o.token !== undefined)) {
    const box = await s.secretBox();
    if (!box) throw new UserError("Palvelimen salausavain puuttuu. Ylläpitäjä löytää syyn palvelimen lokista.");
    keyEnc = await box.seal(JSON.stringify({ address, token } satisfies Target), AAD);
  }
  await s.settings.set(KEY, JSON.stringify({ enabled, keyEnc, language: who.language ?? row.language } satisfies Row));
  const changed = [enabled !== row.enabled ? (enabled ? "päälle" : "pois") : null, address !== old?.address ? "osoite" : null, token !== (old?.token ?? null) ? "tunniste" : null].filter(Boolean);
  if (changed.length) await recordEvent(s, { kind: "notices_changed", userId: who.userId, ip: who.ip, userAgent: who.userAgent, detail: changed.join(", ") });
  return noticesView(s);
}

/** True when a name resolves only to public addresses (a name that points inside the home network is refused). Checked just before the send, so a later change of the name's answer is not caught. */
async function resolvesPublic(host: string): Promise<boolean> {
  const priv = (a: string) =>
    isIP(a) === 6
      ? /^(::1?$|f[cd]|fe[89ab]|::ffff:|64:ff9b:|2002:)/i.test(a)
      : /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(a);
  try {
    const all = await lookup(host, { all: true });
    return all.length > 0 && !all.some((x) => priv(x.address));
  } catch {
    return false;
  }
}

/** One POST. Redirects are not followed and the answer is not read; only the status counts. */
async function post(s: Services, t: Target, kind: NoticeKind, language: Language): Promise<boolean> {
  const { title, message } = TEXTS[language][kind];
  const ntfy = !t.address.startsWith("https://");
  const url = ntfy ? `https://${NTFY_HOST}/` : t.address;
  const body = ntfy ? { topic: t.address, title, message } : { event: kind, title, message };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (t.token) headers.authorization = `Bearer ${t.token}`;
  try {
    // a test's own fetch has no network to look into
    if (!s.fetch && !(await resolvesPublic(new URL(url).hostname))) return false;
    const res = await (s.fetch ?? fetch)(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

interface Event {
  kind: NoticeKind;
  /** What makes this event this one: the same key is never sent twice. */
  key: string;
}

/** The events of now: consents ending within the warning time, the safety net's conditions, and a rollback of the last days. */
async function eventsNow(s: Services, probes?: HealthProbes): Promise<Event[]> {
  const out: Event[] = [];
  const { timezone } = s.instance.current;
  const today = s.today();
  for (const user of await s.users.list()) {
    const repo = s.finance(user.id);
    const [accounts, connections] = await Promise.all([repo.listAccounts(), repo.listConnections()]);
    for (const c of connections) {
      const v = connectionView(c, today, timezone, accounts, connections);
      if (v.state === "active" && !v.history && v.daysLeft !== null && v.daysLeft <= WARN_DAYS) out.push({ kind: "consent", key: `consent:${c.id}:${c.validUntil ?? ""}` });
    }
  }
  for (const c of await conditions(s, probes)) {
    if (c.kind === "disk_low") out.push({ kind: "disk", key: `disk:${c.key}` });
    else if (c.kind === "copy_missing" || c.kind === "copy_check_failed") out.push({ kind: "backup", key: `backup:${c.kind}:${c.key}` });
  }
  const since = new Date(s.now().getTime() - 3 * 86_400_000).toISOString();
  for (const e of await s.security.list({ kind: "ops_watchdog", limit: 5 })) if (e.at >= since) out.push({ kind: "update", key: `update:${e.id}` });
  return out;
}

/**
 * The hourly tick's one call. Sends nothing while the setting is off or has no usable address. A failed send is tried
 * again by the next tick. Never throws.
 */
export async function deliverNotices(s: Services, probes?: HealthProbes): Promise<number> {
  try {
    const row = await readRow(s);
    if (!row.enabled) return 0;
    const target = await openTarget(s, row);
    if (!target) return 0;
    let sent = 0;
    for (const e of await eventsNow(s, probes)) {
      // switched off while this batch ran: stop at once
      if (!(await readRow(s)).enabled) break;
      if (!(await s.settings.claim(SENT_PREFIX + e.key, "1"))) continue;
      if (await post(s, target, e.kind, row.language)) sent++;
      else await s.settings.delete(SENT_PREFIX + e.key);
    }
    await s.settings.deleteOlder(SENT_PREFIX, new Date(s.now().getTime() - SENT_KEEP_MS));
    return sent;
  } catch (err) {
    console.error("sending notices failed:", (err as Error).name);
    return 0;
  }
}
