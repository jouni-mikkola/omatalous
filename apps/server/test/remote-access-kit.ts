/**
 * What the remote access tests share (Asetukset > Palvelin > Etäkäyttö): an in-memory Cloudflare, a helper played by
 * the test, a data folder and a clock the test moves. No call leaves the process, and every name is example.fi.
 * After each test nothing the app kept or said may hold a token or Cloudflare's own words.
 */
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/platform/config.ts";
import { CLOUDFLARE_API } from "../src/providers/cloudflare/client.ts";
import { pollOps, reportOps, stateOps } from "../src/services/ops.ts";
import { TOKEN_KEY } from "../src/services/remote-access-cloudflare.ts";
import { NOW, SETUP_CODE, setupApp } from "./helpers.ts";

export const PASSWORD = "aino-salasana-123";
export const API_TOKEN = "cfut_0123456789abcdefghijABCDEFGHIJ0123456789";
export const HOST = "talous.example.fi";
export const ANNA = "anna@example.fi";
export const PEKKA = "pekka@example.fi";
export const LIISA = "liisa@example.fi";
/** What the fake says in a refusal: none of it may reach the browser or the log. */
export const CLOUDFLARE_SAID = "WORDS-OF-CLOUDFLARE";
export const LAN = { mode: "lan", port: 8080, address: "http://192.168.1.10:8080" };
export const TUNNEL = { mode: "tunnel", port: 8080, address: `https://${HOST}` };
export const BASE = "/api/admin/remote-access";
export const IN_PROGRESS = "Etäkäytön muutos on jo kesken. Odota, että se valmistuu.";

export type Rec = Record<string, any>;

