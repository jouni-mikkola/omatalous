/**
 * How a remote access change ends (services/remote-access.ts): the request file goes, the outcome is recorded once, and
 * after an off Cloudflare's side is removed when the helper says the host has left the tunnel.
 *
 * The helper's report arrives in a process of its own (cli-ops.ts), so `settle` runs on every read of the state, before
 * every change and from the hourly tick. It asks Cloudflare nothing, so any process may run it.
 */
import { statSync } from "node:fs";
import { CloudflareExit, cloudflareDown } from "../providers/cloudflare/reconcile.ts";
import { accessRequestPath, deleteAccessRequest } from "./access-request.ts";
import type { Services } from "./context.ts";
import { opsState, type Req } from "./ops.ts";
import { clientFor, openToken, QUIET, refusalOf, SHORT, upstream } from "./remote-access-cloudflare.ts";
import { busy, change, copyName, exclusive, inForce, load, type Made, type Ops, onTunnel, openTrial, type Removal, TRIAL_MS, WAITING } from "./remote-access-record.ts";
import { recordEvent } from "./security.ts";

export const REVERTED = `Etäkäyttö otettiin pois käytöstä, koska kukaan ei päässyt sisään uuden osoitteen kautta ${TRIAL_MS / 60_000} minuutissa.`;
/** A request file this young may belong to a call that wrote it a moment ago and has not queued its request yet. */
const ORPHAN_MS = 120_000;

export async function settle(s: Services): Promise<{ ops: Ops; rec: Made }> {
  // also ends the requests the helper never took
  const ops = await opsState(s);
  let rec = await load(s);
  if (rec.pending) {
    const row = await s.ops.get(rec.pending.requestId);
    if (!row || !WAITING.includes(row.status)) rec = await end(s, ops);
  } else {
    await sweep(s);
  }
  // The trial follows the host as the helper reports it: a request cut short can end as failed and be in force all the
  // same, in either direction.
  const trial = rec.pending ? null : openTrial(rec);
  const began = !!trial && !trial.appliedAt && !!rec.hostname && inForce(ops, "tunnel", rec.hostname);
  const over = !!trial?.appliedAt && inForce(ops, "lan", null);
  if (began || over) {
    const at = s.now().toISOString();
    rec = await change(s, (r) => (r.pending || !openTrial(r) ? null : { ...r, trial: over ? null : { ...r.trial!, appliedAt: r.trial!.appliedAt ?? at } }));
  }
  return { ops, rec };
}

/**
 * Ends the change whose request has ended. The record is read again under its lock, so of two processes that get here
 * together one ends it and records the outcome, and the other finds nothing waiting.
 */
const end = (s: Services, ops: Ops): Promise<Made> =>
  change(s, async (rec) => {
    const p = rec.pending;
    const row = p ? await s.ops.get(p.requestId) : null;
    if (!p || (row && WAITING.includes(row.status))) return null;
    deleteAccessRequest(s);
    // the host's own report decides. A request that ended well counts too: its report of the host lands a moment later.
    const applied = inForce(ops, p.want, p.hostname) || row?.status === "ok";
    // the helper's words, cleaned of the tunnel token when they were stored (reportOps)
    const summary = row?.summary ?? "Pyyntöä ei enää löydy.";
    const at = row?.finishedAt ?? s.now().toISOString();
    const trial = !applied || !rec.trial ? rec.trial : p.want === "lan" ? null : { ...rec.trial, appliedAt: rec.trial.appliedAt ?? at };
    const tunnel = p.want === "tunnel";
    const done = tunnel ? `${p.hostname}, sallittuja osoitteita ${rec.emails.length}` : "asennus ei ole enää tunnelin takana";
    const kind = !applied ? "remote_access_failed" : tunnel ? "remote_access_on" : "remote_access_off";
    await recordEvent(s, { kind, userId: p.by, detail: applied ? done : `${tunnel ? "käyttöönotto" : "käytöstä poisto"}: ${summary}` });
    return {
      ...rec,
      pending: null,
      trial,
      // the host stayed behind the tunnel, so nothing of Cloudflare's side is removed
      removal: !tunnel && !applied ? null : rec.removal,
      last: { want: p.want, hostname: p.revert ? rec.hostname : p.hostname, applied, ...(p.revert ? { reverted: true as const } : {}), summary, at },
    };
  });

