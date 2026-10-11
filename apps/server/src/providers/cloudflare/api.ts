/**
 * The Cloudflare calls `cloudflare up|down` makes, one method each, with the answers reduced to the few fields the
 * command reads. The API reference is https://developers.cloudflare.com/api/ (zones, cfd_tunnel with its configurations
 * and token, dns_records, access organizations, identity_providers, policies and apps).
 *
 * Token permissions, the smallest set that covers every call below (an account-level one may be limited to the one
 * account, a zone-level one to the one zone):
 *   Account: Cloudflare Tunnel: Edit                                  tunnels, their configuration and token
 *   Account: Access: Apps and Policies: Edit                          the Access application and its policy
 *   Account: Access: Organizations, Identity Providers, and Groups: Edit   the organization check, the one-time PIN login
 *   Zone: DNS: Edit                                                   the CNAME
 *   Zone: Zone: Read                                                  the zone list
 */
import { type Answer, CloudflareClient, CloudflareError } from "./client.ts";

export const PERMISSION = {
  zone: "Zone: Zone: Read",
  dns: "Zone: DNS: Edit",
  tunnel: "Account: Cloudflare Tunnel: Edit",
  access: "Account: Access: Apps and Policies: Edit",
  identity: "Account: Access: Organizations, Identity Providers, and Groups: Edit",
} as const;

export interface Zone {
  id: string;
  name: string;
  accountId: string;
}
export interface Tunnel {
  id: string;
  name: string;
  /** "cloudflare" is managed in the dashboard and by this API, "local" by a file next to cloudflared. */
  configSrc: string;
}
export interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
}
export interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
}
export interface IdentityProvider {
  id: string;
  name: string;
  type: string;
}
export interface AccessPolicy {
  id: string;
  name: string;
  decision: string;
  /** Lower case, from the include rules that are email rules. */
  emails: string[];
  /** False when the policy has any rule besides the email includes (an exclude, a require, another kind of include). */
  onlyEmails: boolean;
  sessionSeconds: number | null;
  /** Applications that use the policy. */
  appCount: number;
}
export interface AccessApp {
  id: string;
  name: string;
  domain: string;
  type: string;
  sessionSeconds: number | null;
  allowedIdps: string[];
  autoRedirect: boolean;
  policyIds: string[];
}

/** What an Access application is made with (the API wants the session as a Go duration). */
export interface AppSpec {
  name: string;
  domain: string;
  session: string;
  idpId: string;
  policyId: string;
}

const PAGE = 100;
const MAX_PAGES = 20;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 500): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const wrong = (what: string) => new CloudflareError(`Cloudflare's answer to "${what}" is not what its API describes`, 200);

/** A Go duration ("24h", "2h45m", "24h0m0s") in seconds; null when it is none. The API may spell the same time differently. */
export function durationSeconds(v: unknown): number | null {
  if (typeof v !== "string" || !/^(\d+(\.\d+)?(h|ms|m|s))+$/.test(v)) return null;
  const unit: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
  let total = 0;
  for (const [, n, u] of v.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)) total += Number(n) * unit[u!]!;
  return total;
}

/**
 * The account has no Zero Trust organization. Cloudflare says it as a 404, an empty answer or a message about the
 * feature not being enabled (the exact wording is not in its docs), never as a 401 or 403 without such a message.
 */
function saysNoOrganization(e: CloudflareError): boolean {
  if (e.status === 404) return true;
  return e.status !== 401 && e.faults.some((f) => /not[ _.]enabled|no (zero trust )?organi[sz]ation|organi[sz]ation.*(not|does not).*(exist|found)/i.test(f.message));
}

export class CloudflareApi {
  constructor(private readonly c: CloudflareClient) {}