/** Cloudflare's API as the reconcile steps use it, kept in arrays. */
export function fakeCloudflare() {
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const f = {
    calls: [] as { method: string; path: string; auth: string | null }[],
    zones: [{ id: "zone-main", name: "example.fi", status: "active", account: { id: "acc-main", name: "Example" } }] as Rec[],
    tokenStatus: "active",
    unauthorized: false,
    unreachable: false,
    zeroTrust: true,
    /** Cloudflare still counts connections on the tunnel and will not delete it. */
    stuckTunnels: false,
    tunnels: [] as Rec[],
    records: [] as Rec[],
    idps: [] as Rec[],
    policies: [] as Rec[],
    apps: [] as Rec[],
    /** "METHOD /path/with/:id" that answer 403, and those that answer 400 with a message */
    deny: new Set<string>(),
    reject: new Map<string, string>(),
    writes: () => f.calls.filter((c) => c.method !== "GET").length,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      if (f.unreachable) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      const url = new URL(String(input));
      if (!String(input).startsWith(`${CLOUDFLARE_API}/`)) throw new Error(`request to ${url.origin}`);
      const method = init?.method ?? "GET";
      const path = url.pathname.slice("/client/v4".length);
      f.calls.push({ method, path, auth: new Headers(init?.headers).get("authorization") });
      return f.route(method, path, url.searchParams, init?.body ? JSON.parse(String(init.body)) : undefined);
    }) as typeof fetch,
    route(method: string, path: string, q: URLSearchParams, body: any): Response {
      const ok = (result: unknown) => Response.json({ success: true, errors: [], messages: [], result, result_info: { page: 1, per_page: 100, total_count: Array.isArray(result) ? result.length : 1, total_pages: 1 } });
      const fail = (status: number, message: string, code = 1000) => Response.json({ success: false, errors: [{ code, message: `${CLOUDFLARE_SAID} ${message}` }], messages: [], result: null }, { status });
      const seg = path.split("/").filter(Boolean);
      const shape = `${method} /${seg.map((s, i) => (/^(zone|acc|tunnel|rec|idp|pol|app)-/.test(s) && i > 0 ? ":id" : s)).join("/")}`;
      if (f.unauthorized) return fail(401, "Invalid API Token");
      if (f.deny.has(shape)) return fail(403, "Authentication error", 10000);
      if (f.reject.has(shape)) return fail(400, f.reject.get(shape)!);
      const account = seg[0] === "accounts" ? seg[1]! : "";
      const mine = (list: Rec[]) => list.filter((x) => x.account === account);
      const drop = (list: Rec[], gone: string) => list.filter((x) => x.id !== gone);
      switch (shape) {
        case "GET /user/tokens/verify":
        case "GET /accounts/:id/tokens/verify":
          return ok({ id: "token-id", status: f.tokenStatus });
        case "GET /zones":
          return ok(f.zones);
        case "GET /accounts/:id/access/organizations":
          return f.zeroTrust ? ok({ auth_domain: "example.cloudflareaccess.com", name: "Example" }) : fail(404, "Not found");
        case "GET /accounts/:id/cfd_tunnel":
          return ok(mine(f.tunnels).filter((t) => q.get("name") === null || t.name === q.get("name")).map((t) => ({ ...t, deleted_at: null })));
        case "POST /accounts/:id/cfd_tunnel":
          f.tunnels.push({ id: id("tunnel"), name: body.name, config_src: body.config_src, account, config: null, status: "inactive" });
          return ok(f.tunnels.at(-1));
        case "GET /accounts/:id/cfd_tunnel/:id/configurations":
          return ok({ tunnel_id: seg[3], version: 1, config: f.tunnels.find((x) => x.id === seg[3])!.config });
        case "PUT /accounts/:id/cfd_tunnel/:id/configurations":
          f.tunnels.find((x) => x.id === seg[3])!.config = { ingress: body.config.ingress.map((r: Rec) => ({ ...r, originRequest: {} })) };
          return ok({ tunnel_id: seg[3], version: 2, config: body.config });
        case "GET /accounts/:id/cfd_tunnel/:id/token":
          return ok(`tunnel-token-of-${seg[3]}-0123456789`);
        case "DELETE /accounts/:id/cfd_tunnel/:id/connections":
          return ok({});
        case "DELETE /accounts/:id/cfd_tunnel/:id":
          if (f.stuckTunnels) return fail(400, "Cannot delete tunnel: it has active connections", 1022);
          f.tunnels = drop(f.tunnels, seg[3]!);
          return ok({ id: seg[3] });
        case "GET /zones/:id/dns_records":
          return ok(f.records.filter((r) => r.zone === seg[1] && (q.get("name.exact") === null || r.name === q.get("name.exact"))));
        case "POST /zones/:id/dns_records":
          f.records.push({ id: id("rec"), zone: seg[1]!, ...body });
          return ok(f.records.at(-1));
        case "PATCH /zones/:id/dns_records/:id":
          Object.assign(f.records.find((x) => x.id === seg[3])!, body);
          return ok({});
        case "DELETE /zones/:id/dns_records/:id":
          f.records = drop(f.records, seg[3]!);
          return ok({ id: seg[3] });
        case "GET /accounts/:id/access/identity_providers":
          return ok(mine(f.idps));
        case "POST /accounts/:id/access/identity_providers":
          f.idps.push({ id: id("idp"), account, ...body });
          return ok(f.idps.at(-1));
        case "GET /accounts/:id/access/policies":
          return ok(mine(f.policies).map((p) => ({ ...p, session_duration: "24h0m0s", app_count: f.apps.filter((a) => (a.policies as Rec[]).some((x) => x.id === p.id)).length })));
        case "POST /accounts/:id/access/policies":
          f.policies.push({ id: id("pol"), account, reusable: true, ...body });
          return ok(f.policies.at(-1));
        case "PUT /accounts/:id/access/policies/:id":
          Object.assign(f.policies.find((x) => x.id === seg[4])!, body);
          return ok({});
        case "DELETE /accounts/:id/access/policies/:id":
          f.policies = drop(f.policies, seg[4]!);
          return ok({ id: seg[4] });
        case "GET /accounts/:id/access/apps":
          return ok(mine(f.apps).map((a) => ({ ...a, session_duration: "24h0m0s" })));
        case "POST /accounts/:id/access/apps": {
          const appId = id("app");
          f.apps.push({ id: appId, account, aud: createHash("sha256").update(appId).digest("hex"), ...body });
          return ok(f.apps.at(-1));
        }
        case "PUT /accounts/:id/access/apps/:id":
          Object.assign(f.apps.find((x) => x.id === seg[4])!, body);
          return ok({});
        case "DELETE /accounts/:id/access/apps/:id":
          f.apps = drop(f.apps, seg[4]!);
          return ok({ id: seg[4] });
      }
      throw new Error(`the fake has no route ${shape}`);
    },
  };
  return f;
}

