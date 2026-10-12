/**
 * What `cloudflare up` and `cloudflare down` do, in the order that leaves nothing half done when a step fails: every
 * step first looks at what exists and changes only what differs, so a second run changes nothing and a failed run
 * is finished by running it again.
 *
 * The host is never reachable without Access in front of it, whichever step fails. `up` reads everything and stops on
 * a conflict before it writes; it then makes the login method, the policy and the Access application (a self-hosted
 * application needs no DNS record), and only then the tunnel, its routes and the CNAME. `down` goes the other way: it
 * empties the tunnel's routes, removes the CNAME and the tunnel, and removes Access last, and only when it left
 * nothing behind that can still lead to the host.
 *
 * It only ever touches what carries the host's names: the tunnel `omatalous-<host with dots as dashes>` (in `down`
 * only when its routes say it is this host's), the Access application and policy `Omatalous <host>`, and the CNAME of
 * the host (and that only when it points at the tunnel).
 * A host is unique in DNS, so two machines on one Cloudflare account never meet; the copy's name (--name) is for the
 * lines people read. A record, a tunnel or an application somebody else made is reported and left as it is.
 */
import { type AccessPolicy, type CloudflareApi, type IngressRule, type Tunnel, type Zone } from "./api.ts";
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN } from "../../platform/config.ts";
import { CloudflareError } from "./client.ts";

/**
 * Why a run stopped, for a caller that tells it in its own words (services/remote-access.ts): no zone holds the host,
 * the host's name is taken by something this copy did not make, a tunnel still has connections, or `down` left
 * something that can lead to the host and kept Access.
 */
export type ExitReason = "zone" | "taken" | "connections" | "left" | "other";

/** A stop the command's exit code says: 2 bad input, 3 Cloudflare refused or `down` kept Access, 4 Zero Trust is off. */
export class CloudflareExit extends Error {
  constructor(
    message: string,
    readonly code: 2 | 3 | 4,
    readonly reason: ExitReason = "other",
  ) {
    super(message);
  }
}

/** Where the tunnel's traffic goes: the app's container in the same Compose project. */
export const ORIGIN = "http://banking:8080";
const SESSION = "24h";
const SESSION_SECONDS = 24 * 3600;

export interface Reporter {
  /** A line for people (stderr). */
  say(line: string): void;
  /** Tells the reporter a value that must never appear in a line. */
  secret(value: string): void;
}

export type Change = "tunnel" | "dns" | "access";

export interface UpInput {
  name: string;
  hostname: string;
  emails: string[];
  /** The host is new to this copy: stop (exit 3) before writing anything when a tunnel or an Access app for it exists. */
  new?: boolean;
}
export interface UpResult {
  hostname: string;
  tunnelToken: string;
  changed: Change[];
  /**
   * What the app needs to check Access's signature itself (security/cf-access.ts): the Access application's audience
   * tag and the team's host. Both or neither: they are left out when Cloudflare gave either in a form the app's
   * config would refuse, and the copy then runs as one without the check.
   */
  accessAud?: string;
  teamDomain?: string;
}

/** The zone with the longest name the host ends in, or null. */
export function zoneOf(zones: Zone[], hostname: string): Zone | null {
  let best: Zone | null = null;
  for (const z of zones) {
    if ((hostname === z.name || hostname.endsWith(`.${z.name}`)) && (!best || z.name.length > best.name.length)) best = z;
  }
  return best;
}

function zoneFor(zones: Zone[], hostname: string): Zone {
  const best = zoneOf(zones, hostname);
  if (!best) throw new CloudflareExit(`None of the zones this API token can see holds ${hostname}. Add the domain to Cloudflare, or give the token "Zone: Zone: Read" on it.`, 3, "zone");
  return best;
}

/** The names of what is made for a host (not for the copy: the copy's name is only the same on two machines). */
export const tunnelNameFor = (hostname: string) => `omatalous-${hostname.replace(/\./g, "-")}`;
export const labelFor = (hostname: string) => `Omatalous ${hostname}`;

