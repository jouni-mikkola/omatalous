import { createHmac, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadConfig } from "../src/platform/config.ts";
import { ACCESS_FAILURES, ACCESS_REFETCH_MS, ACCESS_REFUSAL, ACCESS_WINDOW_MS, type AccessRefusal, AccessVerifier } from "../src/security/cf-access.ts";
import { NOW, SETUP_CODE, setupApp } from "./helpers.ts";

/** The app's own check of Cloudflare Access. A made-up team, application and keys; nothing leaves the process. */
const TEAM = "kotitiimi.cloudflareaccess.com";
const ISSUER = `https://${TEAM}`;
const AUD = "0123456789abcdef".repeat(4);
const OTHER_AUD = "fedcba9876543210".repeat(4);
const CERTS = `${ISSUER}/cdn-cgi/access/certs`;
const T0 = NOW.getTime();
const SECONDS = Math.floor(T0 / 1000);

const rsa = (bits = 2048) => generateKeyPairSync("rsa", { modulusLength: bits });
const team1 = rsa();
const team2 = rsa();
const stranger = rsa();
const weak = rsa(1024);

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const claimsNow = (over: Record<string, unknown> = {}) => ({ aud: [AUD], iss: ISSUER, iat: SECONDS, nbf: SECONDS, exp: SECONDS + 3600, type: "app", sub: "user-1", ...over });
/** A token as Access signs it: RS256 over header.payload with the team's private key. */
function token(over: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key: KeyObject = team1.privateKey): string {
  const signed = `${b64({ alg: "RS256", typ: "JWT", kid: "key-1", ...header })}.${b64(claimsNow(over))}`;
  return `${signed}.${createSign("RSA-SHA256").update(signed).sign(key).toString("base64url")}`;
}

/** The team's `/cdn-cgi/access/certs`, as a fetch. */
function fakeTeam(keys: Record<string, KeyObject> = { "key-1": team1.publicKey }) {
  const t = {
    keys,
    calls: [] as { url: string; init?: RequestInit }[],
    /** "down": the fetch throws. A number: that HTTP status. A string: that body. */
    fault: null as null | "down" | number | string,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      t.calls.push({ url: String(input), init });
      if (t.fault === "down") throw new TypeError("fetch failed");
      if (typeof t.fault === "number") return new Response("no", { status: t.fault });
      if (typeof t.fault === "string") return new Response(t.fault);
      return Response.json({ keys: Object.entries(t.keys).map(([kid, k]) => ({ kid, alg: "RS256", use: "sig", ...k.export({ format: "jwk" }) })), public_cert: { kid: "key-1", cert: "x" }, public_certs: [] });
    }) as typeof fetch,
  };
  return t;
}

function verifier(team = fakeTeam()) {
  const clock = { ms: T0 };
  const v = new AccessVerifier({ aud: AUD, teamDomain: TEAM }, team.fetch, () => clock.ms);
  const reason = async (t: string | undefined): Promise<AccessRefusal | "ok"> => {
    const r = await v.verify(t);
    return r.ok ? "ok" : r.reason;
  };
  return { v, team, clock, reason };
}