  /** Every page of a list call, up to a cap. */
  private async all(what: string, path: string, needs: string, query: Record<string, string | number | boolean> = {}, perPage = PAGE): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const a = await this.c.call(what, "GET", path, { query: { ...query, page, per_page: perPage }, needs });
      const got = list(a.result);
      items.push(...got);
      const pages = a.info?.totalPages ?? (a.info?.totalCount != null ? Math.ceil(a.info.totalCount / (a.info.perPage || perPage)) : null);
      if (pages !== null ? page >= pages : got.length < perPage) break;
    }
    return items;
  }

  private one(a: Answer, what: string): Record<string, unknown> {
    if (!isObject(a.result)) throw wrong(what);
    return a.result;
  }

  // ── zones ─────────────────────────────────────────────
  async listZones(): Promise<Zone[]> {
    const zones: Zone[] = [];
    for (const z of await this.all("list the zones", "/zones", PERMISSION.zone, {}, 50)) {
      const account = isObject(z.account) ? z.account : {};
      const id = text(z.id, 64);
      const name = text(z.name, 253);
      const accountId = text(account.id, 64);
      if (id && name && accountId) zones.push({ id, name: name.toLowerCase(), accountId });
    }
    return zones;
  }

  // ── Zero Trust ────────────────────────────────────────
  async hasZeroTrust(accountId: string): Promise<boolean> {
    try {
      const a = await this.c.call("check that Zero Trust is on", "GET", `/accounts/${accountId}/access/organizations`, { needs: PERMISSION.identity });
      return isObject(a.result) && text(a.result.auth_domain) !== null;
    } catch (e) {
      if (e instanceof CloudflareError && saysNoOrganization(e)) return false;
      throw e;
    }
  }

  async listIdentityProviders(accountId: string): Promise<IdentityProvider[]> {
    const out: IdentityProvider[] = [];
    for (const p of await this.all("list the login methods", `/accounts/${accountId}/access/identity_providers`, PERMISSION.identity)) {
      const id = text(p.id, 64);
      const type = text(p.type, 40);
      if (id && type) out.push({ id, name: text(p.name, 200) ?? "", type });
    }
    return out;
  }

  async createOneTimePin(accountId: string): Promise<IdentityProvider> {
    const what = "create the one-time PIN login method";
    const a = await this.c.call(what, "POST", `/accounts/${accountId}/access/identity_providers`, { body: { name: "One-time PIN", type: "onetimepin", config: {} }, needs: PERMISSION.identity });
    const id = text(this.one(a, what).id, 64);
    if (!id) throw wrong(what);
    return { id, name: "One-time PIN", type: "onetimepin" };
  }

  // ── tunnels ───────────────────────────────────────────
  /** The live tunnels with exactly this name (Cloudflare allows several). */
  async listTunnels(accountId: string, name: string): Promise<Tunnel[]> {
    const out: Tunnel[] = [];
    for (const t of await this.all("list the tunnels", `/accounts/${accountId}/cfd_tunnel`, PERMISSION.tunnel, { name, is_deleted: false })) {
      const id = text(t.id, 64);
      if (id && t.name === name && !t.deleted_at) out.push({ id, name, configSrc: text(t.config_src, 20) ?? "" });
    }
    return out;
  }

  async createTunnel(accountId: string, name: string): Promise<Tunnel> {
    const what = "create the tunnel";
    const a = await this.c.call(what, "POST", `/accounts/${accountId}/cfd_tunnel`, { body: { name, config_src: "cloudflare" }, needs: PERMISSION.tunnel });
    const id = text(this.one(a, what).id, 64);
    if (!id) throw wrong(what);
    return { id, name, configSrc: "cloudflare" };
  }

  async getTunnelIngress(accountId: string, tunnelId: string): Promise<IngressRule[]> {
    const a = await this.c.call("read the tunnel's routes", "GET", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { needs: PERMISSION.tunnel });
    const config = isObject(a.result) && isObject(a.result.config) ? a.result.config : {};
    const rules: IngressRule[] = [];
    for (const r of list(config.ingress)) {
      const service = text(r.service);
      if (!service) continue;
      rules.push({ ...(text(r.hostname, 253) ? { hostname: r.hostname as string } : {}), service, ...(text(r.path) ? { path: r.path as string } : {}) });
    }
    return rules;
  }

  async putTunnelIngress(accountId: string, tunnelId: string, ingress: IngressRule[]): Promise<void> {
    await this.c.call("set the tunnel's routes", "PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { body: { config: { ingress } }, needs: PERMISSION.tunnel });
  }

  /** The secret that lets cloudflared connect. It goes into the command's JSON line and nowhere else. */
  async getTunnelToken(accountId: string, tunnelId: string): Promise<string> {
    const what = "fetch the tunnel token";
    const a = await this.c.call(what, "GET", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, { needs: PERMISSION.tunnel });
    const token = text(a.result, 4096);
    if (!token) throw wrong(what);
    return token;
  }

  async cleanTunnelConnections(accountId: string, tunnelId: string): Promise<void> {
    await this.c.call("clear the tunnel's old connections", "DELETE", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`, { needs: PERMISSION.tunnel });
  }

  async deleteTunnel(accountId: string, tunnelId: string): Promise<void> {
    await this.c.call("delete the tunnel", "DELETE", `/accounts/${accountId}/cfd_tunnel/${tunnelId}`, { needs: PERMISSION.tunnel });
  }

  // ── DNS ───────────────────────────────────────────────
  /** Every record of exactly this name, whatever its type (`name.exact`: the plain `name` filter is the old spelling). */
  async listDnsRecords(zoneId: string, name: string): Promise<DnsRecord[]> {
    const out: DnsRecord[] = [];
    for (const r of await this.all("list the DNS records", `/zones/${zoneId}/dns_records`, PERMISSION.dns, { "name.exact": name })) {
      const id = text(r.id, 64);
      const rname = text(r.name, 253);
      const type = text(r.type, 20);
      if (id && rname && type && rname.toLowerCase() === name) out.push({ id, name, type, content: typeof r.content === "string" ? r.content : "", proxied: r.proxied === true });
    }
    return out;
  }

  async createCname(zoneId: string, name: string, target: string): Promise<void> {
    await this.c.call("create the DNS record", "POST", `/zones/${zoneId}/dns_records`, { body: { type: "CNAME", name, content: target, proxied: true, ttl: 1 }, needs: PERMISSION.dns });
  }

  async proxyRecord(zoneId: string, recordId: string): Promise<void> {
    await this.c.call("proxy the DNS record", "PATCH", `/zones/${zoneId}/dns_records/${recordId}`, { body: { proxied: true }, needs: PERMISSION.dns });
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.c.call("delete the DNS record", "DELETE", `/zones/${zoneId}/dns_records/${recordId}`, { needs: PERMISSION.dns });
  }

  // ── Access policies ───────────────────────────────────
  async listPolicies(accountId: string): Promise<AccessPolicy[]> {
    const out: AccessPolicy[] = [];
    for (const p of await this.all("list the Access policies", `/accounts/${accountId}/access/policies`, PERMISSION.access)) {
      const id = text(p.id, 64);
      const name = text(p.name, 200);
      if (!id || !name) continue;
      const include = Array.isArray(p.include) ? p.include : [];
      const emails = include.flatMap((r) => (isObject(r) && isObject(r.email) && typeof r.email.email === "string" ? [r.email.email.toLowerCase()] : []));
      const none = (v: unknown) => !Array.isArray(v) || v.length === 0;
      out.push({
        id,
        name,
        decision: text(p.decision, 20) ?? "",
        emails,
        onlyEmails: emails.length === include.length && none(p.exclude) && none(p.require),
        sessionSeconds: durationSeconds(p.session_duration),
        appCount: typeof p.app_count === "number" ? p.app_count : 0,
      });
    }
    return out;
  }

  private policyBody(name: string, emails: string[], session: string) {
    return { name, decision: "allow", include: emails.map((email) => ({ email: { email } })), session_duration: session };
  }

  async createPolicy(accountId: string, name: string, emails: string[], session: string): Promise<string> {
    const what = "create the Access policy";
    const a = await this.c.call(what, "POST", `/accounts/${accountId}/access/policies`, { body: this.policyBody(name, emails, session), needs: PERMISSION.access });
    const id = text(this.one(a, what).id, 64);
    if (!id) throw wrong(what);
    return id;
  }

  async updatePolicy(accountId: string, policyId: string, name: string, emails: string[], session: string): Promise<void> {
    await this.c.call("rewrite the Access policy", "PUT", `/accounts/${accountId}/access/policies/${policyId}`, { body: this.policyBody(name, emails, session), needs: PERMISSION.access });
  }

  async deletePolicy(accountId: string, policyId: string): Promise<void> {
    await this.c.call("delete the Access policy", "DELETE", `/accounts/${accountId}/access/policies/${policyId}`, { needs: PERMISSION.access });
  }

  // ── Access applications ───────────────────────────────
  async listApps(accountId: string): Promise<AccessApp[]> {
    const out: AccessApp[] = [];
    for (const p of await this.all("list the Access applications", `/accounts/${accountId}/access/apps`, PERMISSION.access)) {
      const id = text(p.id, 64);
      const domain = text(p.domain, 253);
      if (!id || !domain) continue;
      out.push({
        id,
        name: text(p.name, 200) ?? "",
        domain: domain.toLowerCase(),
        type: text(p.type, 40) ?? "",
        sessionSeconds: durationSeconds(p.session_duration),
        allowedIdps: Array.isArray(p.allowed_idps) ? p.allowed_idps.filter((x): x is string => typeof x === "string") : [],
        autoRedirect: p.auto_redirect_to_identity === true,
        policyIds: list(p.policies).flatMap((x) => (text(x.id, 64) ? [x.id as string] : [])),
      });
    }
    return out;
  }

  /** Only the one-time PIN may log in (and the page skips the choice), and one allow policy decides who gets in. */
  private appBody(spec: AppSpec) {
    return {
      type: "self_hosted",
      name: spec.name,
      domain: spec.domain,
      session_duration: spec.session,
      allowed_idps: [spec.idpId],
      auto_redirect_to_identity: true,
      policies: [{ id: spec.policyId, precedence: 1 }],
    };
  }

  async createApp(accountId: string, spec: AppSpec): Promise<void> {
    await this.c.call("create the Access application", "POST", `/accounts/${accountId}/access/apps`, { body: this.appBody(spec), needs: PERMISSION.access });
  }

  async updateApp(accountId: string, appId: string, spec: AppSpec): Promise<void> {
    await this.c.call("rewrite the Access application", "PUT", `/accounts/${accountId}/access/apps/${appId}`, { body: this.appBody(spec), needs: PERMISSION.access });
  }

  async deleteApp(accountId: string, appId: string): Promise<void> {
    await this.c.call("delete the Access application", "DELETE", `/accounts/${accountId}/access/apps/${appId}`, { needs: PERMISSION.access });
  }
}