/** Every console line of the test: none may hold a token or Cloudflare's words. */
export const logged: string[] = [];
/** The team whose key signs the Access tokens of `behindAccess`. */
const TEAM = "example.cloudflareaccess.com";
const teamKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const worlds: { s: Awaited<ReturnType<typeof setupApp>>["s"]; answers: string[]; dir: string }[] = [];

/** An app with its admin, a fake Cloudflare behind its fetch, a data folder and a clock the test moves. */
export async function world(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "remote-access-"));
  const cf = fakeCloudflare();
  let at = NOW.getTime();
  // through `cf`, so a test can put its own fetch in front of the fake
  const t = await setupApp(env, ((input, init) => cf.fetch(input, init)) as typeof fetch, { backupDir: join(dir, "backups"), now: () => new Date(at) });
  const answers: string[] = [];
  const call = async (method: string, path: string, payload?: unknown) => {
    const r = await t.admin.call(method, `${BASE}${path}`, payload);
    answers.push(JSON.stringify(r.body));
    return r;
  };
  const w = {
    ...t,
    cf,
    dir,
    answers,
    call,
    file: join(dir, "ops", "access-request.json"),
    now: () => new Date(at),
    /** Past the one change a minute that maintenance requests allow. */
    later: (ms = 61_000) => void (at += ms),
    /** The helper's heartbeat: how the host runs. */
    host: (state: Rec, version = "3") => stateOps(t.s, { state }, version),
    /** The helper takes the request that waits and reports how it went, with the host as it is after it. */
    async helper(status: "ok" | "failed", state: Rec, summary = status === "ok" ? "Etäkäyttö on päivitetty." : "Tunneli ei käynnistynyt.", output = "") {
      const polled = await pollOps(t.s, { helper: "3", done: [] });
      expect(polled?.action).toBe("access");
      await reportOps(t.s, { id: polled!.id, status, exit_code: status === "ok" ? 0 : 1, summary, output, state }, "3");
    },
    /** The address the helper says the copy answers at after `lan`, put into its stored state as it is. */
    async lanAddress(address: string) {
      const state = JSON.parse((await t.s.settings.get("ops_state")) ?? "{}") as Rec;
      await t.s.settings.set("ops_state", JSON.stringify({ ...state, lanAddress: address }));
    },
    /** Makes the request file look as if it was written three minutes ago. */
    age() {
      const then = Date.now() / 1000 - 180;
      utimesSync(w.file, then, then);
    },
    /**
     * The app as the helper starts it again after `tunnel`: the same database, with the pair in its config. `visit`
     * is a request through the tunnel, with the token Access adds after a sign-in or without one. `call` is the
     * admin's own call through the tunnel: `email` is the address Access checked, and a service token has none.
     */
    behindAccess(aud: string = cf.apps[0]!.aud) {
      const certs = { keys: [{ kid: "key-1", alg: "RS256", use: "sig", ...teamKey.publicKey.export({ format: "jwk" }) }] };
      const send = (async (input: string | URL | Request, init?: RequestInit) => (String(input) === `https://${TEAM}/cdn-cgi/access/certs` ? Response.json(certs) : cf.fetch(input, init))) as typeof fetch;
      const env = { PASSWORD_ITERATIONS: "1000", APP_SECRET: t.s.config.appSecret!, SETUP_CODE, APP_BASE_URL: `https://${HOST}`, INDUSTRY_LOOKUP: "false", TRUST_PROXY: "true" };
      const app = createApp({ db: t.db, config: loadConfig({ ...env, CF_ACCESS_AUD: aud, CF_ACCESS_TEAM_DOMAIN: TEAM }), now: () => new Date(at), fetch: send, backupDir: join(dir, "backups") });
      const token = (claims: Rec = {}) => {
        const seconds = Math.floor(at / 1000);
        const signed = `${b64({ alg: "RS256", typ: "JWT", kid: "key-1" })}.${b64({ aud: [aud], iss: `https://${TEAM}`, iat: seconds, nbf: seconds, exp: seconds + 3600, ...claims })}`;
        return `${signed}.${createSign("RSA-SHA256").update(signed).sign(teamKey.privateKey).toString("base64url")}`;
      };
      const through = { "CF-Connecting-IP": "198.51.100.7" };
      const visit = (signedIn: boolean) => app.request(`https://${HOST}/api/auth/me`, { headers: { ...through, ...(signedIn ? { "Cf-Access-Jwt-Assertion": token() } : {}) } });
      const call = async (method: string, path: string, payload: unknown, email?: string) => {
        const headers = { ...through, "Content-Type": "application/json", "X-Requested-With": "fetch", Cookie: t.admin.cookie, "Cf-Access-Jwt-Assertion": token(email ? { email } : { common_name: "palvelutunnus" }) };
        const res = await app.request(`https://${HOST}${BASE}${path}`, { method, headers, body: JSON.stringify(payload) });
        const body = (await res.json()) as Rec;
        answers.push(JSON.stringify(body));
        return { status: res.status, body };
      };
      return { s: app.services, visit, call };
    },
    state: async () => (await call("GET", "")).body,
    record: async () => JSON.parse((await t.s.settings.get("remote_access")) ?? "{}") as Rec,
    events: async (kind: string) => (await t.s.security.list({ limit: 500 })).filter((e) => e.kind === kind).map((e) => e.detail),
    saveToken: () => call("PUT", "/token", { token: API_TOKEN, password: PASSWORD }),
    removeToken: (password: unknown = PASSWORD) => call("DELETE", "/token", { password }),
    on: (emails: unknown = [ANNA, PEKKA], hostname: unknown = HOST) => call("POST", "/on", { hostname, emails, password: PASSWORD }),
    off: (password = PASSWORD, more: Rec = {}) => call("POST", "/off", { password, ...more }),
  };
  worlds.push(w);
  return w;
}

/** The helper runs on a LAN host and the API token is saved. */
export async function prepared() {
  const w = await world();
  await w.host(LAN);
  expect((await w.saveToken()).status).toBe(200);
  return w;
}

/** Remote access is on for Anna and Pekka, and a minute has passed. */
export async function turnedOn() {
  const w = await prepared();
  expect((await w.on()).status).toBe(200);
  await w.helper("ok", TUNNEL);
  w.later();
  expect((await w.state()).access).toMatchObject({ on: true, hostname: HOST });
  return w;
}

beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => void logged.push(parts.map(String).join(" ")));
});

afterEach(async () => {
  for (const w of worlds.splice(0)) {
    const kept = [await w.s.settings.get(TOKEN_KEY), await w.s.settings.get("remote_access"), JSON.stringify(await w.s.security.list({ limit: 500 })), JSON.stringify(await w.s.ops.recent(40))];
    const seen = [...w.answers, ...logged, ...kept].join("\n");
    expect(seen).not.toContain(API_TOKEN);
    expect(seen).not.toContain("tunnel-token-of-");
    expect(seen).not.toContain(CLOUDFLARE_SAID);
    rmSync(w.dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