// a failed key fetch writes one line to the log
afterEach(() => void vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("config: CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN", () => {
  it("neither set: the check is off", () => {
    expect(loadConfig({}).access).toBeNull();
    expect(loadConfig({ CF_ACCESS_AUD: "", CF_ACCESS_TEAM_DOMAIN: " " }).access).toBeNull();
  });

  it("both set: the pair, lower case", () => {
    expect(loadConfig({ CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM }).access).toEqual({ aud: AUD, teamDomain: TEAM });
    expect(loadConfig({ CF_ACCESS_AUD: ` ${AUD.toUpperCase()} `, CF_ACCESS_TEAM_DOMAIN: "KotiTiimi.CloudflareAccess.com" }).access).toEqual({ aud: AUD, teamDomain: TEAM });
  });

  it("half a pair stops the start", () => {
    expect(() => loadConfig({ CF_ACCESS_AUD: AUD })).toThrow(/go together/);
    expect(() => loadConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM })).toThrow(/go together/);
    expect(() => loadConfig({ CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: "" })).toThrow(/go together/);
  });

  it.each([
    ["63 characters", AUD.slice(1)],
    ["65 characters", `${AUD}0`],
    ["not hex", `${AUD.slice(1)}g`],
    ["two tags", `${AUD},${OTHER_AUD}`],
  ])("an aud that is not 64 hex characters stops the start: %s", (_name, aud) => {
    expect(() => loadConfig({ CF_ACCESS_AUD: aud, CF_ACCESS_TEAM_DOMAIN: TEAM })).toThrow(/CF_ACCESS_AUD/);
  });

  it.each([
    "https://kotitiimi.cloudflareaccess.com",
    "kotitiimi.cloudflareaccess.com/",
    "kotitiimi.cloudflareaccess.com:8443",
    "kotitiimi.cloudflareaccess.com.example.fi",
    "example.fi/kotitiimi.cloudflareaccess.com",
    "user@kotitiimi.cloudflareaccess.com",
    "example.fi#.cloudflareaccess.com",
    "a.b.cloudflareaccess.com",
    "-koti.cloudflareaccess.com",
    ".cloudflareaccess.com",
    "cloudflareaccess.com",
    "kotitiimi.cloudflareaccess.co",
    "kotitiimi.example.fi",
  ])("a team domain that is not <label>.cloudflareaccess.com stops the start: %s", (teamDomain) => {
    expect(() => loadConfig({ CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: teamDomain })).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
  });
});

