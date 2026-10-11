import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { originFromRelayState, relayState } from "@banking/core";
import { pastedParams } from "../src/routes/bank.ts";
import { syncEveryone } from "../src/connectors/sync.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("Enable Banking flow (mocked API)", () => {
  it("stores the user's own bank key encrypted, connects, syncs, and keeps the Gold bill out of spending", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({}, bank.fetchMock);
    const appId = randomUUID();

    expect((await admin.call("PUT", "/api/bank/credentials", { appId, privateKeyPem: "not a key" })).status).toBe(400);
    expect((await admin.call("PUT", "/api/bank/credentials", { appId, privateKeyPem: pem })).status).toBe(200);
    const stored = await s.users.getBankCredentials(adminId);
    expect(stored?.privateKeyEnc.startsWith("v1.")).toBe(true);
    expect(stored?.privateKeyEnc).not.toContain("PRIVATE KEY");
    expect((await admin.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: true, source: "user" });

    const start = await admin.call("POST", "/api/connections/start", {});
    expect(start.body.url).toBe("https://auth.enablebanking.com/consent?x=1");
    const done = await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    expect(done.body.accounts).toBe(2);
    expect(bank.appIds).toEqual(new Set([appId])); // signed with the user's own app id
    expect((await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` })).status).toBe(400);

    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.some((r: { status: string }) => r.status !== "running"));
    const sync = await admin.call("POST", "/api/sync");
    expect(sync.body).toMatchObject({ status: "ok", inserted: 0 });
    expect(bank.calls.some((c) => c.includes("continuation_key=page2"))).toBe(true);

    const meta = (await admin.call("GET", "/api/meta")).body;
    expect(meta.accounts.map((a: { type: string }) => a.type).sort()).toEqual(["checking", "credit_card"]);
    expect(meta.connections[0]).toMatchObject({ status: "active", daysLeft: 179 });

    const d = (await admin.call("GET", "/api/dashboard?from=2026-09-01&to=2026-10-09")).body;
    expect(d.totals).toMatchObject({ incomeCents: 342000, consumptionCents: 30850, debtCents: 0 });
    expect((await admin.call("GET", "/api/transactions?q=espresso")).body.items[0].status).toBe("pending");
  });

  it("asks for a shorter window when the bank refuses a card's long history, and names the bank's error code", async () => {
    const bank = mockBank();
    bank.cardOldest = "2025-10-15"; // 360 days back from NOW is 2025-10-14
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));

    const cardCalls = bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions"));
    expect(cardCalls.map((c) => new URLSearchParams(c.split("?")[1]).get("date_from"))).toEqual(["2024-10-09", "2025-10-14", "2026-07-12"]);
    expect((await admin.call("GET", "/api/transactions?q=espresso")).body.items).toHaveLength(1);
    expect((await admin.call("GET", "/api/sync/runs")).body.runs[0].status).toBe("ok");

    // a refusal of a recent window is not retried, and the message names the code
    bank.cardOldest = "2027-01-01";
    bank.calls.length = 0;
    const sync = await admin.call("POST", "/api/sync");
    expect(sync.body.status).toBe("partial");
    expect(sync.body.messages).toEqual(["Nordea Gold: pankki vastasi virheellä 400 (ASPSP_ERROR)."]);
    expect(bank.calls.filter((c) => c.startsWith("GET /accounts/u-card/transactions"))).toHaveLength(1);
  });

  it("a member cannot complete another member's bank authorisation", async () => {
    const bank = mockBank();
    const { admin, member } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const eero = await member("eero");
    await admin.call("POST", "/api/connections/start", {});
    const stolen = await eero.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    expect(stolen.status).toBe(400);
    expect((await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` })).status).toBe(400);
  });

  it("the scheduler syncs every member with an active consent using the instance app", async () => {
    const bank = mockBank();
    const { admin, member, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const eero = await member("eero");
    for (const c of [admin, eero]) {
      await c.call("POST", "/api/connections/start", {});
      await c.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    }
    await waitFor(async () => (await eero.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const results = await syncEveryone(s, "schedule");
    expect(Object.values(results).map((r) => r.status)).toEqual(["ok", "ok"]);
    // same real accounts, separate copies per user
    const adminAccounts = (await admin.call("GET", "/api/meta")).body.accounts.map((a: { id: string }) => a.id);
    const eeroAccounts = (await eero.call("GET", "/api/meta")).body.accounts.map((a: { id: string }) => a.id);
    expect(adminAccounts.some((id: string) => eeroAccounts.includes(id))).toBe(false);
  });

  it("redirects an expired session from the bank callback to a friendly message", async () => {
    const { client } = await setupApp();
    const r = await client().call("GET", "/api/connections/callback?code=a&state=b");
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toContain("#/settings?error=session");
  });

  it("the bank callback tells an old authorisation, missing bank keys and a failure apart", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({}, bank.fetchMock);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = (state: string) => s.settings.set(`auth_state:${state}`, JSON.stringify({ userId: adminId, createdAt: s.now().getTime() }));
    const callback = async (state: string) => (await admin.call("GET", `/api/connections/callback?code=a&state=${state}`)).res.headers.get("location");

    expect(await callback("unknown")).toMatch(/#\/settings\?error=expired$/);
    // a valid authorisation, but no bank keys: only an admin can fix that
    await pending("no-keys");
    expect(await callback("no-keys")).toMatch(/#\/settings\?error=setup$/);
    // the bank fails
    await admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem });
    bank.status = 500;
    await pending("bank-down");
    expect(await callback("bank-down")).toMatch(/#\/settings\?error=failed$/);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("bank return modes", () => {
  const RELAY = "https://jouni-mikkola.github.io/omatalous/callback/";
  const decode = (state: string) => originFromRelayState(state);

  it("relay mode registers the return page and carries the browser's local address in the state", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", { returnTo: "http://192.168.1.10:8080" });
    expect(bank.redirectUrl).toBe(RELAY);
    expect(decode(bank.state)).toBe("http://192.168.1.10:8080");
    // a public origin from the browser is ignored; the configured (localhost) address is private, so it is used
    await admin.call("POST", "/api/connections/start", { returnTo: "https://evil.example" });
    expect(decode(bank.state)).toBe("http://localhost:8080");
    // the state still completes the consent once, and only once
    const state = bank.state;
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${state}` })).body.accounts).toBe(2);
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${state}` })).status).toBe(400);
  });

  it("refuses a state that names a public address on return", async () => {
    const bank = mockBank();
    const { admin, s, adminId } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const state = relayState("tok", "https://evil.example");
    await s.settings.set(`auth_state:${state}`, JSON.stringify({ userId: adminId, createdAt: s.now().getTime() }));
    expect((await admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${state}` })).status).toBe(400);
  });

  it("an install that finished setup before the return page keeps the paste mode until an admin switches", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await s.settings.set("instance_settings", JSON.stringify({ appBaseUrl: "http://192.168.1.10:8080", setupDone: true }));
    await s.instance.load(true);
    expect((await admin.call("GET", "/api/meta")).body.bank).toMatchObject({ redirectMode: "paste", redirectUrl: "https://localhost/api/connections/callback" });
    await admin.call("POST", "/api/connections/start", {});
    expect(bank.redirectUrl).toBe("https://localhost/api/connections/callback");
    expect(bank.state).not.toContain(".");
    expect((await admin.call("PUT", "/api/admin/instance/redirect-mode", { mode: "bogus" })).status).toBe(400);
    expect((await admin.call("PUT", "/api/admin/instance/redirect-mode", { mode: "relay" })).body.bankApp.redirectUrl).toBe(RELAY);
  });

  it("an https address uses its own callback and no relay state", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem, APP_BASE_URL: "https://talous.example.fi" }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    expect(bank.redirectUrl).toBe("https://talous.example.fi/api/connections/callback");
    expect(bank.state).not.toContain(".");
  });

  it("names the URL to register when Enable Banking does not accept it", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    bank.authFailure = { status: 422, body: JSON.stringify({ code: 422, message: "Redirect URI not allowed", error: "REDIRECT_URI_NOT_ALLOWED" }) };
    const r = await admin.call("POST", "/api/connections/start", {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain(RELAY);
    // the unused state is not left behind
    expect(await s.settings.get(`auth_state:${bank.state}`)).toBeNull();
  });

  it("answers 502 with a fixed message when the bank API fails, never the API's own text", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    bank.authFailure = { status: 500, body: JSON.stringify({ error: "ASPSP_ERROR", message: "Account FI2112345600000785 balance 1234.50" }) };
    const r = await admin.call("POST", "/api/connections/start", {});
    expect(r).toMatchObject({ status: 502, body: { error: "Pankkirajapinta vastasi virheellä (500). Yritä myöhemmin uudelleen." } });
    expect(JSON.stringify(r.body)).not.toContain("FI2112345600000785");
  });

  it("the callback redirects relatively and the pasted text can be a URL, a path or a bare query", () => {
    expect(pastedParams("https://localhost/api/connections/callback?code=a&state=b")?.get("code")).toBe("a");
    expect(pastedParams("/api/connections/callback?code=a&state=b")?.get("state")).toBe("b");
    expect(pastedParams("code=a&state=b")?.get("code")).toBe("a");
    expect(pastedParams("hello")).toBeNull();
    expect(pastedParams("https://")).toBeNull();
  });

  it("tests a pasted application id without saving it, and explains 401 and 403", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({}, bank.fetchMock);
    await admin.call("POST", "/api/admin/bank-app/key");
    const appId = randomUUID();
    expect((await admin.call("POST", "/api/admin/bank-app/check", { appId })).body).toMatchObject({ verified: true });
    expect((await admin.call("GET", "/api/admin/instance")).body.bankApp.source).toBeNull();
    bank.status = 401;
    expect((await admin.call("POST", "/api/admin/bank-app/check", { appId })).body.message).toContain("401");
    bank.status = 403;
    expect((await admin.call("POST", "/api/admin/bank-app/check", { appId })).body.message).toContain("Activate by linking accounts");
    expect((await admin.call("POST", "/api/admin/bank-app/check", { appId: "x" })).status).toBe(400);
    expect(s).toBeTruthy();
  });
});
