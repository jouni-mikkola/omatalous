import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCloudflareCli } from "../src/cli-cloudflare.ts";
import { CLOUDFLARE_API } from "../src/providers/cloudflare/client.ts";

/** An in-memory Cloudflare: the routes `cloudflare up|down` uses, answering as the API does. Nothing leaves the process. */
interface Rec {
  [k: string]: unknown;
  id: string;
}
interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
  auth: string | null;
}

function fakeCloudflare() {
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const f = {
    calls: [] as Call[],
    zones: [
      { id: "zone-main", name: "example.fi", account: { id: "acc-main", name: "Example" } },
      { id: "zone-lab", name: "lab.example.fi", account: { id: "acc-lab", name: "Lab" } },
    ] as Rec[],
    /** "off": the account has no organization, answered the way the test names it */
    zeroTrust: "on" as "on" | "404" | "message" | "empty",
    tunnels: [] as Rec[],
    records: [] as Rec[],
    idps: [] as Rec[],
    policies: [] as Rec[],
    apps: [] as Rec[],
    /** "METHOD /path/with/:params" that answer 403 */
    deny: new Set<string>(),
    /** A deleted tunnel with connections answers 400 until its connections are cleared. */
    busyTunnels: new Set<string>(),
    /** "METHOD /path/with/:params" that answer 400 with this message */
    reject: new Map<string, string>(),
    unreachable: false,
    writes: () => f.calls.filter((c) => c.method !== "GET"),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      if (f.unreachable) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      const url = new URL(String(input));
      if (!String(input).startsWith(`${CLOUDFLARE_API}/`)) throw new Error(`request to ${url.origin}`);
      expect(init?.redirect).toBe("manual");
      const method = init?.method ?? "GET";
      const path = url.pathname.slice("/client/v4".length);
      const auth = new Headers(init?.headers).get("authorization");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      f.calls.push({ method, path, query: url.searchParams, body, auth });
      return f.route(method, path, url.searchParams, body);
    }) as typeof fetch,
    route(method: string, path: string, q: URLSearchParams, body: any): Response {
      const ok = (result: unknown) => Response.json({ success: true, errors: [], messages: [], result, result_info: { page: 1, per_page: 100, total_count: Array.isArray(result) ? result.length : 1, total_pages: 1 } });
      const fail = (status: number, message: string, code = 1000) => Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });
      const seg = path.split("/").filter(Boolean);
      const shape = seg.map((s, i) => (/^(zone|acc|tunnel|rec|idp|pol|app)-/.test(s) && i > 0 ? ":id" : s)).join("/");
      if (f.deny.has(`${method} /${shape}`)) return fail(403, "Authentication error", 10000);
      const bad = f.reject.get(`${method} /${shape}`);
      if (bad) return fail(400, bad);
      const by = (list: Rec[], key: string, v: string | null) => list.filter((x) => (v === null ? true : x[key] === v));
      const account = seg[0] === "accounts" ? seg[1]! : "";
      const mine = (list: Rec[]) => list.filter((x) => x.account === account);
      switch (`${method} /${shape}`) {
        case "GET /zones":
          return ok(f.zones);
        case "GET /accounts/:id/access/organizations":
          if (f.zeroTrust === "404") return fail(404, "Not found");
          if (f.zeroTrust === "message") return fail(400, "access.api.error.not_enabled: Zero Trust is not enabled", 12130);
          return ok(f.zeroTrust === "empty" ? null : { auth_domain: "example.cloudflareaccess.com", name: "Example" });
        case "GET /accounts/:id/cfd_tunnel":
          return ok(by(mine(f.tunnels), "name", q.get("name")).map((t) => ({ ...t, deleted_at: null })));
        case "POST /accounts/:id/cfd_tunnel": {
          const t = { id: id("tunnel"), name: body.name, config_src: body.config_src, account, config: null as unknown, status: "inactive" };
          f.tunnels.push(t);
          return ok(t);
        }
        case "GET /accounts/:id/cfd_tunnel/:id/configurations": {
          const t = f.tunnels.find((x) => x.id === seg[3])!;
          return ok({ tunnel_id: t.id, version: 1, config: t.config });
        }
        case "PUT /accounts/:id/cfd_tunnel/:id/configurations": {
          // Cloudflare returns every rule with an originRequest object
          f.tunnels.find((x) => x.id === seg[3])!.config = { ingress: body.config.ingress.map((r: any) => ({ ...r, originRequest: {} })) };
          return ok({ tunnel_id: seg[3], version: 2, config: body.config });
        }
        case "GET /accounts/:id/cfd_tunnel/:id/token":
          return ok(`token-of-${seg[3]}`);
        case "DELETE /accounts/:id/cfd_tunnel/:id/connections":
          f.busyTunnels.delete(seg[3]!);
          return ok({});
        case "DELETE /accounts/:id/cfd_tunnel/:id":
          if (f.busyTunnels.has(seg[3]!)) return fail(400, "Cannot delete tunnel: it has active connections", 1022);
          f.tunnels = f.tunnels.filter((x) => x.id !== seg[3]);
          return ok({ id: seg[3] });
        case "GET /zones/:id/dns_records":
          return ok(by(f.records, "zone", seg[1]!).filter((r) => q.get("name.exact") === null || r.name === q.get("name.exact")));
        case "POST /zones/:id/dns_records": {
          const r = { id: id("rec"), zone: seg[1]!, ...body };
          f.records.push(r);
          return ok(r);
        }
        case "PATCH /zones/:id/dns_records/:id":
          Object.assign(f.records.find((x) => x.id === seg[3])!, body);
          return ok({});
        case "DELETE /zones/:id/dns_records/:id":
          f.records = f.records.filter((x) => x.id !== seg[3]);
          return ok({ id: seg[3] });
        case "GET /accounts/:id/access/identity_providers":
          return ok(mine(f.idps));
        case "POST /accounts/:id/access/identity_providers": {
          const p = { id: id("idp"), account, ...body };
          f.idps.push(p);
          return ok(p);
        }
        case "GET /accounts/:id/access/policies":
          return ok(mine(f.policies).map((p) => ({ ...p, session_duration: "24h0m0s", app_count: f.apps.filter((a) => (a.policies as Rec[]).some((x) => x.id === p.id)).length })));
        case "POST /accounts/:id/access/policies": {
          const p = { id: id("pol"), account, reusable: true, ...body };
          f.policies.push(p);
          return ok(p);
        }
        case "PUT /accounts/:id/access/policies/:id":
          Object.assign(f.policies.find((x) => x.id === seg[4])!, body);
          return ok({});
        case "DELETE /accounts/:id/access/policies/:id":
          f.policies = f.policies.filter((x) => x.id !== seg[4]);
          return ok({ id: seg[4] });
        case "GET /accounts/:id/access/apps":
          return ok(mine(f.apps).map((a) => ({ ...a, session_duration: "24h0m0s" })));
        case "POST /accounts/:id/access/apps": {
          const a = { id: id("app"), account, aud: "x", ...body };
          f.apps.push(a);
          return ok(a);
        }
        case "PUT /accounts/:id/access/apps/:id":
          Object.assign(f.apps.find((x) => x.id === seg[4])!, body);
          return ok({});
        case "DELETE /accounts/:id/access/apps/:id":
          f.apps = f.apps.filter((x) => x.id !== seg[4]);
          return ok({ id: seg[4] });
      }
      throw new Error(`the fake has no route ${method} ${path}`);
    },
  };
  return f;
}