describe("the token", () => {
  it("a token signed by the team for this application passes", async () => {
    const { reason, team } = verifier();
    expect(await reason(token())).toBe("ok");
    // aud may be one string
    expect(await reason(token({ aud: AUD }))).toBe("ok");
    expect(await reason(token({ aud: [OTHER_AUD, AUD] }))).toBe("ok");
    // the keys came from the team domain, once, and a redirect is not followed
    expect(team.calls.map((c) => c.url)).toEqual([CERTS]);
    expect(team.calls[0]!.init?.redirect).toBe("error");
  });

  it("no header is refused", async () => {
    const { reason, team } = verifier();
    expect(await reason(undefined)).toBe("missing");
    expect(await reason("")).toBe("missing");
    expect(team.calls).toHaveLength(0);
  });

  it("what is not a token is refused before any key is fetched", async () => {
    const { reason, team } = verifier();
    const [head, body, sig] = token().split(".") as [string, string, string];
    for (const t of ["x", "a.b", `${head}.${body}`, `${head}.${body}.`, `${head}.${body}.${sig}.x`, `${head}.${body}.${sig}=`, `${head}.${body}.a+b/`, `${b64("[1]")}.${body}.${sig}`, `${b64("not json")}.${body}.${sig}`, `${"a".repeat(9000)}.${body}.${sig}`]) {
      expect(await reason(t), t.slice(0, 40)).toBe("malformed");
    }
    // without a kid, or with a crit header, the token names no key of ours
    expect(await reason(token({}, { kid: undefined }))).toBe("malformed");
    expect(await reason(token({}, { kid: 7 }))).toBe("malformed");
    expect(await reason(token({}, { crit: ["exp"] }))).toBe("malformed");
    expect(team.calls).toHaveLength(0);
  });

  it("alg none is refused, signed or not", async () => {
    const { reason, team } = verifier();
    const unsigned = `${b64({ alg: "none", typ: "JWT", kid: "key-1" })}.${b64(claimsNow())}`;
    expect(await reason(`${unsigned}.`)).toBe("malformed");
    expect(await reason(`${unsigned}.AAAA`)).toBe("algorithm");
    // the real signature under a header that says none
    expect(await reason(token({}, { alg: "none" }))).toBe("algorithm");
    expect(team.calls).toHaveLength(0);
  });

  it("HS256 signed with the public key as the secret is refused", async () => {
    const { reason } = verifier();
    const pem = team1.publicKey.export({ type: "spki", format: "pem" });
    const hmac = (head: Record<string, unknown>) => {
      const signed = `${b64(head)}.${b64(claimsNow())}`;
      return `${signed}.${createHmac("sha256", pem).update(signed).digest("base64url")}`;
    };
    expect(await reason(hmac({ alg: "HS256", typ: "JWT", kid: "key-1" }))).toBe("algorithm");
    // the same signature under a header that says RS256: the RSA check does not take it
    expect(await reason(hmac({ alg: "RS256", typ: "JWT", kid: "key-1" }))).toBe("signature");
  });

  it.each([["RS384"], ["RS512"], ["PS256"], ["ES256"], ["HS512"], ["rs256"], [""], [null], [["RS256"]]])("alg %j is refused: only RS256 counts", async (alg) => {
    const { reason } = verifier();
    expect(await reason(token({}, { alg }))).toBe("algorithm");
  });

  it("a signature by another key, or over other content, is refused", async () => {
    const { reason } = verifier();
    expect(await reason(token({}, {}, stranger.privateKey))).toBe("signature");
    const [head, , sig] = token().split(".") as [string, string, string];
    // the payload swapped under a good signature
    expect(await reason(`${head}.${b64(claimsNow({ sub: "admin" }))}.${sig}`)).toBe("signature");
    expect(await reason(`${head}.${b64(claimsNow())}.AAAA`)).toBe("signature");
  });

  it("a wrong aud is refused", async () => {
    const { reason } = verifier();
    expect(await reason(token({ aud: [OTHER_AUD] }))).toBe("audience");
    expect(await reason(token({ aud: OTHER_AUD }))).toBe("audience");
    expect(await reason(token({ aud: [] }))).toBe("audience");
    expect(await reason(token({ aud: undefined }))).toBe("audience");
    expect(await reason(token({ aud: [[AUD]] }))).toBe("audience");
    expect(await reason(token({ aud: `${AUD} ` }))).toBe("audience");
  });

  it("a wrong issuer is refused", async () => {
    const { reason } = verifier();
    expect(await reason(token({ iss: "https://toinen.cloudflareaccess.com" }))).toBe("issuer");
    expect(await reason(token({ iss: TEAM }))).toBe("issuer");
    expect(await reason(token({ iss: `${ISSUER}/` }))).toBe("issuer");
    expect(await reason(token({ iss: undefined }))).toBe("issuer");
    expect(await reason(token({ iss: [ISSUER] }))).toBe("issuer");
  });

  it("an expired token is refused, with 60 s of skew", async () => {
    const { reason } = verifier();
    expect(await reason(token({ exp: SECONDS - 59 }))).toBe("ok");
    expect(await reason(token({ exp: SECONDS - 60 }))).toBe("expired");
    expect(await reason(token({ exp: SECONDS - 3600 }))).toBe("expired");
    expect(await reason(token({ exp: undefined }))).toBe("expired");
    expect(await reason(token({ exp: String(SECONDS + 3600) }))).toBe("expired");
  });

  it("a token that is not valid yet is refused, with 60 s of skew", async () => {
    const { reason, clock } = verifier();
    expect(await reason(token({ nbf: SECONDS + 60 }))).toBe("ok");
    expect(await reason(token({ nbf: SECONDS + 61 }))).toBe("not_yet");
    expect(await reason(token({ nbf: "soon" }))).toBe("not_yet");
    // nbf is optional in a JWT
    expect(await reason(token({ nbf: undefined }))).toBe("ok");
    // the same token passes once its time has come, and stops when it ends
    const later = token({ nbf: SECONDS + 600, exp: SECONDS + 1200 });
    expect(await reason(later)).toBe("not_yet");
    clock.ms = T0 + 600_000;
    expect(await reason(later)).toBe("ok");
    clock.ms = T0 + 1_260_000;
    expect(await reason(later)).toBe("expired");
  });
});

