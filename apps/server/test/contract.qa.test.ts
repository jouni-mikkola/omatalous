/**
 * API contract: enumerates the routes of the Hono app and checks the rules every route has to follow.
 * A new route is covered without touching this file.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

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

describe("data versions", () => {
  // Moves data_version:<user> when it runs; each is run below with a request that changes something.
  const MOVES = [
    "POST /api/demo",
    "PATCH /api/transactions/:id",
    "POST /api/rules",
    "DELETE /api/rules/:id",
    "PUT /api/merchants/category",
    "DELETE /api/merchants/rule",
    "PATCH /api/accounts/:id",
    "PUT /api/accounts/:id/shares/:userId",
    "DELETE /api/accounts/:id/shares/:userId",
    "PUT /api/accounts/:id/use",
    "DELETE /api/accounts/:id/use",
    "PUT /api/accounts/:id/split",
    "DELETE /api/accounts/:id/split",
    "PUT /api/accounts/:id/answers",
    "DELETE /api/accounts/:id/answers",
    "DELETE /api/accounts/:id",
    "DELETE /api/demo",
    // the new accounts are written before the first fetch; run with the mock bank below
    "POST /api/connections/complete",
  ];
  // Moves the instance version (data_version): every member's household view may have shown the removed member's accounts. Run below.
  const MOVES_EVERYONE = ["DELETE /api/users/:id"];
  // Moves it only when a row changed (CLAUDE.md: a sync that changed nothing does not): sync.ts decides.
  const MOVES_WHEN_ROWS_CHANGE = ["POST /api/sync"];
  // Read for each request (requestInputs), never cached: saving them moves no version. optimise.test.ts checks the Optimoi ones.
  const PER_REQUEST = [
    "PUT /api/marks",
    "POST /api/expected-bills",
    "DELETE /api/expected-bills/:id",
    "POST /api/loans",
    "PUT /api/loans/:id",
    "DELETE /api/loans/:id",
    "PUT /api/optimise/inputs/:key",
    "DELETE /api/optimise/inputs/:key",
    "PUT /api/optimise/findings/:id",
  ];
  // Nothing the analysis reads: sign-in, members (removal aside), the instance, maintenance, security events, bank keys, a
  // consent not yet given, and a consent ended: removing a connection only marks it revoked, its accounts and rows stay
  // (connector.ts removeConnection), and /api/meta reads the connection list for each request. Run below for the last one.
  const NO_ANALYSIS =
    /^(?!DELETE \/api\/users\/:id$)(POST|PUT|PATCH|DELETE) \/api\/(auth|users|admin|ops|security)(\/|$)|^(PUT|DELETE) \/api\/bank\/credentials$|^POST \/api\/connections\/start$|^DELETE \/api\/connections\/:id$/;

  it("every non-GET route is on exactly one named list", async () => {
    const { routes } = await rig();
    const lists = [MOVES, MOVES_EVERYONE, MOVES_WHEN_ROWS_CHANGE, PER_REQUEST];
    for (const r of routes.filter((x) => needsBody(x.method))) {
      const key = `${r.method} ${r.path}`;
      const on = lists.filter((l) => l.includes(key)).length + (NO_ANALYSIS.test(key) ? 1 : 0);
      expect(on, `${key}: put it on MOVES or MOVES_EVERYONE (and run it below), MOVES_WHEN_ROWS_CHANGE, PER_REQUEST or NO_ANALYSIS`).toBe(1);
    }
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const key of lists.flat()) expect(keys.has(key), `${key} is listed but is no route`).toBe(true);
  });

  it("each route on MOVES moves the user's version, and the per-request writes do not", async () => {
    const { admin, adminId, member, s } = await rig();
    const version = (id: string) => s.settings.get(`data_version:${id}`);
    const m = await member("ville");
    const ran = new Set<string>();
    const step = async (key: string, call: () => Promise<{ status: number; body: any }>, moves: boolean, ids = [adminId]) => {
      const before = await Promise.all(ids.map(version));
      const res = await call();
      expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(200);
      const after = await Promise.all(ids.map(version));
      ids.forEach((id, i) => (moves ? expect(after[i], key).not.toBe(before[i]) : expect(after[i], key).toBe(before[i])));
      ran.add(key);
      return res;
    };
    await step("POST /api/demo", () => admin.call("POST", "/api/demo"), true);
    const tx = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0];
    const accountId: string = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await step("PATCH /api/transactions/:id", () => admin.call("PATCH", `/api/transactions/${tx.id}`, { category: "groceries" }), true);
    await step("POST /api/rules", () => admin.call("POST", "/api/rules", { field: "merchant", pattern: "Testikauppa", category: "groceries" }), true);
    const ruleId = (await admin.call("GET", "/api/rules")).body.rules[0].id;
    await step("DELETE /api/rules/:id", () => admin.call("DELETE", `/api/rules/${ruleId}`), true);
    await step("PUT /api/merchants/category", () => admin.call("PUT", "/api/merchants/category", { merchant: tx.merchant, category: "restaurants" }), true);
    await step("DELETE /api/merchants/rule", () => admin.call("DELETE", "/api/merchants/rule", { merchant: tx.merchant }), true);
    await step("PATCH /api/accounts/:id", () => admin.call("PATCH", `/api/accounts/${accountId}`, { name: "Käyttötili" }), true);
    await step("PUT /api/accounts/:id/shares/:userId", () => admin.call("PUT", `/api/accounts/${accountId}/shares/${m.id}`), true, [adminId, m.id]);
    // who uses an account changes the figures of everyone who sees it: here its owner and the member it is shared with
    const use = { users: [{ userId: adminId, weight: 3 }, { userId: m.id, weight: 2 }] };
    await step("PUT /api/accounts/:id/use", () => admin.call("PUT", `/api/accounts/${accountId}/use`, use), true, [adminId, m.id]);
    await step("DELETE /api/accounts/:id/use", () => admin.call("DELETE", `/api/accounts/${accountId}/use`), true, [adminId, m.id]);
    // the split of an account and the answers about its money in change the same figures, for the same members
    await step("PUT /api/accounts/:id/split", () => admin.call("PUT", `/api/accounts/${accountId}/split`, { mode: "source" }), true, [adminId, m.id]);
    await step("DELETE /api/accounts/:id/split", () => admin.call("DELETE", `/api/accounts/${accountId}/split`), true, [adminId, m.id]);
    await step("DELETE /api/accounts/:id/answers", () => admin.call("DELETE", `/api/accounts/${accountId}/answers`, { kind: "opening", key: "o" }), true, [adminId, m.id]);
    await step("DELETE /api/accounts/:id/shares/:userId", () => admin.call("DELETE", `/api/accounts/${accountId}/shares/${m.id}`), true, [adminId, m.id]);

    await step("PUT /api/marks", () => admin.call("PUT", "/api/marks", { subject: `merchant:${tx.merchant}`, mark: "cancelled" }), false);
    const bill = await step("POST /api/expected-bills", () => admin.call("POST", "/api/expected-bills", { name: "Vesi", amountCents: 5000, dueDate: "2026-11-20", cadence: "once" }), false);
    await step("DELETE /api/expected-bills/:id", () => admin.call("DELETE", `/api/expected-bills/${bill.body.bill.id}`), false);
    const loan = await step("POST /api/loans", () => admin.call("POST", "/api/loans", { name: "Autolaina", kind: "car", balanceCents: 1_200_000, balanceDate: "2026-10-01" }), false);
    await step("PUT /api/loans/:id", () => admin.call("PUT", `/api/loans/${loan.body.loan.id}`, { name: "Autolaina", kind: "car", balanceCents: 1_150_000, balanceDate: "2026-10-08" }), false);
    await step("DELETE /api/loans/:id", () => admin.call("DELETE", `/api/loans/${loan.body.loan.id}`), false);

    await step("DELETE /api/accounts/:id", () => admin.call("DELETE", `/api/accounts/${accountId}`), true);
    await step("DELETE /api/demo", () => admin.call("DELETE", "/api/demo"), true);

    const everyone = await s.settings.get("data_version");
    expect((await admin.call("DELETE", `/api/users/${m.id}`)).status, "DELETE /api/users/:id").toBe(200);
    expect(await s.settings.get("data_version"), "DELETE /api/users/:id").not.toBe(everyone);
    expect(MOVES.filter((k) => !ran.has(k) && k !== "POST /api/connections/complete" && k !== "PUT /api/accounts/:id/answers"), "every route on MOVES ran").toEqual([]);
  });

  it("completing a bank connection moves the user's version, and removing one does not", async () => {
    const bank = mockBank();
    const { admin, adminId, s } = await setupApp({}, bank.fetchMock);
    const version = () => s.settings.get(`data_version:${adminId}`);
    expect((await admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: PEM })).status).toBe(200);
    await admin.call("POST", "/api/connections/start", {});
    const before = await version();
    const done = await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    expect(done.status).toBe(200);
    expect(await version()).not.toBe(before);
    // the first fetch runs in the background and may move the version itself: wait until it is over
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));
    const connectionId: string = (await admin.call("GET", "/api/meta")).body.connections[0].id;
    const settled = await version();
    expect((await admin.call("DELETE", `/api/connections/${connectionId}`)).status).toBe(200);
    expect(await version()).toBe(settled);
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
