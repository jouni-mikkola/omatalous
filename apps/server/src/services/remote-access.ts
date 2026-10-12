/**
 * Asetukset > Palvelin > Etäkäyttö: an admin puts this copy behind a Cloudflare Tunnel with Cloudflare Access in front
 * of it, changes who may sign in and takes it down again, with no shell on the server.
 *
 * Cloudflare's side is done here, in process, with the steps of `cloudflare up|down` (providers/cloudflare) and an API
 * token kept sealed in the settings. The host's side (the tunnel token and the Access pair in `.env`, the tunnel
 * container) is the helper's: what it needs waits in the request file (access-request.ts), and the `access`
 * maintenance request (ops.ts) tells it to apply the file. The request itself carries nothing.
 *
 * Rules this file and its parts keep (the record: remote-access-record.ts, how a change ends: remote-access-settle.ts,
 * the trial of a new address: remote-access-trial.ts):
 * - Nothing changes in Cloudflare or on the host before the admin's password was checked in the same call. The one
 *   exception is the server's own return to the local network after a trial nobody passed (remote-access-trial.ts).
 * - The request file is written by the call that checked the password and queues `access` (`queueAccess`). It holds
 *   the tunnel token, so it goes when the queue refuses and when the request ends in any way.
 * - Whether a change is in force is read from the helper's report of the host (`mode`, `address`): a request cut
 *   short can end as failed with the new `.env` already in use.
 * - The API token, the tunnel token and Cloudflare's own words never reach an answer, a log line or an event. A
 *   refusal is told as the fixed Finnish sentence of its kind (remote-access-cloudflare.ts).
 * - Only what this copy made is touched. A host is asked for with the installer's `--new` rule until this copy has
 *   written something for it, and one copy has one host: another address means off first, then on.
 */
import type { User } from "../db/rows.ts";
import { HttpUserError, UpstreamError, UserError } from "../platform/errors.ts";
import type { Zone } from "../providers/cloudflare/api.ts";
import { cloudflareUp, type UpResult, zoneOf } from "../providers/cloudflare/reconcile.ts";
import { ACCESS_HOSTNAME, ACCESS_HOSTNAME_MAX, type AccessRequest, accessRequestPath, deleteAccessRequest, writeAccessRequest } from "./access-request.ts";
import type { Services } from "./context.ts";
import { checkPassword, lanAddressAfterTunnel, type PasswordProof, queueRefuses, type Req, requestOp } from "./ops.ts";
import { helperKnows } from "./ops-validate.ts";
import { AAD, clientFor, openToken, QUIET, readJson, type Refusal, refusalOf, SAYS, setUpForThisCopy, SHORT, type StoredToken, TOKEN_KEY, upstream } from "./remote-access-cloudflare.ts";
import { parseApiToken, parseEmails, parseHostname, parsePassword } from "./remote-access-input.ts";
import { change, copyName, exclusive, hostOf, IN_PROGRESS, inForce, type Made, type Ops, onTunnel, openTrial, type Pending, TRIAL_MS, type Trial } from "./remote-access-record.ts";
import { finishRemoval, REMOVAL_NOTE, REVERTED, removeFromCloudflare, settle } from "./remote-access-settle.ts";
import { recordEvent } from "./security.ts";

const LABEL = "etäkäyttö";
const TOKEN_LABEL = "Cloudflaren API-tunniste";
const MODES = ["tunnel", "lan", "local", "domain"] as const;
/** An address only the server itself can open. */
const LOCAL_ONLY = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/i;

const INSTALLERS =
  "Tämän asennuksen etäkäyttö on tehty palvelimella asennusohjelmalla, eikä sitä voi muuttaa täältä. Muuta sitä palvelimella asennusohjelmalla (./scripts/install.sh).";
const NO_PAIR = "Cloudflare ei antanut tietoja, joilla sovellus tarkistaa kirjautumisen. Etäkäyttöä ei otettu käyttöön. Yritä hetken päästä uudelleen.";