describe("the team's keys", () => {
  it("are fetched once and then kept", async () => {
    const { reason, team } = verifier();
    for (let i = 0; i < 5; i++) expect(await reason(token())).toBe("ok");
    expect(team.calls).toHaveLength(1);
  });

  it("an unknown kid is refused and fetches the keys again at most once a minute", async () => {
    const { reason, team, clock } = verifier();
    expect(await reason(token())).toBe("ok");
    expect(team.calls).toHaveLength(1);
    // inside the minute of that fetch: refused, and nothing is fetched whatever kid is named
    expect(await reason(token({}, { kid: "key-9" }, stranger.privateKey))).toBe("unknown_key");
    for (let i = 0; i < 20; i++) expect(await reason(token({}, { kid: `made-up-${i}` }, stranger.privateKey))).toBe("unknown_key");
    clock.ms += ACCESS_REFETCH_MS - 1;
    expect(await reason(token({}, { kid: "key-9" }, stranger.privateKey))).toBe("unknown_key");
    expect(team.calls).toHaveLength(1);
    // the minute is over: one fetch, and then none again for a minute
    clock.ms += 1;
    expect(await reason(token({}, { kid: "key-9" }, stranger.privateKey))).toBe("unknown_key");
    expect(team.calls).toHaveLength(2);
    for (let i = 0; i < 20; i++) expect(await reason(token({}, { kid: `made-up-${i}` }, stranger.privateKey))).toBe("unknown_key");
    expect(team.calls).toHaveLength(2);
    // the known key was good all along
    expect(await reason(token())).toBe("ok");
  });

  it("a new key of the team is found by its kid, and a key the team dropped stops counting", async () => {
    const { reason, team, clock } = verifier();
    expect(await reason(token())).toBe("ok");
    team.keys = { "key-2": team2.publicKey };
    clock.ms += ACCESS_REFETCH_MS;
    expect(await reason(token({}, { kid: "key-2" }, team2.privateKey))).toBe("ok");
    expect(await reason(token())).toBe("unknown_key");
    // the kid picks the key: key-1's signature under key-2's name does not pass
    expect(await reason(token({}, { kid: "key-2" }, team1.privateKey))).toBe("signature");
  });

  it("requests that arrive during a fetch share it", async () => {
    const { reason, team } = verifier();
    expect(await Promise.all([reason(token()), reason(token()), reason(token({}, { kid: "key-9" }))])).toEqual(["ok", "ok", "unknown_key"]);
    expect(team.calls).toHaveLength(1);
  });

  it.each([
    ["the fetch throws", "down"],
    ["HTTP 500", 500],
    ["HTTP 404", 404],
    ["not JSON", "<html>"],
    ["no keys", JSON.stringify({ keys: [] })],
    ["no key list", JSON.stringify({ public_certs: [] })],
  ] as const)("a failed fetch with nothing held refuses the request: %s", async (_name, fault) => {
    const errors = quiet();
    const { reason, team, clock } = verifier();
    team.fault = fault;
    expect(await reason(token())).toBe("no_keys");
    expect(await reason(token())).toBe("no_keys");
    expect(team.calls).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toContain("Requests are refused until a fetch works");
    // a minute later the fetch works and the same token passes
    team.fault = null;
    clock.ms += ACCESS_REFETCH_MS;
    expect(await reason(token())).toBe("ok");
  });

  it("a failed fetch keeps the keys held", async () => {
    const errors = quiet();
    const { reason, team, clock } = verifier();
    expect(await reason(token())).toBe("ok");
    team.fault = "down";
    clock.ms += ACCESS_REFETCH_MS;
    expect(await reason(token({}, { kid: "key-2" }, team2.privateKey))).toBe("unknown_key");
    expect(team.calls).toHaveLength(2);
    expect(String(errors.mock.calls[0]![0])).toContain("The keys held are used");
    expect(await reason(token())).toBe("ok");
    // an answer without a usable key is a failed fetch too
    team.fault = JSON.stringify({ keys: [] });
    clock.ms += ACCESS_REFETCH_MS;
    expect(await reason(token({}, { kid: "key-2" }, team2.privateKey))).toBe("unknown_key");
    expect(await reason(token())).toBe("ok");
  });

  it("an answer longer than the limit is a failed fetch, and reading it stops at the limit", async () => {
    quiet();
    const team = fakeTeam();
    let chunks = 0;
    // 200 chunks of 64 kB: the limit is 256 kB
    const long = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (++chunks > 200) controller.close();
          else controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
        },
      });
    team.fetch = (async () => new Response(long())) as unknown as typeof fetch;
    const { reason } = verifier(team);
    expect(await reason(token())).toBe("no_keys");
    expect(chunks).toBeLessThan(10);
  });

  it("takes only RSA signing keys of 2048 bits or more from the answer", async () => {
    quiet();
    const jwk = (k: KeyObject) => k.export({ format: "jwk" });
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const entries = [
      { kid: "weak", alg: "RS256", ...jwk(weak.publicKey) },
      { kid: "ec", ...jwk(ec.publicKey) },
      { kid: "enc", use: "enc", ...jwk(team2.publicKey) },
      { kid: "ps", alg: "PS256", ...jwk(team2.publicKey) },
      { kid: "oct", kty: "oct", k: b64("secret") },
      { kid: 5, ...jwk(team2.publicKey) },
      { kid: "broken", kty: "RSA", n: "AQAB", e: "" },
      "text",
      null,
    ];
    const team = fakeTeam();
    team.fault = JSON.stringify({ keys: entries });
    const { reason, clock } = verifier(team);
    expect(await reason(token({}, { kid: "weak" }, weak.privateKey))).toBe("no_keys");
    for (const kid of ["enc", "ps"]) expect(await reason(token({}, { kid }, team2.privateKey))).toBe("no_keys");
    // with one good key beside them, the others are still not keys
    team.fault = JSON.stringify({ keys: [...entries, { kid: "key-1", ...jwk(team1.publicKey) }] });
    clock.ms += ACCESS_REFETCH_MS;
    expect(await reason(token())).toBe("ok");
    expect(await reason(token({}, { kid: "weak" }, weak.privateKey))).toBe("unknown_key");
  });
});