const CLOSED: IngressRule[] = [{ service: "http_status:404" }];
const ingressFor = (hostname: string): IngressRule[] => [{ hostname, service: ORIGIN }, ...CLOSED];
const ingressKey = (rules: IngressRule[]) => JSON.stringify(rules.map((r) => [r.hostname ?? null, r.service, r.path ?? null]));
const bare = (host: string) => host.toLowerCase().replace(/\.$/, "");
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** A refusal about this one request (not about the token): worth a second try after a cleanup, or a clear message. */
const isRefusal = (e: unknown): e is CloudflareError => e instanceof CloudflareError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403;

export async function cloudflareUp(api: CloudflareApi, input: UpInput, r: Reporter): Promise<UpResult> {
  const { name, hostname } = input;
  const emails = [...new Set(input.emails.map((e) => e.toLowerCase()))];
  const tunnelName = tunnelNameFor(hostname);
  const label = labelFor(hostname);
  const changed = new Set<Change>();

  // 1. the zone, and the account it belongs to
  const zone = zoneFor(await api.listZones(), hostname);
  const account = zone.accountId;
  r.say(`Copy ${name}: zone ${zone.name} found for ${hostname}.`);

  // 2. Zero Trust has to be on already: turning it on means choosing a plan and a team name, which is the owner's call
  const teamDomain = await api.teamDomain(account);
  if (teamDomain === null) {
    throw new CloudflareExit(`Zero Trust is not on for the Cloudflare account that holds ${zone.name}. Turn on Zero Trust (Free) in the dashboard, then run this again.`, 4);
  }

  // 3. everything that could be in the way, read before anything is written: a stop here leaves nothing behind
  const tunnels = await api.listTunnels(account, tunnelName);
  const apps = await api.listApps(account);
  // --new: the host must not be made yet. Another folder or machine with the same settings would otherwise take over
  // this host's tunnel and its token, rewrite its policy's emails, and remove it all with its own `down`.
  const made = apps.find((a) => a.domain === hostname);
  if (input.new && (tunnels.length || made)) {
    const what = tunnels.length ? `a tunnel named ${tunnelName}` : `the Access application "${made?.name}"`;
    throw new CloudflareExit(`${hostname} is already set up in Cloudflare (${what}), so it may be another copy's and was left as it is. Give this copy another address, or remove the old one first (cloudflare down, or the Zero Trust dashboard).`, 3, "taken");
  }
  let tunnel: Tunnel | undefined = tunnels.find((t) => t.configSrc === "cloudflare");
  if (!tunnel && tunnels.length) {
    throw new CloudflareExit(`A tunnel named ${tunnelName} exists but a file on its host manages it, not Cloudflare. Delete or rename it in the Zero Trust dashboard, then run this again.`, 3, "taken");
  }
  const have = tunnel ? await api.getTunnelIngress(account, tunnel.id) : [];
  const elsewhere = have.find((x) => x.hostname !== undefined && bare(x.hostname) !== hostname);
  if (elsewhere) {
    throw new CloudflareExit(`A tunnel named ${tunnelName} already sends ${elsewhere.hostname} somewhere, so it belongs to another copy and was left as it is. Delete it in the Zero Trust dashboard, or pick another host name.`, 3, "taken");
  }
  const records = await api.listDnsRecords(zone.id, hostname);
  const known = tunnel ? `${tunnel.id}.cfargotunnel.com` : null;
  const clash = records.find((x) => ["A", "AAAA", "CNAME"].includes(x.type) && !(x.type === "CNAME" && bare(x.content) === known));
  if (clash) {
    throw new CloudflareExit(`The DNS record ${hostname} (${clash.type} ${clash.content}) does not point at this copy's tunnel and was left as it is. Remove it in the dashboard, or pick another host name.`, 3, "taken");
  }
  const foreign = apps.find((a) => a.domain === hostname && a.name !== label);
  if (foreign) {
    throw new CloudflareExit(`The Access application "${foreign.name}" already protects ${hostname} and was left as it is. Remove it in the dashboard, or pick another host name.`, 3, "taken");
  }

  // 4. Access first: the login method, one allow policy with exactly these emails, and the application that uses only it
  // and only the PIN. The host has no DNS record and no route yet, so nothing is open if one of these fails.
  const pin = (await api.listIdentityProviders(account)).find((p) => p.type === "onetimepin");
  let accessChanged = false;
  const idpId = pin ? pin.id : (await api.createOneTimePin(account)).id;
  if (!pin) accessChanged = true;

  const policy: AccessPolicy | undefined = (await api.listPolicies(account)).find((p) => p.name === label);
  let policyId: string;
  if (!policy) {
    policyId = await api.createPolicy(account, label, emails, SESSION);
    accessChanged = true;
  } else {
    policyId = policy.id;
    if (!(policy.decision === "allow" && policy.onlyEmails && sameSet(policy.emails, emails) && policy.sessionSeconds === SESSION_SECONDS)) {
      await api.updatePolicy(account, policy.id, label, emails, SESSION);
      accessChanged = true;
    }
  }
  const spec = { name: label, domain: hostname, session: SESSION, idpId, policyId };
  const app = apps.find((a) => a.domain === hostname && a.name === label);
  // the audience tag is the application's for life: a rewrite keeps it
  let aud = app?.aud ?? null;
  if (!app) {
    aud = await api.createApp(account, spec);
    accessChanged = true;
  } else if (!(app.type === "self_hosted" && app.sessionSeconds === SESSION_SECONDS && app.autoRedirect && sameSet(app.allowedIdps, [idpId]) && app.policyIds.length === 1 && app.policyIds[0] === policyId)) {
    await api.updateApp(account, app.id, spec);
    accessChanged = true;
  }
  if (accessChanged) changed.add("access");
  r.say(accessChanged ? `Access for ${hostname} lets in ${emails.length} email address${emails.length === 1 ? "" : "es"} with a one-time PIN.` : `Access for ${hostname} was already right.`);

  // 5. the tunnel and where it sends the host
  let tunnelChanged = false;
  if (!tunnel) {
    tunnel = await api.createTunnel(account, tunnelName);
    tunnelChanged = true;
  }
  const want = ingressFor(hostname);
  if (ingressKey(have) !== ingressKey(want)) {
    await api.putTunnelIngress(account, tunnel.id, want);
    tunnelChanged = true;
  }
  if (tunnelChanged) changed.add("tunnel");
  r.say(tunnelChanged ? `Tunnel ${tunnelName} is set up.` : `Tunnel ${tunnelName} was already set up.`);

  // 6. the CNAME last: from here the host answers, and Access is already in front of it
  const target = `${tunnel.id}.cfargotunnel.com`;
  const ours = records.find((x) => x.type === "CNAME" && bare(x.content) === target);
  if (!ours) {
    await api.createCname(zone.id, hostname, target);
    changed.add("dns");
  } else if (!ours.proxied) {
    await api.proxyRecord(zone.id, ours.id);
    changed.add("dns");
  }
  r.say(changed.has("dns") ? `DNS record ${hostname} points at the tunnel.` : `DNS record ${hostname} was already right.`);

  const tunnelToken = await api.getTunnelToken(account, tunnel.id);
  r.secret(tunnelToken);
  const done = (["tunnel", "dns", "access"] as const).filter((c) => changed.has(c));
  r.say(done.length ? `Changed: ${done.join(", ")}.` : "Nothing changed.");
  // the pair for the app's own check, in the form its config accepts or not at all
  if (aud !== null && ACCESS_AUD.test(aud) && ACCESS_TEAM_DOMAIN.test(teamDomain)) return { hostname, tunnelToken, changed: done, accessAud: aud, teamDomain };
  r.say("Cloudflare did not give the Access application's audience tag and the team domain in the form the app checks, so the app's own check of Access stays off.");
  return { hostname, tunnelToken, changed: done };
}

