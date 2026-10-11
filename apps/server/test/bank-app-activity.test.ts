/**
 * The shared Enable Banking app after it is saved: the test reads the application's own `active` flag, and a bank
 * can be connected only while the flag is not known to be off. Also the privacy and terms addresses of the form, and
 * the member's own key, which is tried against Enable Banking before it is saved.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INACTIVE_MESSAGE, relayPageUrl } from "../src/connectors/enable-banking/app-setup.ts";
import { setupApp } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

type Reply = "active" | "inactive" | "no flag" | "gone";

/** The mock bank plus GET /application, which the shared mock does not answer. */
function withApplication(bank: ReturnType<typeof mockBank>) {
  const app = { reply: "active" as Reply, calls: 0 };
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname !== "/application" || bank.status !== 200) return bank.fetchMock(input, init);
    app.calls++;
    if (app.reply === "gone") return new Response("not found", { status: 404 });
    const body = { name: "Omatalous", kid: "k", environment: "PRODUCTION", redirect_urls: [], countries: ["FI"], services: ["AIS"] };
    return new Response(JSON.stringify(app.reply === "no flag" ? body : { ...body, active: app.reply === "active" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { app, fetchMock };
}

async function rig(reply: Reply = "inactive") {
  const bank = mockBank();
  const { app, fetchMock } = withApplication(bank);
  app.reply = reply;
  const t = await setupApp({}, fetchMock);
  await t.admin.call("POST", "/api/admin/bank-app/key");
  return { ...t, bank, app };
}

describe("registration form values", () => {
  it("builds the privacy and terms pages beside the return page", () => {
    expect(relayPageUrl("https://relay.example.fi/talous/callback/", "privacy")).toBe("https://relay.example.fi/talous/privacy/");
    expect(relayPageUrl("https://relay.example.fi/talous/callback/", "terms")).toBe("https://relay.example.fi/talous/terms/");
    expect(relayPageUrl("https://relay.example.fi/", "terms")).toBe("https://relay.example.fi/terms/");
  });

  it("an EB_RELAY_URL without the trailing slash gives the same pages", () => {
    expect(relayPageUrl("https://relay.example.fi/talous/callback", "privacy")).toBe("https://relay.example.fi/talous/privacy/");
    expect(relayPageUrl("https://relay.example.fi/talous/callback", "terms")).toBe("https://relay.example.fi/talous/terms/");
    expect(relayPageUrl("https://relay.example.fi", "privacy")).toBe("https://relay.example.fi/privacy/");
  });

  it("the status carries the three addresses on one host, and a self-hosted relay moves all of them", async () => {
    const { admin } = await setupApp();
    const status = (await admin.call("GET", "/api/admin/instance")).body.bankApp;
    expect(status.redirectMode).toBe("relay");
    expect(status.relayUrl).toBe(status.redirectUrl);
    expect(status.privacyUrl).toBe(new URL("../privacy/", status.redirectUrl).toString());
    expect(status.termsUrl).toBe(new URL("../terms/", status.redirectUrl).toString());
    expect(status.privacyUrl.endsWith("/omatalous/privacy/")).toBe(true);

    const own = await setupApp({ EB_RELAY_URL: "https://relay.example.fi/talous/callback/" });
    expect((await own.admin.call("GET", "/api/admin/instance")).body.bankApp).toMatchObject({
      redirectUrl: "https://relay.example.fi/talous/callback/",
      privacyUrl: "https://relay.example.fi/talous/privacy/",
      termsUrl: "https://relay.example.fi/talous/terms/",
    });
  });
});

describe("the shared app must be active before a bank can be connected", () => {
  it("says so after saving, keeps the bank off, and turns it on when the application is active", async () => {
    const { admin, member, app } = await rig("inactive");
    const saved = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(saved.body.result).toEqual({ verified: false, active: false, message: INACTIVE_MESSAGE });
    expect(INACTIVE_MESSAGE).toBe("Sovellus ei ole vielä aktiivinen. Linkitä tilit Enable Bankingissa: Activate by linking accounts.");
    // the settings are kept, and every later look at the status repeats the sentence
    expect(saved.body.bankApp).toMatchObject({ source: "web", inactiveMessage: INACTIVE_MESSAGE });
    expect((await admin.call("GET", "/api/admin/instance")).body.bankApp.inactiveMessage).toBe(INACTIVE_MESSAGE);

    const eero = await member("eero");
    for (const c of [admin, eero]) expect((await c.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: false, source: "instance" });

    // the accounts get linked in the Control Panel; "Testaa yhteys" finds out
    app.reply = "active";
    const tested = await admin.call("POST", "/api/admin/bank-app/test");
    expect(tested.body.result).toEqual({ verified: true, active: true, message: "Yhteys toimii." });
    expect(tested.body.bankApp.inactiveMessage).toBeNull();
    for (const c of [admin, eero]) expect((await c.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: true, source: "instance" });
  });

  it("a pasted Application ID is checked without being remembered", async () => {
    const { admin } = await rig("inactive");
    const checked = await admin.call("POST", "/api/admin/bank-app/check", { appId: randomUUID() });
    expect(checked.body).toMatchObject({ verified: false, message: INACTIVE_MESSAGE });
    expect((await admin.call("GET", "/api/admin/instance")).body.bankApp).toMatchObject({ source: null, inactiveMessage: null });
  });

  it("an answer belongs to its Application ID: a new id starts clean", async () => {
    const { admin, app } = await rig("inactive");
    await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(false);
    app.reply = "no flag";
    const next = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(next.body.result.verified).toBe(true);
    expect(next.body.bankApp.inactiveMessage).toBeNull();
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(true);
  });

  it("a flag that cannot be read holds nothing back, and a failed test keeps the last answer", async () => {
    const { admin, app, bank } = await rig("gone");
    const saved = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(saved.body.result).toEqual({ verified: true, message: "Yhteys toimii." });
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(true);

    app.reply = "inactive";
    await admin.call("POST", "/api/admin/bank-app/test");
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(false);
    // Enable Banking is down for a moment: nothing new is learned
    bank.status = 500;
    expect((await admin.call("POST", "/api/admin/bank-app/test")).body.result.verified).toBe(false);
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(false);
    // it answers again, now without the flag: the bank list works, so the app is not held back
    bank.status = 200;
    app.reply = "gone";
    expect((await admin.call("POST", "/api/admin/bank-app/test")).body.result.verified).toBe(true);
    expect((await admin.call("GET", "/api/meta")).body.bank.configured).toBe(true);
  });

  it("a refused key is explained as before and records nothing", async () => {
    const { admin, bank } = await rig("inactive");
    bank.status = 401;
    const r = await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    expect(r.body.result.message).toContain("401");
    expect(r.body.bankApp.inactiveMessage).toBeNull();
  });

  it("removing the app removes what was learned about it", async () => {
    const { admin, app } = await rig("inactive");
    await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() });
    const removed = await admin.call("DELETE", "/api/admin/bank-app");
    expect(removed.body.bankApp).toMatchObject({ source: null, inactiveMessage: null });
    await admin.call("POST", "/api/admin/bank-app/key");
    app.reply = "no flag";
    expect((await admin.call("PUT", "/api/admin/bank-app", { appId: randomUUID() })).body.bankApp.inactiveMessage).toBeNull();
  });
});