/** A DNS label of the copy's name: the cut comes first, so the label never ends in a hyphen. */
const hostLabel = (copy: string) => copy.replace(/_/g, "-").slice(0, 63).replace(/^-+|-+$/g, "") || "talous";

/** For whoever ends a request outside this file: the helper's report (cli-ops.ts) and a withdrawal (routes/ops.ts). */
export async function settleRemoteAccess(s: Services): Promise<void> {
  await settle(s);
}

// ── what the queue and Cloudflare would refuse ───────────

/** What the queue would refuse, in its own words (ops.ts), asked before anything changes in Cloudflare. */
async function ready(s: Services): Promise<void> {
  await queueRefuses(s, "access");
  if (!accessRequestPath(s)) throw new HttpUserError("Sovellus ei tiedä, missä sen tiedot ovat palvelimella, joten etäkäyttöä ei voi muuttaa täältä.", 409);
}

/**
 * Refuses a host Cloudflare would not serve. A zone that waits for its name servers answers nothing. A host deeper
 * than one label under its zone gets no certificate: the one Cloudflare makes for a zone covers the zone and `*.zone`.
 */
function servable(zone: Zone, hostname: string): void {
  if (!zone.active) {
    throw new UserError(`Verkkotunnus ${zone.name} ei ole vielä käytössä Cloudflaressa, joten osoite ei toimisi. Viimeistele sen käyttöönotto Cloudflaren hallinnassa ja yritä uudelleen.`);
  }
  const front = hostname === zone.name ? "" : hostname.slice(0, -zone.name.length - 1);
  if (front.includes(".")) {
    const flat = `${hostLabel(front.replace(/\./g, "-"))}.${zone.name}`;
    throw new UserError(`Osoitteessa saa olla vain yksi osa verkkotunnuksen ${zone.name} edessä. Käytä esimerkiksi osoitetta ${flat}.`);
  }
}

/**
 * The one place a call from the browser writes the request file. `proof` says the admin's password was checked in this
 * same call, and with it requestOp queues `access`: no earlier call leaves a file for a later request to pick up. A
 * file whose request was refused goes at once.
 */
async function queueAccess(s: Services, user: User, proof: PasswordProof, req: Req, request: AccessRequest): Promise<string> {
  writeAccessRequest(s, request);
  try {
    return (await requestOp(s, user, { action: "access" }, req, proof)).id;
  } catch (e) {
    deleteAccessRequest(s);
    throw e;
  }
}

// ── what the page shows ──────────────────────────────────

/** The last change that ended. "applied" also when its request failed but the host now runs as it asked. */
function lastOf(rec: Made, ops: Ops) {
  const last = rec.last;
  if (!last) return null;
  const done = last.applied || inForce(ops, last.want, last.hostname);
  // "reverted": the server itself took a new address off, because nobody got in through it (remote-access-trial.ts)
  const outcome = !done ? ("failed" as const) : last.reverted ? ("reverted" as const) : ("applied" as const);
  return { want: last.want, hostname: last.hostname, outcome, summary: outcome === "reverted" ? REVERTED : last.summary, at: last.at };
}