/**
 * Removes what `up` made for this host; what is already gone is not an error and not mentioned. Access goes last, and
 * only when nothing is left that can lead to the host. A step that fails stops the run before Access, and so does a
 * tunnel or a record that is not this copy's to remove: the host may still answer through it, and with Access gone
 * only the app's own login would be in front. The run then keeps Access, names what is left in one line and ends
 * with exit 3.
 *
 * The host's tunnel has the host's tunnel name and routes that name this host and no other, or the closed routes an
 * earlier `down` left (that tunnel routes nothing, and the run that closed it was about to delete it). The name alone
 * does not say whose a tunnel is: dots as dashes is not one to one, so a-b.c.fi and a.b.c.fi share a tunnel name. A
 * tunnel with no routes yet, or with routes for other hosts only, stays and holds nothing up. A tunnel that routes
 * this host and another one stays as well and keeps Access.
 */
export async function cloudflareDown(api: CloudflareApi, input: { name: string; hostname: string }, r: Reporter): Promise<string[]> {
  const { hostname } = input;
  const tunnelName = tunnelNameFor(hostname);
  const label = labelFor(hostname);
  const removed: string[] = [];
  /** What can still lead to the host and was not this copy's to remove. Anything here keeps Access. */
  const left: string[] = [];

  const zone = zoneFor(await api.listZones(), hostname);
  const account = zone.accountId;

  // 1. the routes closed: cloudflared may still run, and answers nothing for the host from here on
  const tunnels: Tunnel[] = [];
  for (const t of (await api.listTunnels(account, tunnelName)).filter((x) => x.configSrc === "cloudflare")) {
    const ingress = await api.getTunnelIngress(account, t.id);
    const hosts = ingress.flatMap((x) => (x.hostname === undefined ? [] : [bare(x.hostname)]));
    const closed = ingressKey(ingress) === ingressKey(CLOSED);
    if (!hosts.includes(hostname) && !closed) {
      r.say(`The tunnel ${tunnelName} does not route ${hostname}, so it may be another host name's and was left as it is.`);
      continue;
    }
    const other = hosts.find((h) => h !== hostname);
    if (other !== undefined) {
      left.push(`the tunnel ${tunnelName}, which also routes ${other}`);
      continue;
    }
    tunnels.push(t);
    if (!closed) await api.putTunnelIngress(account, t.id, CLOSED);
  }

  // 2. the records that give the host an address: the CNAME goes when it points at a tunnel that is removed here,
  // and every other one stays
  const targets = tunnels.map((t) => `${t.id}.cfargotunnel.com`);
  for (const x of await api.listDnsRecords(zone.id, hostname)) {
    if (!["A", "AAAA", "CNAME"].includes(x.type)) continue;
    if (x.type === "CNAME" && targets.includes(bare(x.content))) {
      await api.deleteDnsRecord(zone.id, x.id);
      removed.push("DNS record");
    } else {
      left.push(`the DNS record ${hostname} (${x.type} ${x.content})`);
    }
  }

  // 3. the tunnel
  for (const t of tunnels) {
    try {
      await api.deleteTunnel(account, t.id);
    } catch (e) {
      if (!isRefusal(e)) throw e;
      // a tunnel Cloudflare still counts connections on cannot be deleted; clearing them works once cloudflared has stopped
      await api.cleanTunnelConnections(account, t.id).catch(() => {});
      try {
        await api.deleteTunnel(account, t.id);
      } catch (e2) {
        if (!isRefusal(e2)) throw e2;
        throw new CloudflareExit(`Cloudflare will not delete the tunnel ${tunnelName} while it has connections. Stop this copy's cloudflared container and run this again.`, 3, "connections");
      }
    }
    removed.push("tunnel");
  }

  // 4. Access last, and not at all while something that was left can lead to the host
  if (left.length) {
    if (removed.length) r.say(`Removed: ${removed.join(", ")}.`);
    throw new CloudflareExit(
      `Left as it is: ${left.join("; ")}. ${hostname} may still answer that way, so nothing of Access for ${hostname} was removed. Remove what was left in the Cloudflare dashboard, then run this again.`,
      3,
      "left",
    );
  }
  // the application, then its policy (without Zero Trust there is neither)
  if (await api.hasZeroTrust(account)) {
    const app = (await api.listApps(account)).find((a) => a.name === label && a.domain === hostname);
    const policy = (await api.listPolicies(account)).find((p) => p.name === label);
    if (app) {
      await api.deleteApp(account, app.id);
      removed.push("Access application");
    }
    // a policy somebody else also uses stays
    if (policy && policy.appCount - (app?.policyIds.includes(policy.id) ? 1 : 0) <= 0) {
      await api.deletePolicy(account, policy.id);
      removed.push("Access policy");
    }
  }
  r.say(removed.length ? `Removed: ${removed.join(", ")}.` : `Nothing to remove for ${hostname}.`);
  return removed;
}