const TOKEN = "cf-api-token-0123456789abcdef";
const ANNA = "anna@example.fi";
const PEKKA = "pekka@example.fi";

async function run(f: ReturnType<typeof fakeCloudflare>, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCloudflareCli(args, { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCESS_EMAILS: `${ANNA},${PEKKA}`, ...env }, { out: (l) => out.push(l), err: (l) => err.push(l) }, f.fetch);
  return { code, out, err, stderr: err.join("\n") };
}
const up = (f: ReturnType<typeof fakeCloudflare>, host = "talous.example.fi", name = "talous", env: Record<string, string> = {}) => run(f, ["up", "--name", name, "--hostname", host], env);
const down = (f: ReturnType<typeof fakeCloudflare>, host = "talous.example.fi", name = "talous") => run(f, ["down", "--name", name, "--hostname", host]);
/** "METHOD /path/:id" of every write in a list of calls, in the order they were made. */
const writeOrder = (calls: Call[]) => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path.replace(/\/(?:acc|zone|tunnel|rec|idp|pol|app)-[^/]+/g, "/:id")}`);
/** Does the tunnel send this host to the app? */
const routes = (t: Rec, host: string) => ((t.config as { ingress?: { hostname?: string }[] } | null)?.ingress ?? []).some((rule) => rule.hostname === host);

describe("cloudflare up", () => {
  it("a first run makes the tunnel, the record, the login method, the policy and the application", async () => {
    const f = fakeCloudflare();
    const r = await up(f);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    const tunnel = f.tunnels[0]!;
    expect(JSON.parse(r.out[0]!)).toEqual({ hostname: "talous.example.fi", tunnelToken: `token-of-${tunnel.id}`, changed: ["tunnel", "dns", "access"] });
    expect(tunnel).toMatchObject({ name: "omatalous-talous-example-fi", config_src: "cloudflare", account: "acc-main" });
    expect((tunnel.config as any).ingress.map(({ originRequest, ...rule }: any) => rule)).toEqual([{ hostname: "talous.example.fi", service: "http://banking:8080" }, { service: "http_status:404" }]);
    expect(f.records).toEqual([expect.objectContaining({ type: "CNAME", name: "talous.example.fi", content: `${tunnel.id}.cfargotunnel.com`, proxied: true, zone: "zone-main" })]);
    expect(f.idps).toEqual([expect.objectContaining({ type: "onetimepin" })]);
    expect(f.policies).toEqual([expect.objectContaining({ name: "Omatalous talous.example.fi", decision: "allow", include: [{ email: { email: ANNA } }, { email: { email: PEKKA } }] })]);
    expect(f.apps).toEqual([
      expect.objectContaining({ type: "self_hosted", name: "Omatalous talous.example.fi", domain: "talous.example.fi", session_duration: "24h", allowed_idps: [f.idps[0]!.id], policies: [{ id: f.policies[0]!.id, precedence: 1 }] }),
    ]);
    // every call carried the token and went to the account and the zone of the host
    expect(new Set(f.calls.map((c) => c.auth))).toEqual(new Set([`Bearer ${TOKEN}`]));
    expect(f.calls.filter((c) => c.path.startsWith("/accounts/")).every((c) => c.path.startsWith("/accounts/acc-main/"))).toBe(true);
  });

  it("takes the zone with the longest matching name and its account", async () => {
    const f = fakeCloudflare();
    const r = await up(f, "talous.lab.example.fi");
    expect(r.code).toBe(0);
    expect(f.tunnels[0]!.account).toBe("acc-lab");
    expect(f.records[0]).toMatchObject({ zone: "zone-lab", name: "talous.lab.example.fi" });
  });

  it("a second run changes nothing, says so and still gives the tunnel token", async () => {
    const f = fakeCloudflare();
    const first = await up(f);
    const before = f.calls.length;
    const second = await up(f);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.out[0]!)).toEqual({ ...JSON.parse(first.out[0]!), changed: [] });
    expect(f.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
    expect(second.err.at(-1)).toBe("Nothing changed.");
    expect([f.tunnels.length, f.records.length, f.idps.length, f.policies.length, f.apps.length]).toEqual([1, 1, 1, 1, 1]);
  });

  it("a changed email list rewrites the policy and nothing else; the order and case of the list do not count", async () => {
    const f = fakeCloudflare();
    await up(f);
    const before = f.calls.length;
    const r = await up(f, "talous.example.fi", "talous", { CLOUDFLARE_ACCESS_EMAILS: `${ANNA}, carl@example.fi` });
    expect(JSON.parse(r.out[0]!).changed).toEqual(["access"]);
    const writes = f.calls.slice(before).filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /accounts/acc-main/access/policies/${f.policies[0]!.id}`]);
    expect(f.policies[0]!.include).toEqual([{ email: { email: ANNA } }, { email: { email: "carl@example.fi" } }]);
    const again = await up(f, "talous.example.fi", "talous", { CLOUDFLARE_ACCESS_EMAILS: "Carl@Example.fi,ANNA@example.fi,anna@example.fi" });
    expect(JSON.parse(again.out[0]!).changed).toEqual([]);
  });

  it("puts back what somebody changed: the tunnel's routes, an unproxied record, the application's login methods", async () => {
    const f = fakeCloudflare();
    await up(f);
    f.tunnels[0]!.config = { ingress: [{ hostname: "talous.example.fi", service: "http://elsewhere:80" }, { service: "http_status:404" }] };
    expect(JSON.parse((await up(f)).out[0]!).changed).toEqual(["tunnel"]);
    f.records[0]!.proxied = false;
    expect(JSON.parse((await up(f)).out[0]!).changed).toEqual(["dns"]);
    expect(f.records[0]!.proxied).toBe(true);
    f.apps[0]!.allowed_idps = [];
    expect(JSON.parse((await up(f)).out[0]!).changed).toEqual(["access"]);
    expect(f.apps[0]!.allowed_idps).toEqual([f.idps[0]!.id]);
  });

  it.each([
    ["an A record", { type: "A", content: "192.0.2.10" }],
    ["a CNAME to somewhere else", { type: "CNAME", content: "other.example.net" }],
  ])("%s on the host is never overwritten: exit 3 names it", async (_n, rec) => {
    const f = fakeCloudflare();
    f.records.push({ id: "rec-old", zone: "zone-main", name: "talous.example.fi", proxied: false, ...rec });
    const r = await up(f);
    expect(r.code).toBe(3);
    expect(r.out).toEqual([]);
    expect(r.stderr).toContain(`talous.example.fi (${rec.type} ${rec.content})`);
    expect(f.records).toEqual([expect.objectContaining({ id: "rec-old", content: rec.content, proxied: false })]);
    expect(f.writes()).toEqual([]);
    expect(f.apps).toEqual([]);
  });

  it.each(["404", "message", "empty"] as const)("Zero Trust off (%s) is exit 4 before anything is made", async (how) => {
    const f = fakeCloudflare();
    f.zeroTrust = how;
    const r = await up(f);
    expect(r.code).toBe(4);
    expect(r.out).toEqual([]);
    expect(r.stderr).toContain("Turn on Zero Trust (Free) in the dashboard");
    expect(f.writes()).toEqual([]);
  });

  it.each([
    ["GET /zones", "Zone: Zone: Read"],
    ["POST /accounts/:id/cfd_tunnel", "Account: Cloudflare Tunnel: Edit"],
    ["POST /zones/:id/dns_records", "Zone: DNS: Edit"],
    ["POST /accounts/:id/access/identity_providers", "Account: Access: Organizations, Identity Providers, and Groups: Edit"],
    ["POST /accounts/:id/access/apps", "Account: Access: Apps and Policies: Edit"],
  ])("a 403 on %s is exit 3 and names the permission %s", async (route, permission) => {
    const f = fakeCloudflare();
    f.deny.add(route);
    const r = await up(f);
    expect(r.code).toBe(3);
    expect(r.out).toEqual([]);
    expect(r.stderr).toContain(`"${permission}"`);
  });

  it("other refusals are exit 3, an unreachable Cloudflare exit 1", async () => {
    const f = fakeCloudflare();
    f.tunnels.push({ id: "tunnel-local", name: "omatalous-talous-example-fi", config_src: "local", account: "acc-main" });
    const local = await up(f);
    expect(local.code).toBe(3);
    expect(local.stderr).toContain("omatalous-talous-example-fi");

    const g = fakeCloudflare();
    g.apps.push({ id: "app-old", account: "acc-main", name: "Wiki", domain: "talous.example.fi", type: "self_hosted", policies: [] });
    const foreign = await up(g);
    expect(foreign.code).toBe(3);
    expect(foreign.stderr).toContain('"Wiki"');
    expect(g.apps).toHaveLength(1);

    const h = fakeCloudflare();
    const nowhere = await up(h, "talous.example.org");
    expect(nowhere.code).toBe(3);
    expect(nowhere.stderr).toContain("talous.example.org");
    expect(h.writes()).toEqual([]);

    const u = fakeCloudflare();
    u.unreachable = true;
    const gone = await up(u);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toContain("not reachable");
    expect(gone.stderr).toContain("ENOTFOUND");
  });

  it("neither token reaches stderr, and the tunnel token only the JSON line", async () => {
    const f = fakeCloudflare();
    f.reject.set("POST /accounts/:id/cfd_tunnel", `invalid request for ${TOKEN}`);
    const refused = await up(f);
    expect(refused.code).toBe(3);
    expect(refused.stderr).not.toContain(TOKEN);
    expect(refused.stderr).toContain("[hidden]");
    f.reject.clear();
    const ok = await up(f);
    const tunnelToken = JSON.parse(ok.out[0]!).tunnelToken as string;
    expect(ok.out[0]).toContain(tunnelToken);
    expect(ok.stderr).not.toContain(tunnelToken);
    expect(ok.stderr).not.toContain(TOKEN);
    expect(ok.stderr).not.toContain(ANNA);
  });

  it.each([
    ["no API token", ["up", "--name", "talous", "--hostname", "talous.example.fi"], { CLOUDFLARE_API_TOKEN: "" }],
    ["no emails", ["up", "--name", "talous", "--hostname", "talous.example.fi"], { CLOUDFLARE_ACCESS_EMAILS: " , " }],
    ["a bad email", ["up", "--name", "talous", "--hostname", "talous.example.fi"], { CLOUDFLARE_ACCESS_EMAILS: `${ANNA},not-an-address` }],
    ["a URL as host", ["up", "--name", "talous", "--hostname", "https://talous.example.fi/"], {}],
    ["a host with no dot", ["up", "--name", "talous", "--hostname", "talous"], {}],
    ["a bad copy name", ["up", "--name", "Talous Two", "--hostname", "talous.example.fi"], {}],
    ["no host", ["up", "--name", "talous"], {}],
    ["a token in argv", ["up", "--name", "talous", "--hostname", "talous.example.fi", "--token", "x"], {}],
    ["an unknown command", ["sideways"], {}],
  ])("bad input (%s) is exit 2 and never calls Cloudflare", async (_n, args, env) => {
    const f = fakeCloudflare();
    const r = await run(f, args, env);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(r.stderr).not.toContain(PEKKA);
  });
});