describe("a member's own key is tried before it is saved", () => {
  const pem = () => generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  async function own(reply: Reply = "active") {
    const bank = mockBank();
    const { app, fetchMock } = withApplication(bank);
    app.reply = reply;
    const t = await setupApp({}, fetchMock);
    const eero = await t.member("eero");
    return { ...t, eero, bank, app };
  }

  it("saves a pair that works and says so", async () => {
    const { eero, bank, s } = await own();
    const appId = randomUUID();
    const saved = await eero.call("PUT", "/api/bank/credentials", { appId, privateKeyPem: pem() });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ok: true, result: { verified: true, active: true, message: "Avain tallennettu. Yhteys toimii." } });
    expect(bank.appIds).toEqual(new Set([appId]));
    expect((await eero.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: true, source: "user" });
    expect(await s.users.getBankCredentials((await eero.call("GET", "/api/meta")).body.user.id)).not.toBeNull();
  });

  it("refuses a pair Enable Banking does not know, and keeps the key that was saved before", async () => {
    const { eero, bank } = await own();
    const first = randomUUID();
    await eero.call("PUT", "/api/bank/credentials", { appId: first, privateKeyPem: pem() });
    bank.status = 401;
    const wrong = await eero.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem() });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("Enable Banking ei tunnistanut sovellusta (401). Tarkista, että Application ID ja .pem-tiedosto ovat samasta sovelluksesta. Avainta ei tallennettu.");
    bank.status = 200;
    bank.appIds.clear();
    await eero.call("POST", "/api/connections/start", {});
    expect(bank.appIds).toEqual(new Set([first]));
  });

  it("saves the key while the application is inactive, tells so, and leaves the household's app alone", async () => {
    const { eero, admin } = await own("inactive");
    const saved = await eero.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem() });
    expect(saved.status).toBe(200);
    expect(saved.body.result).toEqual({ verified: false, active: false, message: `Avain tallennettu. ${INACTIVE_MESSAGE}` });
    expect((await admin.call("GET", "/api/admin/instance")).body.bankApp.inactiveMessage).toBeNull();
    // a member's own key is not held back by the flag, as before
    expect((await eero.call("GET", "/api/meta")).body.bank).toMatchObject({ configured: true, source: "user" });
  });

  it("saves the key when Enable Banking cannot be reached, and says it was not tested", async () => {
    const { eero, bank } = await own();
    bank.status = 500;
    const saved = await eero.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem() });
    expect(saved.status).toBe(200);
    expect(saved.body.result).toEqual({ verified: false, message: "Avain tallennettu. Enable Banking vastasi virheellä 500. Yritä myöhemmin uudelleen." });
  });

  it("a key that is not a key is refused before any call to Enable Banking", async () => {
    const { eero, bank } = await own();
    expect((await eero.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: "not a key" })).status).toBe(400);
    expect((await eero.call("PUT", "/api/bank/credentials", { appId: "not-an-id", privateKeyPem: pem() })).status).toBe(400);
    expect(bank.calls).toEqual([]);
  });

  it("the meta carries the privacy and terms addresses beside the redirect URL", async () => {
    const { eero } = await own();
    const { bank } = (await eero.call("GET", "/api/meta")).body;
    expect(bank.privacyUrl).toBe(new URL("../privacy/", bank.redirectUrl).toString());
    expect(bank.termsUrl).toBe(new URL("../terms/", bank.redirectUrl).toString());
  });
});
