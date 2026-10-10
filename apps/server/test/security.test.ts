import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/platform/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { parseBankCsv } from "@banking/core";
import { checkAuthUrl, EnableBankingClient } from "../src/connectors/enable-banking/client.ts";
import { csv } from "../src/routes/shared.ts";
import { mockBank } from "./mock-bank.ts";
import { NOW, SETUP_CODE, setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENV = { PASSWORD_ITERATIONS: "1000", APP_SECRET: "test-secret-that-is-long-enough-0123456789", SETUP_CODE, APP_BASE_URL: "http://localhost:8080", INDUSTRY_LOOKUP: "false" };

/** An app before first-run setup. */
async function bareApp(env: Record<string, string> = {}) {
  const { db } = await openDatabase(":memory:");
  const app = createApp({ db, config: loadConfig({ ...ENV, ...env }), now: () => NOW });
  const call = (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://localhost:8080${path}`, { method, headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { app, db, call };
}

describe("login limits", () => {
  it("counts attempts before the password is checked: a parallel burst gets at most 10 verifications", async () => {
    const { client, adminId } = await setupApp();
    const guesses = await Promise.all(Array.from({ length: 40 }, (_, i) => client().call("POST", "/api/auth/login", { username: "aino", password: `wrong-${i}-password` })));
    const statuses = guesses.map((g) => g.status);
    expect(statuses.filter((x) => x === 401).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((x) => x === 429).length).toBeGreaterThanOrEqual(30);
    expect(statuses.every((x) => x === 401 || x === 429)).toBe(true);
    expect(adminId).toBeTruthy();
  });

  it("limits concurrent password hashes and refuses the rest at once", async () => {
    const { client, s } = await setupApp();
    for (let i = 0; i < 4; i++) expect(s.hashGate.tryEnter()).toBe(true);
    const busy = await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    expect(busy.status).toBe(429);
    expect(busy.res.headers.get("retry-after")).toBeTruthy();
    for (let i = 0; i < 4; i++) s.hashGate.leave();
    // a refused attempt is not counted against the user
    expect((await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
  });

  it("a stranger's guesses at a user name do not lock that user out from another address", async () => {
    const { client } = await setupApp({ TRUST_PROXY: "true" });
    const attacker = { "X-Forwarded-For": "203.0.113.9" };
    for (let i = 0; i < 12; i++) await client().call("POST", "/api/auth/login", { username: "aino", password: `nope-${i}-password` }, attacker);
    expect((await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, attacker)).status).toBe(429);
    const home = await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, { "X-Forwarded-For": "192.168.1.20" });
    expect(home.status).toBe(200);
  });

  it("a successful login gives its attempt back, so a household behind one address is not used up", async () => {
    const { client, s } = await setupApp();
    for (let i = 0; i < 60; i++) expect((await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    expect(s.loginLimiter.ip.check("local")).toBe(0);
  });

  it("user names are unique and log in regardless of case", async () => {
    const { admin, client } = await setupApp();
    expect((await admin.call("POST", "/api/users", { username: "AINO", displayName: "Toinen" })).status).toBe(400);
    expect((await admin.call("POST", "/api/users", { username: "Eero", displayName: "Eero" })).status).toBe(201);
    expect((await admin.call("POST", "/api/users", { username: "eero", displayName: "Eero 2" })).status).toBe(400);
    const c = client();
    expect((await c.call("POST", "/api/auth/login", { username: "AiNo", password: "aino-salasana-123" })).status).toBe(200);
  });
});

describe("first-run setup", () => {
  it("is rate limited per address", async () => {
    const { call } = await bareApp();
    const bad = { code: "wrong", username: "aino", displayName: "Aino", password: "aino-salasana-123" };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("POST", "/api/auth/setup", bad)).status);
    expect(statuses.slice(0, 10).every((x) => x === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // the right code is refused too until the window ends
    expect((await call("POST", "/api/auth/setup", { ...bad, code: SETUP_CODE })).status).toBe(429);
  });

  it("two parallel setups create exactly one admin", async () => {
    const { call, db } = await bareApp();
    const good = (name: string) => ({ code: SETUP_CODE, username: name, displayName: name, password: "aino-salasana-123" });
    const results = await Promise.all([call("POST", "/api/auth/setup", good("aino")), call("POST", "/api/auth/setup", good("eero")), call("POST", "/api/auth/setup", good("kaisa"))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect((await db.first<{ c: number }>("SELECT COUNT(*) AS c FROM users"))?.c).toBe(1);
  });
});

describe("password change limits", () => {
  it("locks after five wrong current passwords, even for the right one", async () => {
    const { admin } = await setupApp();
    for (let i = 0; i < 5; i++) {
      const r = await admin.call("POST", "/api/auth/password", { current: `wrong-${i}`, next: "uusi-salasana-456" });
      expect(r.status).toBe(400);
    }
    const locked = await admin.call("POST", "/api/auth/password", { current: "aino-salasana-123", next: "uusi-salasana-456" });
    expect(locked.status).toBe(429);
    expect(locked.res.headers.get("retry-after")).toBeTruthy();
  });

  it("a correct current password resets the count", async () => {
    const { admin } = await setupApp();
    for (let i = 0; i < 4; i++) await admin.call("POST", "/api/auth/password", { current: `wrong-${i}`, next: "uusi-salasana-456" });
    expect((await admin.call("POST", "/api/auth/password", { current: "aino-salasana-123", next: "uusi-salasana-456" })).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await admin.call("POST", "/api/auth/password", { current: `wrong-${i}`, next: "x-salasana-789" })).status).toBe(400);
  });
});

describe("CSV import limits", () => {
  const HEAD = "Kirjauspäivä;Määrä;Nimi\n";

  it("refuses a file with too many rows", () => {
    const r = parseBankCsv(HEAD + "2026/09/01;-1,00;X\n".repeat(100_001));
    expect(r.transactions).toEqual([]);
    expect(r.errors[0]).toMatch(/yli 100000 riviä/);
  });

  it("refuses a file with too many columns, also within one row", () => {
    const r = parseBankCsv(`${HEAD}${";".repeat(200_000)}\n`);
    expect(r.errors[0]).toMatch(/yli 50 saraketta/);
  });

  it("collects at most 50 row errors and counts the rest", () => {
    const r = parseBankCsv(HEAD + "huono;1,00;X\n".repeat(500));
    expect(r.errors.length).toBeLessThanOrEqual(52);
    expect(r.errors.at(-1)).toBe("Lisäksi 450 riviä, joissa on virhe.");
  });

  it("a normal file and a tab or comma file still parse", () => {
    expect(parseBankCsv(HEAD + "2026/09/01;-1,00;X\n").transactions).toHaveLength(1);
    expect(parseBankCsv("Kirjauspäivä,Määrä,Nimi\n2026/09/01,\"-1,00\",X\n").transactions).toHaveLength(1);
  });

  it("the route refuses a body over the limit with 413", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("POST", "/api/import/csv", { content: "x".repeat(7 * 1024 * 1024), accountName: "Iso" })).status).toBe(413);
    expect((await admin.call("POST", "/api/import/csv", { content: "x".repeat(5_000_001), accountName: "Iso" })).status).toBe(400);
  });
});

describe("CSV export formula guard", () => {
  it("covers tab, CR and leading blanks", () => {
    for (const v of ["\t=1+1", "\r=1+1", " =1+1", "\t+1", "=1", "@SUM(A1)", "-1+2"]) expect(csv([[v]])).toContain("'");
    expect(csv([["Kahvila"]])).not.toContain("'");
    expect(csv([[-5]])).not.toContain("'");
  });
});

describe("Enable Banking client hardening", () => {
  it("accepts only https URLs on known hosts", () => {
    expect(checkAuthUrl("https://auth.enablebanking.com/x?y=1")).toContain("enablebanking.com");
    expect(checkAuthUrl("https://nordea.com/x")).toBeTruthy();
    for (const bad of ["http://auth.enablebanking.com/x", "javascript:alert(1)", "https://enablebanking.com.evil.test/x", "https://evil.test/enablebanking.com", "https://user:pw@auth.enablebanking.com/", "//auth.enablebanking.com", "", null, 5]) {
      expect(() => checkAuthUrl(bad), String(bad)).toThrow();
    }
    expect(checkAuthUrl("https://pay.example.org/x", ["example.org"])).toBeTruthy();
  });

  it("starting a connection fails with a 502 when the answer holds a hostile URL", async () => {
    const bank = mockBank();
    const hostile = (async (input: string | URL | Request, init?: RequestInit) => {
      if (`${init?.method ?? "GET"} ${new URL(String(input)).pathname}` === "POST /auth") return new Response(JSON.stringify({ url: "javascript:alert(1)", authorization_id: "a" }), { status: 200 });
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, hostile);
    const r = await admin.call("POST", "/api/connections/start", {});
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("javascript");
  });

  it("every request carries a timeout and ids are encoded in paths", async () => {
    const seen: { url: string; signal: AbortSignal | null | undefined }[] = [];
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, signal: init?.signal });
      if (url.endsWith("/sessions")) return new Response(JSON.stringify({ session_id: "s", aspsp: { name: "N", country: "FI" }, access: { valid_until: "2027-01-01T00:00:00Z" }, accounts: ["a/../b?x"] }), { status: 200 });
      return new Response(JSON.stringify({ uid: "a" }), { status: 200 });
    }) as typeof fetch;
    const client = new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: fetchMock });
    await client.createSession("code");
    expect(seen.length).toBe(2);
    expect(seen.every((x) => x.signal instanceof AbortSignal && !x.signal.aborted)).toBe(true);
    expect(seen[1]!.url).toContain("/accounts/a%2F..%2Fb%3Fx/details");
  });

  it("an oversized answer is refused", async () => {
    const big = (async () => new Response("{}", { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } })) as unknown as typeof fetch;
    const client = new EnableBankingClient({ appId: randomUUID(), privateKeyPem: pem, fetch: big });
    await expect(client.listAspsps("FI")).rejects.toThrow(/too large/);
  });
});
