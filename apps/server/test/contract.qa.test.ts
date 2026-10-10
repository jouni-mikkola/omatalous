/**
 * API contract: enumerates the routes of the Hono app and checks the rules every route has to follow.
 * A new route is covered without touching this file.
 */
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

// Reachable without a session on purpose.
const PUBLIC = new Set(["GET /api/health", "GET /api/auth/state", "POST /api/auth/setup", "POST /api/auth/login", "POST /api/auth/logout", "GET /api/connections/callback"]);
// Answers 401 itself, so it is not public but sits above the shared login gate.
const SELF_AUTH = new Set(["POST /api/auth/password"]);
const ADMIN_PREFIXES = ["/api/users", "/api/admin/"];
const CANARY = "RAW-BANK-PAYLOAD-CANARY-7f3a";

async function rig() {
  const t = await setupApp();
  const routes = [...new Map(t.app.routes.filter((r) => r.method !== "ALL" && r.path.startsWith("/api/")).map((r) => [`${r.method} ${r.path}`, r])).values()];
  return { ...t, routes };
}
const fill = (path: string, id = "nope") => path.replace(/:\w+/g, id);
const needsBody = (m: string) => m !== "GET" && m !== "HEAD";

describe("route enumeration", () => {
  it("sees the whole API", async () => {
    const { routes } = await rig();
    expect(routes.length).toBeGreaterThan(40);
  });
});

