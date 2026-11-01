import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember } from "./helpers.ts";

// Passkeys on the pages: Asetukset > Turvallisuus > Passkey (add, name, remove) and the passkey step of the sign-in. The
// device is Chromium's virtual authenticator (CDP WebAuthn), which signs like a real one. A passkey needs a domain and
// https, with the name localhost as the one exception, so the spec sets the address of the install to
// http://localhost:<port> (the e2e server answers there too) and puts it back. The administrator's security log shows each use.

const FETCH = { "X-Requested-With": "fetch" };

/** A virtual device in the context of `page`: it keeps what is made on it, so a later page of the context finds it. */
async function virtualDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId, credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials };
}

async function eventKinds(browser: Browser): Promise<string[]> {
  const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
  const answer = await admin.request.get("/api/security/events?limit=200");
  const body = (await answer.json()) as { events: { kind: string; detail: string | null }[] };
  await admin.close();
  return body.events.map((e) => (e.detail ? `${e.kind}:${e.detail}` : e.kind));
}

/** Sets the address of the install for the length of `run`; the browser must be at the same address for a passkey to work. */
async function atAddress<T>(browser: Browser, address: (port: string) => string, run: (base: string) => Promise<T>): Promise<T> {
  const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
  const port = new URL(process.env.E2E_BASE_URL ?? (test.info().project.use.baseURL as string)).port;
  const before = ((await (await admin.request.get("/api/admin/instance")).json()) as { settings: { appBaseUrl: string } }).settings.appBaseUrl;
  const set = async (appBaseUrl: string) => expect((await admin.request.put("/api/admin/instance", { data: { appBaseUrl }, headers: FETCH })).ok()).toBe(true);
  await set(address(port));
  try {
    return await run(address(port));
  } finally {
    await set(before);
    await admin.close();
  }
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Käyttäjätunnus").fill(username);
  await page.getByLabel("Salasana").fill(`${username}-123456`);
  await page.getByRole("button", { name: "Kirjaudu sisään", exact: true }).click();
}

test("a member adds a passkey, signs in with it, and removes it", async ({ browser }) => {
  const username = "passkeyaja";
  const { id } = await makeMember(browser, username);
  try {
    await atAddress(browser, (port) => `http://localhost:${port}`, async (base) => {
      const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const device = await virtualDevice(context, page);
      await signIn(page, username);
      await page.goto("/#/settings/security");
      const card = page.locator(".card", { has: page.getByRole("heading", { name: "Passkey (pääsyavain)", exact: true }) });
      await expect(card.getByText("Passkeyta ei ole lisätty.")).toBeVisible();

      // adding: the wrong password is refused, then the device makes the key and ten recovery codes are shown once
      await card.getByRole("button", { name: "Lisää passkey", exact: true }).click();
      await card.getByLabel("Salasana").fill("vaara-salasana-1");
      await card.getByLabel("Laitteen nimi").fill("Testilaite");
      await card.getByRole("button", { name: "Lisää passkey", exact: true }).click();
      await expect(card.getByText("Salasana on väärä.")).toBeVisible();
      await card.getByLabel("Salasana").fill(`${username}-123456`);
      await card.getByRole("button", { name: "Lisää passkey", exact: true }).click();
      await expect(card.locator(".recovery-codes code")).toHaveCount(10);
      const codes = await card.locator(".recovery-codes code").allTextContents();
      await card.getByRole("button", { name: "Valmis" }).click();
      await expect(card.getByText("Testilaite")).toBeVisible();
      await expect(card.getByText(/ei vielä käytetty/)).toBeVisible();
      expect(await device.credentials()).toHaveLength(1);

      // signing in: the password alone does not open the app, the device does
      await context.clearCookies();
      await signIn(page, username);
      await page.getByRole("button", { name: "Käytä passkeyta" }).click();
      await expect(page.getByRole("heading", { name: "Kirjaudu sisään", exact: true })).toHaveCount(0);
      expect((await device.credentials())[0]!.signCount).toBeGreaterThan(0);

      // a device that does not know the key cannot open it; the code step stays
      await context.clearCookies();
      await signIn(page, username);
      await device.cdp.send("WebAuthn.clearCredentials", { authenticatorId: device.authenticatorId });
      await page.getByRole("button", { name: "Käytä passkeyta" }).click();
      await expect(page.getByLabel("Koodi sovelluksesta")).toBeVisible();
      await expect(page.getByRole("button", { name: "Käytä passkeyta" })).toBeVisible();

      // a recovery code opens it; removing the passkey with the password and a code leaves the password alone
      await page.getByRole("button", { name: "Käytä palautuskoodia" }).click();
      await page.getByLabel("Palautuskoodi").fill(codes[0]!);
      await page.getByRole("button", { name: "Kirjaudu sisään", exact: true }).click();
      await page.goto("/#/settings/security");
      const again = page.locator(".card", { has: page.getByRole("heading", { name: "Passkey (pääsyavain)", exact: true }) });
      await again.getByRole("button", { name: "Poista passkey Testilaite" }).click();
      await again.getByLabel("Salasana").fill(`${username}-123456`);
      // with a factor on, the password alone does not change the passkeys: a code is asked as well
      await again.getByLabel("Koodi sovelluksesta tai palautuskoodi", { exact: true }).fill(codes[1]!);
      await again.getByRole("button", { name: "Poista", exact: true }).last().click();
      await expect(again.getByText("Passkeyta ei ole lisätty.")).toBeVisible();
      await context.close();

      const kinds = await eventKinds(browser);
      expect(kinds).toEqual(expect.arrayContaining(["passkey_added:Testilaite", "passkey_used:Testilaite", "passkey_removed:Testilaite"]));
      expect(kinds.some((k) => k.startsWith("login_fail:passkey"))).toBe(true);
    });
  } finally {
    await removeMember(browser, id);
  }
});

test("on a home network address without https the card says so and offers no passkey", async ({ browser }) => {
  const username = "passkeykoti";
  const { id } = await makeMember(browser, username);
  try {
    await atAddress(browser, () => "http://192.168.1.10:8080", async () => {
      const context = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", `${username}-state.json`) });
      const page = await context.newPage();
      await page.goto("/#/settings/security");
      const card = page.locator(".card", { has: page.getByRole("heading", { name: "Passkey (pääsyavain)", exact: true }) });
      await expect(card.getByText(/Passkey toimii vain https-osoitteessa\. Tämän asennuksen osoite on http:\/\/192\.168\.1\.10:8080/)).toBeVisible();
      await expect(card.getByRole("button", { name: "Lisää passkey" })).toHaveCount(0);
      await context.close();
    });
  } finally {
    await removeMember(browser, id);
  }
});