export async function remoteAccessState(s: Services) {
  const { ops, rec } = await settle(s);
  finishRemoval(s, ops, rec);
  const stored = await readJson<StoredToken>(s, TOKEN_KEY);
  const zones = stored?.zones ?? [];
  const on = onTunnel(ops);
  const hostname = on ? hostOf(ops.state.address) : null;
  const known = hostname !== null && hostname === rec.hostname && rec.emails.length > 0;
  const row = rec.pending ? await s.ops.get(rec.pending.requestId) : null;
  const copy = copyName(s);
  const trial = on ? openTrial(rec) : null;
  return {
    copy,
    /** `usable` is false when the saved token no longer opens (the app secret was replaced by hand). */
    token: { saved: !!stored, usable: (await openToken(s)) !== null, savedAt: stored?.savedAt ?? null, zones },
    /** The default host: the copy's name under the first zone the token sees that Cloudflare serves. */
    suggestedHostname: zones[0] ? `${hostLabel(copy)}.${zones[0]}` : null,
    /** How the host runs now, by the helper's last report. `checked`: the app itself checks Cloudflare's signature. */
    access: {
      on,
      hostname,
      address: ops.state.address ?? null,
      mode: MODES.find((m) => m === ops.state.mode) ?? null,
      port: ops.state.port ?? null,
      emails: known ? rec.emails : [],
      emailsKnown: known,
      checked: s.config.access !== null,
      /** False while a new address waits for its proof: nobody has come in through it yet. */
      confirmed: on && !trial,
      /** When the server takes the unproven address off by itself, else null. */
      revertAt: trial?.appliedAt ? new Date(Date.parse(trial.appliedAt) + TRIAL_MS).toISOString() : null,
      /** Where the copy answers after an off, by the helper. Null from a helper that does not say. */
      afterOff: await lanAddressAfterTunnel(s),
    },
    /** Cloudflare's side as this page made it. `note` tells in Finnish why a removal has not finished. */
    cloudflare: { hostname: rec.hostname, emails: rec.emails, removal: rec.removal, note: rec.removal ? REMOVAL_NOTE[rec.removal] : null },
    pending: rec.pending && row ? pendingOf(rec.pending, row.status) : null,
    last: lastOf(rec, ops),
    helper: { status: ops.helper.status, version: ops.helper.version, knowsAccess: helperKnows(ops.helper.version, "access"), enableCommand: ops.helper.enableCommand },
    /** Another maintenance action is queued or running: a change would be refused. */
    busy: ops.active,
  };
}

const pendingOf = (p: Pending, status: string) => ({
  want: p.want,
  hostname: p.hostname,
  requestId: p.requestId,
  status: status === "running" ? ("running" as const) : ("queued" as const),
  requestedAt: p.at,
});

// ── the API token ────────────────────────────────────────

/** A body the route has read as a strict object of these keys (routes/admin.ts): each value is still unchecked. */
type Sent<K extends string> = Partial<Record<K, unknown>>;

/** `{ token, password }`. The token is tried against Cloudflare before it is kept, and kept only sealed. */
export async function saveToken(s: Services, user: User, o: Sent<"token" | "password">, req: Req) {
  const token = parseApiToken(o.token);
  const password = parsePassword(o.password);
  const box = await s.secretBox();
  if (!box) throw new UserError("Palvelimen salausavain (APP_SECRET) puuttuu. Katso palvelimen loki.");
  // the token decides whose Cloudflare account this copy trusts, so a session alone does not replace it
  await checkPassword(s, user, password, req, TOKEN_LABEL);
  const { api } = clientFor(s, token);
  let zones: Zone[];
  try {
    let status = await api.tokenStatus();
    zones = await api.listZones();
    // an account's own token is verified under its account, which the zones name
    if (status === null && zones[0]) status = await api.tokenStatus(zones[0].accountId);
    if (status !== null && status !== "active") throw new UpstreamError("cloudflare token: not active", SAYS.token);
  } catch (e) {
    throw upstream(e, "token");
  }
  const named = zones.filter((z) => z.name.length <= ACCESS_HOSTNAME_MAX && ACCESS_HOSTNAME.test(z.name));
  // a zone Cloudflare does not serve yet is not offered: an address under it would answer nothing
  const names = [...new Set(named.filter((z) => z.active).map((z) => z.name))].slice(0, 50);
  if (!named.length) throw new UserError("API-tunniste ei näe yhtään verkkotunnusta. Anna sille oikeus Zone: Zone: Read siihen verkkotunnukseen, jota käytät.");
  if (!names.length) {
    throw new UserError("API-tunnisteen verkkotunnus ei ole vielä käytössä Cloudflaressa. Viimeistele sen käyttöönotto Cloudflaren hallinnassa ja tallenna tunniste sitten uudelleen.");
  }
  await s.settings.set(TOKEN_KEY, JSON.stringify({ keyEnc: await box.seal(token, AAD), savedAt: s.now().toISOString(), zones: names } satisfies StoredToken));
  await recordEvent(s, { kind: "cloudflare_token_saved", userId: user.id, ...req, detail: `verkkotunnukset: ${names.slice(0, 5).join(", ")}` });
  return remoteAccessState(s);
}