/** An app with the check on, behind a proxy that names the client (TRUST_PROXY), with no user yet. */
async function accessApp(team = fakeTeam(), env: Record<string, string> = {}) {
  const { db } = await openDatabase(":memory:");
  const config = loadConfig({
    PASSWORD_ITERATIONS: "1000",
    APP_SECRET: "test-secret-that-is-long-enough-0123456789",
    SETUP_CODE,
    APP_BASE_URL: "https://talous.example.fi",
    INDUSTRY_LOOKUP: "false",
    TRUST_PROXY: "true",
    CF_ACCESS_AUD: AUD,
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    ...env,
  });
  const clock = { ms: T0 };
  const app = createApp({ db, config, now: () => new Date(clock.ms), fetch: team.fetch });
  // what entry/node.ts adds after createApp: the static files and the page itself
  app.get("*", (c) => c.text("the page"));
  const call = (path: string, opts: { token?: string; ip?: string; method?: string } = {}) =>
    app.request(`https://talous.example.fi${path}`, {
      method: opts.method ?? "GET",
      headers: { "CF-Connecting-IP": opts.ip ?? "198.51.100.7", "X-Requested-With": "fetch", ...(opts.token === undefined ? {} : { "Cf-Access-Jwt-Assertion": opts.token }) },
    });
  const lockouts = () => app.services.security.list({ kind: "lockout", limit: 50 });
  return { app, team, clock, call, lockouts };
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(403);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await res.text()).toBe(ACCESS_REFUSAL);
}