describe("cloudflare down", () => {
  it("removes the application, the policy, the record and the tunnel, and nothing of another copy", async () => {
    const f = fakeCloudflare();
    await up(f, "talous.example.fi", "talous");
    await up(f, "other.example.fi", "other", { CLOUDFLARE_ACCESS_EMAILS: "kaisa@example.fi" });
    f.records.push({ id: "rec-www", zone: "zone-main", type: "A", name: "www.example.fi", content: "192.0.2.1", proxied: true });
    const r = await down(f);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
    expect(r.err.at(-1)).toBe("Removed: DNS record, tunnel, Access application, Access policy.");
    expect(f.tunnels.map((t) => t.name)).toEqual(["omatalous-other-example-fi"]);
    expect(f.records.map((x) => x.name)).toEqual(["other.example.fi", "www.example.fi"]);
    expect(f.apps.map((x) => x.name)).toEqual(["Omatalous other.example.fi"]);
    expect(f.policies.map((x) => x.name)).toEqual(["Omatalous other.example.fi"]);
    expect(f.idps).toHaveLength(1);
  });

  it("is quiet when everything is gone", async () => {
    const f = fakeCloudflare();
    await up(f);
    await down(f);
    const before = f.calls.length;
    const again = await down(f);
    expect(again.code).toBe(0);
    expect(again.err.at(-1)).toBe("Nothing to remove for talous.example.fi.");
    expect(f.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("leaves a record that does not point at its tunnel, and clears connections that block the tunnel", async () => {
    const f = fakeCloudflare();
    await up(f);
    f.records[0]!.content = "elsewhere.example.net";
    f.busyTunnels.add(f.tunnels[0]!.id);
    const r = await down(f);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("was left as it is");
    expect(f.records).toHaveLength(1);
    expect(f.tunnels).toEqual([]);
    expect(f.writes().some((c) => c.method === "DELETE" && c.path.endsWith("/connections"))).toBe(true);
  });

  it("asks to stop cloudflared when the tunnel still has connections", async () => {
    const f = fakeCloudflare();
    await up(f);
    f.busyTunnels.add(f.tunnels[0]!.id);
    const clear = f.route.bind(f);
    f.route = (method, path, q, body) => (method === "DELETE" && path.endsWith("/connections") ? Response.json({ success: true, errors: [], messages: [], result: {} }) : clear(method, path, q, body));
    const r = await down(f);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("Stop this copy's cloudflared container");
  });

  it("names the permission when Cloudflare says no", async () => {
    const f = fakeCloudflare();
    await up(f);
    f.deny.add("DELETE /accounts/:id/cfd_tunnel/:id");
    const r = await down(f);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('"Account: Cloudflare Tunnel: Edit"');
  });
});

describe("cloudflare up: Access before anything is reachable", () => {
  it("makes the login method, the policy and the application first, then the tunnel, its routes and the record last", async () => {
    const f = fakeCloudflare();
    await up(f);
    expect(writeOrder(f.calls)).toEqual([
      "POST /accounts/:id/access/identity_providers",
      "POST /accounts/:id/access/policies",
      "POST /accounts/:id/access/apps",
      "POST /accounts/:id/cfd_tunnel",
      "PUT /accounts/:id/cfd_tunnel/:id/configurations",
      "POST /zones/:id/dns_records",
    ]);
  });

  it.each([
    ["POST /accounts/:id/access/identity_providers"],
    ["POST /accounts/:id/access/policies"],
    ["POST /accounts/:id/access/apps"],
    ["POST /accounts/:id/cfd_tunnel"],
    ["PUT /accounts/:id/cfd_tunnel/:id/configurations"],
  ])("a failure on %s leaves no record, so nothing answers for the host", async (route) => {
    const f = fakeCloudflare();
    f.reject.set(route, "refused for the test");
    const r = await up(f);
    expect(r.code).toBe(3);
    expect(r.out).toEqual([]);
    expect(f.records).toEqual([]);
    expect(f.writes().some((c) => c.path.startsWith("/zones/"))).toBe(false);
    // and the rerun finishes the job
    f.reject.clear();
    expect((await up(f)).code).toBe(0);
    expect(f.records).toHaveLength(1);
    expect(f.apps).toHaveLength(1);
  });

  it("a rerun with another host name that fails on the application opens nothing: the new host has no record and no route", async () => {
    const f = fakeCloudflare();
    await up(f);
    f.reject.set("POST /accounts/:id/access/apps", "refused for the test");
    const r = await up(f, "other.example.fi", "talous");
    expect(r.code).toBe(3);
    expect(f.records.map((x) => x.name)).toEqual(["talous.example.fi"]);
    expect(f.tunnels.map((t) => t.name)).toEqual(["omatalous-talous-example-fi"]);
    expect(f.tunnels.some((t) => routes(t, "other.example.fi"))).toBe(false);
    expect(f.apps.map((a) => a.domain)).toEqual(["talous.example.fi"]);
  });

  it("a record or an application in the way stops the run before anything is written", async () => {
    const f = fakeCloudflare();
    f.records.push({ id: "rec-old", zone: "zone-main", name: "talous.example.fi", type: "A", content: "192.0.2.10", proxied: false });
    expect((await up(f)).code).toBe(3);
    expect(f.writes()).toEqual([]);

    const g = fakeCloudflare();
    g.apps.push({ id: "app-old", account: "acc-main", name: "Wiki", domain: "talous.example.fi", type: "self_hosted", policies: [] });
    expect((await up(g)).code).toBe(3);
    expect(g.writes()).toEqual([]);
  });
});

describe("cloudflare up --new: a host another copy made is not taken over", () => {
  const upNew = (f: ReturnType<typeof fakeCloudflare>, env: Record<string, string> = {}) => run(f, ["up", "--name", "talous", "--hostname", "talous.example.fi", "--new"], env);

  it("makes a host nobody has, like up", async () => {
    const f = fakeCloudflare();
    const r = await upNew(f);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out[0]!).changed).toEqual(["tunnel", "dns", "access"]);
  });

  it("stops with exit 3 before writing anything when the host's tunnel or Access application exists", async () => {
    const f = fakeCloudflare();
    expect((await up(f)).code).toBe(0);
    const policy = structuredClone(f.policies[0]!.include);
    const before = f.calls.length;
    const r = await upNew(f, { CLOUDFLARE_ACCESS_EMAILS: "mallory@example.fi" });
    expect(r.code).toBe(3);
    expect(r.out).toEqual([]);
    expect(r.stderr).toContain("talous.example.fi is already set up");
    expect(r.stderr).not.toContain(TOKEN);
    expect(f.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
    expect(f.policies[0]!.include).toEqual(policy);
    expect(f.calls.slice(before).some((c) => c.path.endsWith("/token"))).toBe(false);

    // an application alone (its tunnel already gone) is enough
    const g = fakeCloudflare();
    g.apps.push({ id: "app-old", account: "acc-main", name: "Omatalous talous.example.fi", domain: "talous.example.fi", type: "self_hosted", policies: [] });
    expect((await upNew(g)).code).toBe(3);
    expect(g.writes()).toEqual([]);
  });

  it("is for up only, and once", async () => {
    const f = fakeCloudflare();
    expect((await run(f, ["down", "--name", "talous", "--hostname", "talous.example.fi", "--new"])).code).toBe(2);
    expect((await run(f, ["up", "--new", "--new", "--name", "talous", "--hostname", "talous.example.fi"])).code).toBe(2);
    expect(f.calls).toEqual([]);
  });
});

describe("cloudflare names follow the host, not the copy", () => {
  it("two machines with the same copy name on one account get their own tunnel, policy and application", async () => {
    const f = fakeCloudflare();
    const first = await up(f, "talous.example.fi", "banking-app");
    const second = await up(f, "other.example.fi", "banking-app", { CLOUDFLARE_ACCESS_EMAILS: "kaisa@example.fi" });
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.out[0]!).changed).toEqual(["tunnel", "dns", "access"]);
    expect(JSON.parse(second.out[0]!).tunnelToken).not.toBe(JSON.parse(first.out[0]!).tunnelToken);
    expect(f.tunnels.map((t) => t.name)).toEqual(["omatalous-talous-example-fi", "omatalous-other-example-fi"]);
    expect(f.policies.map((p) => p.name)).toEqual(["Omatalous talous.example.fi", "Omatalous other.example.fi"]);
    expect(f.apps.map((a) => a.name)).toEqual(["Omatalous talous.example.fi", "Omatalous other.example.fi"]);
    // the first machine's emails and routes are as they were
    expect(f.policies[0]!.include).toEqual([{ email: { email: ANNA } }, { email: { email: PEKKA } }]);
    expect(routes(f.tunnels[0]!, "talous.example.fi")).toBe(true);
    expect(routes(f.tunnels[0]!, "other.example.fi")).toBe(false);

    // and the second machine's down takes only its own
    const gone = await down(f, "other.example.fi", "banking-app");
    expect(gone.code).toBe(0);
    expect(f.tunnels.map((t) => t.name)).toEqual(["omatalous-talous-example-fi"]);
    expect(f.records.map((x) => x.name)).toEqual(["talous.example.fi"]);
    expect(f.apps.map((a) => a.name)).toEqual(["Omatalous talous.example.fi"]);
    expect(f.policies.map((p) => p.name)).toEqual(["Omatalous talous.example.fi"]);
    expect(routes(f.tunnels[0]!, "talous.example.fi")).toBe(true);
  });

  it("an existing tunnel of that name that routes a different host is exit 3, and neither up nor down touches it", async () => {
    // a-b.example.fi and a.b.example.fi both make omatalous-a-b-example-fi
    const f = fakeCloudflare();
    expect((await up(f, "a-b.example.fi", "one")).code).toBe(0);
    const before = f.calls.length;
    const r = await up(f, "a.b.example.fi", "two");
    expect(r.code).toBe(3);
    expect(r.out).toEqual([]);
    expect(r.stderr).toContain("omatalous-a-b-example-fi");
    expect(r.stderr).toContain("a-b.example.fi");
    const d = await down(f, "a.b.example.fi", "two");
    expect(d.code).toBe(0);
    expect(f.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
    expect(f.tunnels).toHaveLength(1);
    expect(routes(f.tunnels[0]!, "a-b.example.fi")).toBe(true);
    expect(f.records.map((x) => x.name)).toEqual(["a-b.example.fi"]);
    expect(f.apps.map((a) => a.domain)).toEqual(["a-b.example.fi"]);
  });

  it("asks Cloudflare for the DNS records with name.exact and for the tunnel with name", async () => {
    const f = fakeCloudflare();
    await up(f);
    const dns = f.calls.filter((c) => c.method === "GET" && c.path === "/zones/zone-main/dns_records");
    expect(dns.length).toBeGreaterThan(0);
    for (const c of dns) {
      expect(c.query.get("name.exact")).toBe("talous.example.fi");
      expect(c.query.has("name")).toBe(false);
    }
    const tunnels = f.calls.filter((c) => c.method === "GET" && c.path === "/accounts/acc-main/cfd_tunnel");
    expect(tunnels.map((c) => c.query.get("name"))).toEqual(["omatalous-talous-example-fi"]);
  });
});

describe("cloudflare down: Access goes last", () => {
  it("empties the routes, removes the record and the tunnel, and only then the application and the policy", async () => {
    const f = fakeCloudflare();
    await up(f);
    const before = f.calls.length;
    const r = await down(f);
    expect(r.code).toBe(0);
    const calls = f.calls.slice(before);
    expect(writeOrder(calls)).toEqual([
      "PUT /accounts/:id/cfd_tunnel/:id/configurations",
      "DELETE /zones/:id/dns_records/:id",
      "DELETE /accounts/:id/cfd_tunnel/:id",
      "DELETE /accounts/:id/access/apps/:id",
      "DELETE /accounts/:id/access/policies/:id",
    ]);
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ config: { ingress: [{ service: "http_status:404" }] } });
  });

  it.each([
    ["DELETE /zones/:id/dns_records/:id"],
    ["DELETE /accounts/:id/cfd_tunnel/:id"],
    ["DELETE /accounts/:id/access/apps/:id"],
  ])("when %s fails the host is never open without Access, and a rerun finishes", async (route) => {
    const f = fakeCloudflare();
    await up(f);
    f.deny.add(route);
    const r = await down(f);
    expect(r.code).toBe(3);
    // no route to the app any more, and while the record or the tunnel exists the application is still in front of it
    expect(f.tunnels.some((t) => routes(t, "talous.example.fi"))).toBe(false);
    if (f.records.length || f.tunnels.length) expect(f.apps).toHaveLength(1);
    f.deny.clear();
    const again = await down(f);
    expect(again.code).toBe(0);
    expect([f.tunnels.length, f.records.length, f.apps.length, f.policies.length]).toEqual([0, 0, 0, 0]);
  });
});

describe("cloudflare in the entry point", () => {
  it("runs before the database and the app secret: a bad command line exits 2 and creates nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "talous-cf-"));
    try {
      const dataDir = join(root, "data");
      const entry = fileURLToPath(new URL("../src/entry/node.ts", import.meta.url));
      const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
      const r = spawnSync(tsx, ["--disable-warning=ExperimentalWarning", entry, "cloudflare", "up", "--name", "talous", "--hostname", "https://talous.example.fi"], {
        env: { PATH: process.env.PATH, DATA_DIR: dataDir, CLOUDFLARE_API_TOKEN: TOKEN },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--hostname must be a plain host name");
      expect(existsSync(dataDir)).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