/**
 * `{ password }`. Refused while a change waits for the helper and while Cloudflare's side waits to be removed: both
 * end with this token.
 */
export async function removeToken(s: Services, user: User, o: Sent<"password">, req: Req) {
  const password = parsePassword(o.password);
  await checkPassword(s, user, password, req, TOKEN_LABEL);
  const { rec } = await settle(s);
  if (rec.pending || rec.removal === "waiting") throw new HttpUserError(IN_PROGRESS, 409);
  if (await s.settings.get(TOKEN_KEY)) {
    await s.settings.delete(TOKEN_KEY);
    await recordEvent(s, { kind: "cloudflare_token_removed", userId: user.id, ...req });
  }
  return remoteAccessState(s);
}

// ── on, change, off ──────────────────────────────────────

/**
 * `{ hostname, emails, password }`: turns remote access on, or changes who may sign in when it is on already. A new
 * address starts a trial (remote-access-trial.ts). A change of the list behind an address in use does not, so a list
 * without the address Access verified for this very call (`signedInAs`, security/cf-access.ts) is refused: the admin
 * would shut themselves out. A call that came in past Access, or with a service token, has no such address.
 */
export async function turnOn(s: Services, user: User, o: Sent<"hostname" | "emails" | "password">, req: Req, signedInAs: string | null = null) {
  const hostname = parseHostname(o.hostname);
  const emails = parseEmails(o.emails);
  const password = parsePassword(o.password);
  if (signedInAs && !emails.includes(signedInAs)) throw new UserError(`Listalta puuttuu osoite ${signedInAs}, jolla olet nyt kirjautunut. Lisää se, muuten et pääse enää sisään.`);
  return exclusive(s, async () => {
    const { ops, rec } = await settle(s);
    if (rec.pending) throw new HttpUserError(IN_PROGRESS, 409);
    if (ops.state.mode === "domain") throw new UserError("Tällä asennuksella on oma verkkotunnus (Caddy), eikä etäkäyttöä oteta käyttöön sen rinnalle.");
    const behind = onTunnel(ops) ? hostOf(ops.state.address) : null;
    const current = rec.hostname ?? behind;
    if (current && current !== hostname) throw new UserError(`Etäkäyttö on jo tehty osoitteelle ${current}. Poista se ensin käytöstä, jos haluat vaihtaa osoitteen.`);
    await ready(s);
    const token = await openToken(s);
    if (!token) throw new UserError((await s.settings.get(TOKEN_KEY)) ? "Tallenna Cloudflaren API-tunniste uudelleen." : "Tallenna ensin Cloudflaren API-tunniste.");
    const proof = await checkPassword(s, user, password, req, LABEL);

    const cf = clientFor(s, token);
    const failed = (kind: Refusal) => recordEvent(s, { kind: "remote_access_failed", userId: user.id, ...req, detail: `${hostname}: ${SHORT[kind]}` });
    let made: UpResult;
    let account: string | null = null;
    try {
      const zone = zoneOf(await cf.api.listZones(), hostname);
      if (!zone) throw new UserError(SAYS.zone);
      servable(zone, hostname);
      account = zone.accountId;
      const ours = (rec.hostname === hostname && rec.account === account) || (await setUpForThisCopy(s, cf.api, zone, hostname));
      // the host runs behind this address and this copy has made nothing in Cloudflare: the installer did, with its own token
      if (!ours && !rec.hostname && behind === hostname) throw new HttpUserError(INSTALLERS, 409);
      made = await cloudflareUp(cf.api, { name: copyName(s), hostname, emails, new: !ours }, QUIET);
    } catch (e) {
      // a run that wrote had passed every check of whose the host is: what it left there is this copy's to finish or remove
      if (cf.wrote()) await change(s, (r) => ({ ...r, hostname, account, emails: [], removal: null, removalBy: null }));
      if (!(e instanceof UserError)) await failed(refusalOf(e));
      throw upstream(e, "up");
    }
    await change(s, (r) => ({ ...r, hostname, account, emails, removal: null, removalBy: null }));
    // without the pair the app could not check Access's signature, and the helper takes no request without it
    if (!made.accessAud || !made.teamDomain) {
      await failed("other");
      throw new UpstreamError("cloudflare up: no audience tag or team domain in the form the app checks", NO_PAIR);
    }
    const requestId = await queueAccess(s, user, proof, req, { want: "tunnel", hostname, tunnelToken: made.tunnelToken, accessAud: made.accessAud, teamDomain: made.teamDomain });
    const pending: Pending = { want: "tunnel", requestId, hostname, by: user.id, at: s.now().toISOString() };
    const trial: Trial = { aud: made.accessAud, by: user.id, appliedAt: null, confirmedAt: null };
    await change(s, (r) => ({ ...r, pending, trial: behind === hostname ? r.trial : trial }));
    return remoteAccessState(s);
  });
}