describe("the app with the check on", () => {
  it("a request with Access's token gets the app", async () => {
    const { call } = await accessApp();
    const state = await call("/api/auth/state", { token: token() });
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ needsSetup: true, user: null });
    const page = await call("/", { token: token() });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("the page");
  });

  it("a request without the header gets 403 and one Finnish line, whatever it asks for", async () => {
    const { call, team } = await accessApp();
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/index.html"],
      ["GET", "/assets/index-abc123.js"],
      ["GET", "/api/auth/state"],
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/setup"],
      ["GET", "/api/connections/callback?code=x&state=y"],
      ["GET", "/api/transactions"],
      ["OPTIONS", "/api/auth/login"],
      ["HEAD", "/"],
    ] as const) {
      const res = await call(path, { method });
      if (method === "HEAD") expect(res.status).toBe(403);
      else await expectRefused(res);
    }
    // nothing was fetched for requests that carry no token
    expect(team.calls).toHaveLength(0);
  });

  it("every refusal looks the same and says nothing about why", async () => {
    quiet();
    const [head, body] = token().split(".") as [string, string];
    const pem = team1.publicKey.export({ type: "spki", format: "pem" });
    const hs = `${b64({ alg: "HS256", typ: "JWT", kid: "key-1" })}.${body}`;
    const bad: Record<string, string | undefined> = {
      missing: undefined,
      empty: "",
      garbage: "not-a-token",
      "wrong aud": token({ aud: [OTHER_AUD] }),
      "wrong issuer": token({ iss: "https://toinen.cloudflareaccess.com" }),
      expired: token({ exp: SECONDS - 3600 }),
      "not yet": token({ nbf: SECONDS + 3600 }),
      "alg none": `${b64({ alg: "none", typ: "JWT", kid: "key-1" })}.${body}.AAAA`,
      "HS256 with the public key": `${hs}.${createHmac("sha256", pem).update(hs).digest("base64url")}`,
      "unknown kid": token({}, { kid: "key-9" }, stranger.privateKey),
      "another key": token({}, {}, stranger.privateKey),
      "no signature": `${head}.${body}.`,
    };
    const seen = new Set<string>();
    let n = 0;
    for (const [name, t] of Object.entries(bad)) {
      // an address of its own each, so the limiter is not what refuses
      const { call } = await accessApp();
      const res = await call("/api/auth/state", { token: t, ip: `198.51.100.${++n}` });
      seen.add(JSON.stringify([res.status, [...res.headers.entries()].sort()]));
      await expectRefused(res).catch((e) => {
        throw new Error(`${name}: ${(e as Error).message}`);
      });
    }
    expect(seen.size).toBe(1);
    // a failed key fetch with nothing held
    const team = fakeTeam();
    team.fault = "down";
    const { call } = await accessApp(team);
    const res = await call("/api/auth/state", { token: token() });
    seen.add(JSON.stringify([res.status, [...res.headers.entries()].sort()]));
    await expectRefused(res);
    expect(seen.size).toBe(1);
  });

  it("a refusal still carries the security headers", async () => {
    const { call } = await accessApp();
    const res = await call("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("GET /api/health passes without a token, and only that", async () => {
    const { call, team } = await accessApp();
    const health = await call("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect((await call("/api/health?from=docker")).status).toBe(200);
    for (const [method, path] of [
      ["POST", "/api/health"],
      ["HEAD", "/api/health"],
      ["GET", "/api/health/"],
      ["GET", "/api/health/x"],
      ["GET", "/api/healthz"],
      ["GET", "//api/health"],
      ["GET", "/API/health"],
    ] as const) {
      expect((await call(path, { method })).status, `${method} ${path}`).toBe(403);
    }
    expect(team.calls).toHaveLength(0);
  });

  it("an address with too many failed checks is refused without a look at its token, and that is one security event", async () => {
    const { call, team, clock, lockouts } = await accessApp();
    const A = "198.51.100.7";
    const B = "203.0.113.9";
    const good = token({ exp: SECONDS + 86_400 });
    expect((await call("/api/auth/state", { token: good, ip: A })).status).toBe(200);
    for (let i = 0; i < ACCESS_FAILURES; i++) await expectRefused(await call("/", { token: token({ aud: [OTHER_AUD] }), ip: A }));
    expect(await lockouts()).toHaveLength(0);
    const fetched = team.calls.length;

    // from here the address is refused whatever it sends: a good token too, and an unknown kid fetches nothing
    clock.ms += ACCESS_REFETCH_MS;
    await expectRefused(await call("/api/auth/state", { token: good, ip: A }));
    await expectRefused(await call("/", { token: token({}, { kid: "key-9" }, stranger.privateKey), ip: A }));
    await expectRefused(await call("/", { ip: A }));
    expect(team.calls).toHaveLength(fetched);
    const events = await lockouts();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "lockout", ip: A, detail: "Cloudflare Access", userId: null });

    // another address is not touched, and health still answers the first
    expect((await call("/api/auth/state", { token: good, ip: B })).status).toBe(200);
    expect((await call("/api/health", { ip: A })).status).toBe(200);

    // the window ends: the address is checked again, and a new run of failures is a new event
    clock.ms = T0 + ACCESS_WINDOW_MS;
    expect((await call("/api/auth/state", { token: good, ip: A })).status).toBe(200);
    for (let i = 0; i < ACCESS_FAILURES + 1; i++) await expectRefused(await call("/", { ip: A }));
    expect(await lockouts()).toHaveLength(2);
  });

  it("requests that pass are not counted", async () => {
    const { call } = await accessApp();
    for (let i = 0; i < ACCESS_FAILURES * 3; i++) expect((await call("/api/auth/state", { token: token() })).status).toBe(200);
    // and the failures before the limit leave a good token alone
    for (let i = 0; i < ACCESS_FAILURES - 1; i++) await expectRefused(await call("/"));
    expect((await call("/api/auth/state", { token: token() })).status).toBe(200);
  });

  it("an IPv6 client is counted by its /64", async () => {
    const { call, lockouts } = await accessApp();
    for (let i = 0; i < ACCESS_FAILURES; i++) await expectRefused(await call("/", { ip: `2001:db8:1:2::${i + 1}` }));
    await expectRefused(await call("/api/auth/state", { token: token(), ip: "2001:db8:1:2:ffff::1" }));
    expect(await lockouts()).toHaveLength(1);
    expect((await call("/api/auth/state", { token: token(), ip: "2001:db8:1:3::1" })).status).toBe(200);
  });

  it("refusals for lack of keys are not counted against the address", async () => {
    quiet();
    const team = fakeTeam();
    team.fault = "down";
    const { call, clock, lockouts } = await accessApp(team);
    for (let i = 0; i < ACCESS_FAILURES * 2; i++) await expectRefused(await call("/api/auth/state", { token: token() }));
    expect(team.calls).toHaveLength(1);
    team.fault = null;
    clock.ms += ACCESS_REFETCH_MS;
    expect((await call("/api/auth/state", { token: token() })).status).toBe(200);
    expect(await lockouts()).toHaveLength(0);
  });

  it("tokens of a key the team just moved to are not counted while its keys cannot be fetched", async () => {
    quiet();
    const team = fakeTeam();
    const { call, clock, lockouts } = await accessApp(team);
    expect((await call("/api/auth/state", { token: token() })).status).toBe(200);
    // the team rotates to key-2 and the fetch for it fails: key-1 stays held, so every new token names an unknown key
    team.keys = { "key-2": team2.publicKey };
    team.fault = "down";
    const rotated = () => token({}, { kid: "key-2" }, team2.privateKey);
    for (let i = 0; i < ACCESS_FAILURES * 2; i++) await expectRefused(await call("/api/auth/state", { token: rotated() }));
    team.fault = null;
    clock.ms += ACCESS_REFETCH_MS;
    expect((await call("/api/auth/state", { token: rotated() })).status).toBe(200);
    expect(await lockouts()).toHaveLength(0);
  });

  it("the app's own login still decides after Access", async () => {
    const { call } = await accessApp();
    // Access's token is not a session
    expect((await call("/api/transactions", { token: token() })).status).toBe(401);
  });
});

describe("the app without the two keys", () => {
  it("checks nothing and fetches nothing", async () => {
    const team = fakeTeam();
    const { app, s, admin } = await setupApp({}, team.fetch);
    expect(s.config.access).toBeNull();
    expect((await admin.call("GET", "/api/auth/state")).status).toBe(200);
    // the header means nothing here, good or bad
    expect((await admin.call("GET", "/api/auth/state", undefined, { "Cf-Access-Jwt-Assertion": "garbage" })).status).toBe(200);
    expect((await app.request("http://localhost:8080/api/auth/state")).status).toBe(200);
    expect((await app.request("http://localhost:8080/api/health")).status).toBe(200);
    expect(team.calls).toHaveLength(0);
  });
});