/**
 * A request file nothing waits for is removed: a call that died between the queue and the record, or half a write.
 * A young one is left alone, and so is any while this process is in a change: the call that wrote it queues its
 * request a moment later, and the helper must find the file then.
 */
async function sweep(s: Services): Promise<void> {
  const file = accessRequestPath(s);
  if (!file || busy(s)) return;
  const written = [file, `${file}.new`].flatMap((path) => {
    try {
      return [statSync(path).mtimeMs];
    } catch {
      return [];
    }
  });
  // the file's own time is the machine's clock
  if (!written.length || Date.now() - Math.max(...written) < ORPHAN_MS) return;
  if (!(await s.ops.recent(40)).some((r) => r.action === "access" && WAITING.includes(r.status))) deleteAccessRequest(s);
}

const RETRY_MS = 60_000;
const tried = new WeakMap<Services, number>();

/**
 * Cloudflare's side goes once the helper says the host has left the tunnel. Not awaited: a read of the state does not
 * wait for Cloudflare, and a later read shows how it went. Tried again at most once a minute.
 */
export function finishRemoval(s: Services, ops: Ops, rec: Made): void {
  const host = rec.hostname;
  const now = s.now().getTime();
  if (!host || rec.removal !== "waiting" || rec.pending || ops.state.mode === undefined || onTunnel(ops) || busy(s)) return;
  if (now - (tried.get(s) ?? -RETRY_MS) < RETRY_MS) return;
  tried.set(s, now);
  void exclusive(s, () => removeFromCloudflare(s, host, rec.removalBy)).catch(() => undefined);
}

/**
 * Takes this copy's host out of Cloudflare with the steps of `cloudflare down` and records how far it got. "waiting":
 * the host is still behind the tunnel, or Cloudflare still counts connections on it, and finishRemoval tries again.
 * "kept": something this copy did not make still leads to the host, so Access stays in front of it.
 */
export async function removeFromCloudflare(s: Services, hostname: string, userId: string | null, req: Partial<Req> = {}): Promise<Removal> {
  const token = await openToken(s);
  let removal: Removal = "failed";
  let why = "API-tunnistetta ei ole";
  if (token) {
    try {
      await cloudflareDown(clientFor(s, token).api, { name: copyName(s), hostname }, QUIET);
      removal = "removed";
    } catch (e) {
      const reason = e instanceof CloudflareExit ? e.reason : null;
      removal = reason === "connections" ? "waiting" : reason === "left" ? "kept" : "failed";
      why = removal === "kept" ? "osoitteeseen johtaa vielä muuta" : SHORT[refusalOf(e)];
      if (removal === "failed") console.error(upstream(e, "down").message);
    }
  }
  const gone = removal === "removed";
  await change(s, (r) => (gone ? { ...r, hostname: null, account: null, emails: [], removal, removalBy: null } : { ...r, hostname, removal, removalBy: userId }));
  if (gone) await recordEvent(s, { kind: "remote_access_off", userId, ...req, detail: `${hostname}: poistettu Cloudflaresta` });
  else if (removal !== "waiting") await recordEvent(s, { kind: "remote_access_failed", userId, ...req, detail: `${hostname}: Cloudflaren puolta ei poistettu (${why})` });
  return removal;
}

/** Why a removal has not finished, as the page tells it. */
export const REMOVAL_NOTE: Record<Removal, string | null> = {
  removed: null,
  waiting: "Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista.",
  kept:
    "Osoitteeseen johtaa Cloudflaressa vielä jotain, mitä tämä asennus ei ole tehnyt, joten kirjautumissuojaus (Access) jätettiin päälle. " +
    "Poista ylimääräinen tunneli tai DNS-tietue Cloudflaren hallinnasta ja poista etäkäyttö sitten uudelleen.",
  failed: "Cloudflaren puolta ei saatu poistettua. Tarkista API-tunniste ja poista etäkäyttö uudelleen.",
  installer:
    "Tämän osoitteen on tehnyt Cloudflareen palvelimen asennusohjelma, joten tunneli, DNS-tietue ja kirjautumissuojaus (Access) jäivät sinne. " +
    "Poista ne Cloudflaren hallinnasta tai palvelimen asennusohjelmalla.",
};
