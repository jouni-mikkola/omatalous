/** Regressions for issues found in code review. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncUser } from "../src/connectors/sync.ts";
import { checkingAccount, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function connected() {
  const bank = mockBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  return { bank, ...app };
}

describe("sync", () => {
  it("keeps a category the user set on a pending row, also once it is booked", async () => {
    const { bank, admin, s, adminId } = await connected();
    const coffee = (await admin.call("GET", "/api/transactions?q=espresso")).body.items[0];
    expect(coffee.status).toBe("pending");
    await admin.call("PATCH", `/api/transactions/${coffee.id}`, { category: "groceries" });

    await syncUser(s, adminId, "manual");
    expect((await admin.call("GET", "/api/transactions?q=espresso")).body.items[0]).toMatchObject({ category: "groceries", categorySource: "user" });

    bank.pendingBooked = true;
    await syncUser(s, adminId, "manual");
    const items = (await admin.call("GET", "/api/transactions?q=espresso")).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "booked", category: "groceries", categorySource: "user" });
  });

  it("a rejected application key does not mark the consents expired", async () => {
    const { bank, admin, s, adminId } = await connected();
    bank.status = 401;
    const failed = await syncUser(s, adminId, "manual");
    expect(failed.messages.join(" ")).toContain("hylkäsi avaimen");
    expect((await admin.call("GET", "/api/meta")).body.connections[0].status).toBe("active");
    bank.status = 200;
    expect((await syncUser(s, adminId, "manual")).status).toBe("ok");
  });

  it("CSV rows in a bank account do not move the sync window, future dates are skipped", async () => {
    const { bank, admin, s, adminId } = await connected();
    const checking = await checkingAccount(admin);
    const r = await admin.call("POST", "/api/import/csv", {
      accountId: checking.id,
      content: "Kirjauspäivä;Määrä;Saaja/Maksaja;Viesti\n2026-11-01;-10,00;TULEVA;X\n2026-10-01;-5,00;KAHVILA;Y\n",
    });
    expect(r.status).toBe(200);
    expect(r.body.errors[0]).toBe("Ohitettu 1 tulevaisuuteen päivätty rivi.");
    bank.calls.length = 0;
    await syncUser(s, adminId, "manual");
    const from = bank.calls.find((c) => c.includes("u-chk/transactions"))!;
    expect(new URL(`https://x${from.split(" ")[1]}`).searchParams.get("date_from")! <= s.today()).toBe(true);
  });
});

describe("bad input is a 400, never a 500", () => {
  it.each([
    ["GET", "/api/transactions?limit=abc", undefined],
    ["GET", "/api/transactions?offset=-1", undefined],
    ["POST", "/api/import/csv", { content: 123 }],
    ["POST", "/api/import/csv", null],
    ["POST", "/api/connections/complete", null],
    ["POST", "/api/rules", { field: "any", pattern: 5, category: "groceries" }],
    ["POST", "/api/rules", { field: "any", pattern: "/(a+)+$/", category: "groceries" }],
    ["PATCH", "/api/accounts/x", { name: 5 }],
    ["POST", "/api/users", { username: 5 }],
    ["POST", "/api/auth/password", { current: 1, next: 2 }],
  ])("%s %s %j", async (method, path, payload) => {
    const { admin, adminId } = await setupApp();
    const target = path.replace("/api/users/x", `/api/users/${adminId}`);
    expect((await admin.call(method, target, payload)).status).toBe(400);
  });

  it("login with a non-string or huge username", async () => {
    const { client } = await setupApp();
    expect((await client().call("POST", "/api/auth/login", { username: 5, password: "x" })).status).toBe(401);
    expect((await client().call("POST", "/api/auth/login", { username: "a".repeat(10_000), password: "x" })).status).toBe(401);
  });
});

describe("login rate limit behind a proxy", () => {
  it("cannot be dodged by rotating the client-supplied X-Forwarded-For entry", async () => {
    const { client } = await setupApp({ TRUST_PROXY: "true" });
    const statuses: number[] = [];
    // 50 failures per address; an over-long user name fails fast, before any password hashing
    for (let i = 0; i < 51; i++) {
      const username = i < 49 ? `${"n".repeat(65)}${i}` : `nobody${i}`;
      const r = await client().call("POST", "/api/auth/login", { username, password: "x" }, { "X-Forwarded-For": `10.0.0.${i}, 203.0.113.7` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 50).every((x) => x === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("misc", () => {
  it("a short APP_SECRET is treated as missing instead of failing later", async () => {
    const { admin } = await setupApp({ APP_SECRET: "too-short" });
    expect((await admin.call("GET", "/api/admin/instance")).body.secret.available).toBe(false);
    expect((await admin.call("POST", "/api/admin/bank-app/key")).status).toBe(400);
  });

  it("marks the cookie Secure when the request comes to the configured https address", async () => {
    const { admin, client } = await setupApp();
    await admin.call("PUT", "/api/admin/instance", { appBaseUrl: "https://talous.koti.example" });
    const r = await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" }, { Host: "talous.koti.example" });
    expect(r.res.headers.get("set-cookie")).toMatch(/Secure/i);
    const local = await client().call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" });
    expect(local.res.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });

  it("sharing an account twice is fine", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await admin.call("POST", "/api/demo");
    const account = (await s.finance(adminId).listAccounts())[0]!;
    expect((await admin.call("PUT", `/api/accounts/${account.id}/shares/${eero.id}`)).status).toBe(200);
    expect((await admin.call("PUT", `/api/accounts/${account.id}/shares/${eero.id}`)).status).toBe(200);
  });

  it("a mistyped Application ID can be corrected without a new key", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({}, bank.fetchMock);
    await admin.call("POST", "/api/admin/bank-app/key");
    bank.status = 401;
    expect((await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() })).body.result.verified).toBe(false);
    bank.status = 200;
    const fixed = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ result: { verified: true }, bankApp: { hasCertificate: true } });
  });

  it("the transaction export follows the list filters", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const r = await admin.call("GET", "/api/export/transactions.csv?from=2025-01-01&to=2026-10-09&category=food_delivery");
    const lines = String(r.body).trim().split("\r\n").slice(1);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.every((l) => l.includes(";Ruoan kotiinkuljetus;"))).toBe(true);
  });
});