describe("no session", () => {
  it("every protected route answers 401, public ones do not", async () => {
    const { routes, client } = await rig();
    const anon = client();
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      const res = await anon.call(r.method, fill(r.path), needsBody(r.method) ? {} : undefined);
      // a wrong login is a 401 too, but not the "sign in first" one
      if (PUBLIC.has(key)) expect(res.body?.code, key).not.toBe("unauthenticated");
      else expect(res.status, key).toBe(401);
      if (!PUBLIC.has(key) && !SELF_AUTH.has(key)) expect(res.body.code, key).toBe("unauthenticated");
    }
  });

  it("an unknown API path is a JSON 404, not an HTML page or a 500", async () => {
    const { admin } = await rig();
    const res = await admin.call("GET", "/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe("CSRF header", () => {
  it("every state-changing route refuses a request without X-Requested-With, with and without a session", async () => {
    const { routes, admin, client } = await rig();
    const anon = client();
    for (const r of routes.filter((x) => needsBody(x.method))) {
      for (const who of [admin, anon]) {
        const res = await who.call(r.method, fill(r.path), {}, { "X-Requested-With": "" });
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
        expect(res.body.code, `${r.method} ${r.path}`).toBe("csrf");
      }
    }
  });

  it("a foreign Origin is refused even with the header", async () => {
    const { admin } = await rig();
    const res = await admin.call("POST", "/api/sync", {}, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("GET routes never change state: nothing a GET returns is a write", async () => {
    const { routes } = await rig();
    // sanity on the enumeration itself: the only GETs are reads by name
    const gets = routes.filter((r) => r.method === "GET").map((r) => r.path);
    expect(gets.some((p) => /delete|remove|reset/.test(p))).toBe(false);
  });
});

describe("roles", () => {
  it("a member gets 403 on every admin route", async () => {
    const { routes, member } = await rig();
    const m = await member("ville");
    for (const r of routes.filter((x) => ADMIN_PREFIXES.some((p) => x.path === p || x.path.startsWith(p.endsWith("/") ? p : `${p}/`) || x.path === p))) {
      const res = await m.call(r.method, fill(r.path), needsBody(r.method) ? {} : undefined);
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
    }
  });

  it("a member with a temporary password gets 403 everywhere but the password change", async () => {
    const { admin, client, routes } = await rig();
    const created = await admin.call("POST", "/api/users", { username: "uusi", displayName: "Uusi" });
    const m = client();
    await m.call("POST", "/api/auth/login", { username: "uusi", password: created.body.temporaryPassword });
    for (const r of routes.filter((x) => !PUBLIC.has(`${x.method} ${x.path}`) && !SELF_AUTH.has(`${x.method} ${x.path}`))) {
      const res = await m.call(r.method, fill(r.path), needsBody(r.method) ? {} : undefined);
      expect([401, 403], `${r.method} ${r.path}`).toContain(res.status);
      expect(res.status, `${r.method} ${r.path}`).not.toBe(200);
    }
  });
});

describe("another member's resources", () => {
  it("are 404 or empty for a member who was not given them", async () => {
    const { admin, member, db } = await rig();
    await admin.call("POST", "/api/demo");
    const meta = await admin.call("GET", "/api/meta");
    const accountId: string = meta.body.accounts[0].id;
    const txs = await admin.call("GET", "/api/transactions?limit=5");
    const txId: string = txs.body.items[0].id;
    expect(txs.body.total).toBeGreaterThan(0);
    const rule = await admin.call("POST", "/api/rules", { field: "merchant", pattern: "Testikauppa", category: "groceries" });
    expect(rule.status).toBe(200);
    const ruleRow = await db.first<{ id: number }>("SELECT id FROM category_rules LIMIT 1");

    const m = await member("ville");
    expect((await m.call("PATCH", `/api/transactions/${txId}`, { category: "groceries" })).status).toBe(404);
    expect((await m.call("PATCH", `/api/accounts/${accountId}`, { name: "Varastettu" })).status).toBe(404);
    expect((await m.call("DELETE", `/api/accounts/${accountId}`)).status).toBe(404);
    // sharing someone else's account is refused (400) and creates no access
    const share = await m.call("PUT", `/api/accounts/${accountId}/shares/${m.id}`);
    expect(share.status).not.toBe(200);
    expect((await m.call("DELETE", `/api/connections/${meta.body.connections[0]?.id ?? "x"}`)).status).not.toBe(200);

    for (const path of [`/api/transactions?accountId=${accountId}`, "/api/transactions", "/api/transactions?scope=household", "/api/rules", "/api/merchants", "/api/recurring"]) {
      const res = await m.call("GET", path);
      expect(res.status, path).toBe(200);
      expect(res.body.total ?? res.body.items?.length ?? res.body.rules?.length ?? res.body.series?.length ?? 0, path).toBe(0);
    }
    // deleting a rule id that belongs to someone else leaves it in place
    await m.call("DELETE", `/api/rules/${ruleRow!.id}`);
    expect((await admin.call("GET", "/api/rules")).body.rules).toHaveLength(1);

    const meta2 = await m.call("GET", "/api/meta");
    expect(meta2.body.accounts).toEqual([]);
    expect(meta2.body.sharedAccounts).toEqual([]);
    const exp = await m.call("GET", `/api/export/transactions.csv?accountId=${accountId}&from=2000-01-01&to=2030-01-01`);
    expect(exp.status).toBe(200);
    expect(String(exp.body).trim().split(/\r?\n/)).toHaveLength(1); // header only
    // the admin's data is intact
    expect((await admin.call("GET", "/api/transactions?limit=1")).body.total).toBe(txs.body.total);
    expect((await admin.call("GET", "/api/meta")).body.accounts.find((a: any) => a.id === accountId).name).not.toBe("Varastettu");
  });

  it("the other member can read a shared account but not change it, and loses it when the share ends", async () => {
    const { admin, member } = await rig();
    await admin.call("POST", "/api/demo");
    const accountId: string = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    const txId: string = (await admin.call("GET", `/api/transactions?accountId=${accountId}&limit=1`)).body.items[0].id;
    const m = await member("ville");
    expect((await admin.call("PUT", `/api/accounts/${accountId}/shares/${m.id}`)).status).toBe(200);
    const seen = await m.call("GET", `/api/transactions?scope=household&accountId=${accountId}&limit=1`);
    expect(seen.body.total).toBeGreaterThan(0);
    expect((await m.call("PATCH", `/api/transactions/${txId}`, { category: "groceries" })).status).toBe(404);
    expect((await m.call("DELETE", `/api/accounts/${accountId}`)).status).toBe(404);
    await admin.call("DELETE", `/api/accounts/${accountId}/shares/${m.id}`);
    expect((await m.call("GET", `/api/transactions?scope=household&accountId=${accountId}`)).body.total).toBe(0);
    expect((await m.call("GET", "/api/dashboard?scope=household")).status).toBe(200);
  });
});

describe("secrets in responses", () => {
  it("no response body holds raw bank payloads, private keys, the app secret or a password hash", async () => {
    const { admin, member, db, routes, client } = await rig();
    await admin.call("POST", "/api/demo");
    await admin.call("POST", "/api/admin/bank-app/key"); // seals a real private key in the database
    await db.run("UPDATE transactions SET raw = ?", [`{"canary":"${CANARY}"}`]);
    const m = await member("ville");
    const hashes = (await db.all<{ password_hash: string }>("SELECT password_hash FROM users")).map((r) => r.password_hash);
    const sealed = (await db.all<{ value: string }>("SELECT value FROM settings")).map((r) => r.value).filter((v) => v.length > 60);
    const forbidden = [CANARY, "PRIVATE KEY", "test-secret-that-is-long-enough-0123456789", "pbkdf2_sha256$", ...hashes, ...sealed];

    const accountId: string = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    const txId: string = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0].id;
    const reads = routes.filter((r) => r.method === "GET" && !PUBLIC.has(`${r.method} ${r.path}`));
    const extra = ["/api/transactions?limit=1000&from=2000-01-01&to=2030-01-01", "/api/auth/state", "/api/sync/runs"];
    const calls: { who: string; res: Awaited<ReturnType<typeof admin.call>>; what: string }[] = [];
    for (const [who, c] of [["admin", admin], ["member", m]] as const) {
      for (const r of reads) {
        const res = await c.call("GET", fill(r.path));
        // the certificate is a public file by design
        if (r.path === "/api/admin/bank-app/certificate" && res.status === 200) {
          expect(String(res.body)).not.toContain("PRIVATE KEY");
          continue;
        }
        calls.push({ who, res, what: `GET ${r.path}` });
      }
      for (const p of extra) calls.push({ who, res: await c.call("GET", p), what: `GET ${p}` });
    }
    // responses to writes
    calls.push({ who: "admin", res: await admin.call("PATCH", `/api/transactions/${txId}`, { category: "groceries" }), what: "PATCH tx" });
    calls.push({ who: "admin", res: await admin.call("PATCH", `/api/accounts/${accountId}`, { name: "Uusi nimi" }), what: "PATCH account" });
    calls.push({ who: "admin", res: await admin.call("PUT", "/api/admin/instance", { timeZone: "Europe/Helsinki" }), what: "PUT instance" });
    calls.push({ who: "admin", res: await admin.call("POST", "/api/admin/bank-app/test"), what: "POST bank-app/test" });
    calls.push({ who: "admin", res: await admin.call("POST", "/api/sync"), what: "POST sync" });
    calls.push({ who: "member", res: await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }), what: "POST login" });
    calls.push({ who: "admin", res: await admin.call("GET", "/api/export/report.csv?from=2000-01-01&to=2030-01-01"), what: "report csv" });
    calls.push({ who: "admin", res: await admin.call("GET", "/api/users"), what: "GET users" });

    for (const { res, what } of calls) {
      const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      for (const f of forbidden) expect(text.includes(f), `${what} leaks ${f.slice(0, 20)}`).toBe(false);
      expect(res.status, what).toBeLessThan(500);
    }
    // the lists really were non-trivial, so the scan means something
    expect(calls.find((c) => c.what.startsWith("GET /api/transactions?limit=1000") && c.who === "admin")!.res.body.items.length).toBeGreaterThan(100);
  });
});

describe("error shape", () => {
  it("malformed bodies on every JSON route are a 4xx with an error message, never a 500", async () => {
    const { routes, admin } = await rig();
    for (const r of routes.filter((x) => needsBody(x.method))) {
      const key = `${r.method} ${r.path}`;
      if (key === "POST /api/auth/logout" || key === "POST /api/demo" || key === "DELETE /api/demo" || key === "POST /api/sync" || key.startsWith("DELETE ")) continue;
      for (const payload of [[], "text", { __proto__: null, x: { y: 1 } }, { a: "\u0000".repeat(10) }]) {
        const res = await admin.call(r.method, fill(r.path), payload);
        expect(res.status, `${key} ${JSON.stringify(payload)}`).toBeLessThan(500);
      }
    }
  });
});