/**
 * `{ password, localOnly? }`: the host leaves the tunnel, then Cloudflare's side is removed. Cloudflare's side waits
 * until the helper says the host has left (settle): the browser that asks may be coming through the tunnel and gets its
 * answer this way, and when the helper fails the copy is still reachable as before, with Access in front of it.
 * A host that is behind no tunnel has its Cloudflare side removed at once.
 *
 * `localOnly: true` is asked for when the copy will answer on the server itself only after this (`access.afterOff`):
 * whoever turns it off from another machine could not get back in.
 */
export async function turnOff(s: Services, user: User, o: Sent<"password" | "localOnly">, req: Req) {
  const password = parsePassword(o.password);
  if (o.localOnly !== undefined && typeof o.localOnly !== "boolean") throw new UserError("Virheellinen kenttä.");
  return exclusive(s, async () => {
    const { ops, rec } = await settle(s);
    const on = onTunnel(ops);
    if (rec.pending) throw new HttpUserError(IN_PROGRESS, 409);
    // Without the helper's word a host behind the tunnel would lose Cloudflare's side under it. A process that checks
    // Access runs behind the tunnel whatever the last report says: that report is from before a change that was cut short.
    if (ops.state.mode === undefined || (!on && s.config.access)) {
      throw new HttpUserError("Ylläpitoapuri ei ole vielä kertonut, onko asennus tunnelin takana. Yritä hetken päästä uudelleen.", 409);
    }
    if (!on && !rec.hostname) throw new UserError("Etäkäyttö ei ole käytössä.");
    if (on) {
      await ready(s);
      const after = await lanAddressAfterTunnel(s);
      if (after && LOCAL_ONLY.test(after) && o.localOnly !== true) {
        throw new UserError(`Kun etäkäyttö poistetaan, sovellus vastaa vain palvelimella itsellään osoitteessa ${after}. Vahvista, että tämä sopii.`);
      }
    }
    const proof = await checkPassword(s, user, password, req, LABEL);
    const hostname = rec.hostname ?? (await installersHost(s, hostOf(ops.state.address)));
    if (on) {
      const requestId = await queueAccess(s, user, proof, req, { want: "lan" });
      const pending: Pending = { want: "lan", requestId, hostname: null, by: user.id, at: s.now().toISOString() };
      // a host this copy did not make keeps its Cloudflare side: the installer made it, and the page says so
      await change(s, (r) => (hostname ? { ...r, pending, hostname, removal: "waiting", removalBy: user.id } : { ...r, pending, removal: "installer", removalBy: null }));
    } else if (hostname) {
      await removeFromCloudflare(s, hostname, user.id, req);
    }
    return remoteAccessState(s);
  });
}

/** The host this copy runs behind when the installer made it in Cloudflare and the saved token can see it, else null. */
async function installersHost(s: Services, hostname: string | null): Promise<string | null> {
  const token = hostname ? await openToken(s) : null;
  if (!hostname || !token) return null;
  try {
    const { api } = clientFor(s, token);
    const zone = zoneOf(await api.listZones(), hostname);
    return zone && (await setUpForThisCopy(s, api, zone, hostname)) ? hostname : null;
  } catch {
    return null;
  }
}
