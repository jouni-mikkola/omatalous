import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// Asetukset > Tekniset asetukset > Palvelin > Etäkäyttö against a stand-in for the routes of the server (the real ones need Cloudflare
// and a host helper). The stand-in plays the helper too: a change shows as waiting, and the next read settles it.
// Addresses are example.fi. With SHOTS_DIR set the states are also saved as pictures (cw3b-<state>-<width>.png).
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const SHOTS = process.env.SHOTS_DIR;
const TOKEN = "cfp_example-token-0123456789abcdefghijkl";
const PASSWORD = "esimerkki-salasana-1";
const REFUSED = "Etäkäytön muutos on jo kesken. Odota, että se valmistuu.";
const NOT_REPORTED = "Ylläpitoapuri ei ole vielä kertonut, onko asennus tunnelin takana. Yritä hetken päästä uudelleen.";
const LOCAL_ASKED = "Kun etäkäyttö otetaan pois käytöstä, sovellus vastaa vain palvelimella itsellään osoitteessa http://localhost:8080. Vahvista, että tämä sopii.";
const REQUEST = "op_0123456789abcdef";
const HOME = "http://192.168.1.10:8080";
const REVERT_AT = new Date(Date.now() + 10 * 60_000).toISOString();

type Json = Record<string, any>;
const SAVED = { saved: true, usable: true, savedAt: "2026-10-12T08:00:00.000Z", zones: ["example.fi"] };
const OFF: Json = {
  copy: "talous",
  token: { saved: false, usable: false, savedAt: null, zones: [] },
  suggestedHostname: null,
  access: { on: false, hostname: null, address: HOME, mode: "lan", port: 8080, emails: [], emailsKnown: true, checked: false, confirmed: false, revertAt: null, afterOff: null },
  cloudflare: { hostname: null, emails: [], removal: null, note: null },
  pending: null,
  last: null,
  helper: { status: "ok", version: "3", knowsAccess: true, enableCommand: "./scripts/install.sh --ops-helper" },
  busy: false,
};
/** Behind the tunnel and proven. `access` overrides fields of the access object (afterOff, confirmed, revertAt ...). */
const IN_TUNNEL = (emails: string[], access: Json = {}): Json => ({
  ...OFF,
  token: SAVED,
  suggestedHostname: "talous.example.fi",
  access: { on: true, hostname: "talous.example.fi", address: "https://talous.example.fi", mode: "tunnel", port: 8080, emails, emailsKnown: true, checked: true, confirmed: true, revertAt: null, afterOff: HOME, ...access },
  cloudflare: { hostname: "talous.example.fi", emails, removal: null, note: null },
  last: { want: "tunnel", hostname: "talous.example.fi", outcome: "applied", summary: "Valmis.", at: "2026-10-12T08:05:00.000Z" },
});
/** A new address on trial: nobody has come in through it yet. */
const ON_TRIAL = (emails: string[]): Json => IN_TUNNEL(emails, { confirmed: false, revertAt: REVERT_AT });
const PENDING = (want: "tunnel" | "lan", status = "queued"): Json => ({ want, hostname: want === "tunnel" ? "talous.example.fi" : null, requestId: REQUEST, status, requestedAt: "2026-10-12T08:00:00.000Z" });
const LEFT: Json = { ...IN_TUNNEL(["anna@example.fi"]), access: { ...OFF.access } };

/** The routes of the server. `ahead` holds what the helper does between two reads of the state. */
async function standIn(page: Page, start: Json = OFF) {
  const fake = {
    state: structuredClone(start),
    seen: [] as { method: string; url: string; body: string }[],
    refuse: null as { status: number; error: string } | null,
    ahead: [] as (() => void)[],
    /** the home address answers 403 `Pääsy estetty.` to the next reads */
    blocked: false,
    /** The bodies of the calls that changed something at a route ("/on", "/off"), in order. */
    posts: (suffix: string): Json[] => fake.seen.filter((r) => r.method !== "GET" && r.url.endsWith(suffix)).map((r) => JSON.parse(r.body || "{}")),
  };
  await page.route(/\/api\/ops\/cancel\//, async (route) => {
    fake.seen.push({ method: route.request().method(), url: route.request().url(), body: route.request().postData() ?? "" });
    fake.state.pending = null;
    fake.ahead.length = 0;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(/\/api\/admin\/remote-access/, async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname.replace("/api/admin/remote-access", "");
    const raw = req.postData() ?? "";
    fake.seen.push({ method, url: req.url(), body: raw });
    const s = fake.state;
    if (method === "GET") {
      if (fake.blocked) return route.fulfill({ status: 403, contentType: "text/plain", body: "Pääsy estetty." });
      fake.ahead.shift()?.();
    } else {
      const body = JSON.parse(raw || "{}");
      if (body.password !== PASSWORD) return route.fulfill({ status: 403, json: { error: "Salasana ei täsmää." } });
      if (fake.refuse) {
        const { status, error } = fake.refuse;
        fake.refuse = null;
        return route.fulfill({ status, json: { error } });
      }
      if (method === "DELETE") s.token = OFF.token;
      else if (path === "/token") {
        s.token = SAVED;
        s.suggestedHostname = "talous.example.fi";
      } else if (path === "/on") {
        const already = s.access.on;
        s.pending = PENDING("tunnel");
        // a new address is on trial until somebody comes in; a new list for the address that is on is not
        fake.ahead.push(() => Object.assign(s, already ? IN_TUNNEL(body.emails) : ON_TRIAL(body.emails)));
      } else if (path === "/off") {
        s.pending = PENDING("lan");
        const kept = { hostname: "talous.example.fi", emails: s.cloudflare.emails };
        const left = { want: "lan", hostname: null, outcome: "applied", summary: "Valmis.", at: "2026-10-12T09:00:00.000Z" };
        const note = "Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista.";
        fake.ahead.push(() => Object.assign(s, { pending: null, access: { ...OFF.access }, last: left, cloudflare: { ...kept, removal: "waiting", note } }));
        fake.ahead.push(() => Object.assign(s, { cloudflare: { hostname: null, emails: [], removal: "removed", note: null } }));
      }
    }
    await route.fulfill({ json: s });
  });
  return fake;
}

/** On a server without the administrator (e2e/run.mjs makes one): makes it the same way and keeps the session. */
async function ensureAdmin(browser: Browser) {
  if (existsSync(STATE)) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Asennuskoodi").fill(process.env.E2E_SETUP_CODE ?? "");
  await page.getByLabel("Käyttäjätunnus").fill("e2e-admin");
  await page.getByLabel("Nimi", { exact: true }).fill("E2E Admin");
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill("e2e-salasana-123456");
  await page.getByLabel("Salasana uudelleen").fill("e2e-salasana-123456");
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();
  await page.getByRole("button", { name: "Ohita" }).click();
  await page.getByRole("button", { name: "Siirry sovellukseen" }).click();
  await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
  await context.storageState({ path: STATE });
  await context.close();
}

async function open(browser: Browser, width: number, start: Json = OFF) {
  await ensureAdmin(browser);
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  page.on("pageerror", (e) => logged.push(`page error: ${e.message}`));
  const fake = await standIn(page, start);
  await page.goto("/#/settings?section=technical");
  const section = page.locator("#etakaytto");
  await expect(section.getByRole("heading", { name: "Etäkäyttö", level: 3 })).toBeVisible();
  return { context, page, fake, section, logged };
}

async function shot(target: Locator, name: string, width: number) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: join(SHOTS, `cw3b-${name}-${width}.png`) });
}

/** Opens the dialog of the button and gives the password. The yes (the dialog's own button) is pressed by the caller. */
async function openAsk(page: Page, opener: Locator, password = PASSWORD) {
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Salasanasi").fill(password);
  return dialog;
}

/** Opens the dialog, gives the password and sends. */
async function confirm(page: Page, opener: Locator, send: string, password = PASSWORD) {
  const dialog = await openAsk(page, opener, password);
  await dialog.getByRole("button", { name: send, exact: true }).click();
  return dialog;
}

// The page's answers are played by standIn, so the widths do not share state: each may run in a worker of its own.
test.describe.configure({ mode: "parallel" });

for (const width of [1280, 390]) {
  test.describe(`remote access at ${width} px`, () => {
    test.describe.configure({ mode: "serial" });

    test(`off, the token, on (waiting, trial, in), a change of emails, off, the token removed`, async ({ browser }) => {
      const { context, page, fake, section, logged } = await open(browser, width);
      const button = (name: string) => section.getByRole("button", { name, exact: true });

      // off, no token: where things stand, the token field and no form for the address
      await expect(section.getByText("Etäkäyttö ei ole käytössä.")).toBeVisible();
      await expect(section.getByRole("heading", { name: "Cloudflaren API-tunniste (API Token)" })).toBeVisible();
      await expect(section.locator('input[name="hostname"]')).toHaveCount(0);
      await expect(button("Tallenna tunniste")).toBeDisabled();
      await shot(section, "off", width);

      // the guide: the plain token page, the five permissions by Cloudflare's names, Zero Trust, the zone in use
      const guide = section.locator("details.remote-guide");
      await guide.locator("summary").click();
      await expect(guide.getByRole("link", { name: "Cloudflaren API-tunnisteiden sivu" })).toHaveAttribute("href", "https://dash.cloudflare.com/profile/api-tokens");
      await expect(guide.locator("ol > li")).toHaveCount(6);
      await expect(guide.locator("code")).toHaveText([
        "Zone: Zone: Read",
        "Zone: DNS: Edit",
        "Account: Cloudflare Tunnel: Edit",
        "Account: Access: Apps and Policies: Edit",
        "Account: Access: Organizations, Identity Providers, and Groups: Edit",
      ]);
      await expect(guide).toContainText("Zero Trust");
      await expect(guide).toContainText("Verkkotunnuksen pitää olla käytössä Cloudflaressa");
      expect(await overflow(page)).toBe(0);
      await shot(section, "guide", width);
      await guide.locator("summary").click();

      // save the token: a wrong password is explained and keeps the token in the field; the right one empties it
      const field = section.getByLabel("API-tunniste", { exact: true });
      await expect(field).toHaveAttribute("type", "password");
      await expect(field).toHaveAttribute("autocomplete", "off");
      await field.fill(TOKEN);
      let dialog = await confirm(page, button("Tallenna tunniste"), "Tallenna", "väärä salasana");
      await expect(dialog.getByText("Salasana ei täsmää.")).toBeVisible();
      await expect(field).toHaveValue(TOKEN);
      await shot(page.getByRole("dialog"), "token-dialog", width);
      await dialog.getByLabel("Salasanasi").fill(PASSWORD);
      await dialog.getByRole("button", { name: "Tallenna", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(section.getByText("Se näkee verkkotunnuksen example.fi.")).toBeVisible();
      await expect(field).toHaveCount(0);
      await shot(section, "token-saved", width);

      // the form starts with the address Cloudflare's zone suggests; a line that is no email is caught before the password
      const host = section.locator('input[name="hostname"]');
      const emails = section.locator('textarea[name="emails"]');
      await expect(host).toHaveValue("talous.example.fi");
      await emails.fill("ei-sahkoposti");
      await button("Ota etäkäyttö käyttöön").click();
      await expect(section.getByText("Osoite 1 ei ole sähköpostiosoite.")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await shot(section, "email-problem", width);

      // the yes-step: the address and every email back, and that the home address stops answering; nothing is sent before the yes
      await emails.fill("anna@example.fi\nmatti@example.fi");
      dialog = await openAsk(page, button("Ota etäkäyttö käyttöön"));
      await expect(dialog.getByRole("heading", { name: "Tarkista ennen käyttöönottoa" })).toBeVisible();
      await expect(dialog.getByText("https://talous.example.fi", { exact: true })).toBeVisible();
      await expect(dialog.locator("li")).toHaveText(["anna@example.fi", "matti@example.fi"]);
      await expect(dialog).toContainText("Kun etäkäyttö on päällä, kotiverkon osoite ei enää vastaa.");
      await expect(dialog).toContainText("Avaa se 15 minuutin kuluessa ja kirjaudu sisään Cloudflaren kautta");
      expect(fake.posts("/on")).toHaveLength(0);
      await shot(page.getByRole("dialog"), "yes-step", width);

      // turning on: the server says a change is already waiting, the page shows its sentence and reads the state again; the second try goes through
      fake.refuse = { status: 409, error: REFUSED };
      const readsBefore = fake.seen.filter((r) => r.method === "GET").length;
      await dialog.getByRole("button", { name: "Kyllä, ota käyttöön", exact: true }).click();
      await expect(dialog.getByText(REFUSED)).toBeVisible();
      await expect.poll(() => fake.seen.filter((r) => r.method === "GET").length).toBeGreaterThan(readsBefore);
      await dialog.getByLabel("Salasanasi").fill(PASSWORD);
      await dialog.getByRole("button", { name: "Kyllä, ota käyttöön", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(section.getByText("Muutos odottaa ylläpitoapuria.")).toBeVisible();
      await expect(section.getByText("Kun muutos on tehty, kotiverkon osoite ei enää vastaa.")).toBeVisible();
      await expect(section.locator('input[name="hostname"]')).toHaveCount(0);
      // no removing of the token while a change waits
      await expect(button("Poista tunniste")).toHaveCount(0);
      await shot(section, "pending", width);

      // withdrawn, then again; the page reads the state until the helper has done it, and the new address is on trial
      await button("Peruuta muutos").click();
      await expect(section.locator('input[name="hostname"]')).toHaveValue("talous.example.fi");
      expect(fake.seen.filter((r) => r.method === "POST" && r.url.endsWith(`/api/ops/cancel/${REQUEST}`) && r.body === "{}")).toHaveLength(1);
      await emails.fill("anna@example.fi\nmatti@example.fi");
      await confirm(page, button("Ota etäkäyttö käyttöön"), "Kyllä, ota käyttöön");
      await expect(section.getByText("Muutos odottaa ylläpitoapuria.")).toBeVisible();
      await expect(section.getByText("Uusi osoite on kokeilussa.")).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("kirjaudu sisään Cloudflaren kautta ennen kello")).toBeVisible();
      await expect(section.getByText("palvelin ottaa osoitteen itse pois käytöstä")).toBeVisible();
      await expect(section.getByRole("link", { name: "https://talous.example.fi" }).first()).toBeVisible();
      await shot(section, "trial", width);

      // somebody comes in through Cloudflare: the page is told on its next read
      fake.state.access = { ...fake.state.access, confirmed: true, revertAt: null };
      await expect(section.getByText("Etäkäyttö on käytössä.")).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("Uusi osoite on kokeilussa.")).toHaveCount(0);
      await expect(section.locator(".remote-emails li")).toHaveText(["anna@example.fi", "matti@example.fi"]);
      await shot(section, "on", width);

      // a change of who gets in is not on trial, and its yes-step is the list back
      await expect(host).toHaveAttribute("readonly", "");
      await emails.fill("anna@example.fi\nmatti@example.fi\nliisa@example.fi");
      dialog = await openAsk(page, button("Tallenna sallitut osoitteet"));
      await expect(dialog.getByRole("heading", { name: "Tarkista sallitut sähköpostiosoitteet" })).toBeVisible();
      await expect(dialog.locator("li")).toHaveText(["anna@example.fi", "matti@example.fi", "liisa@example.fi"]);
      await expect(dialog).toContainText("Tämä muutos ei ole kokeilussa.");
      await shot(page.getByRole("dialog"), "yes-step-emails", width);
      await dialog.getByRole("button", { name: "Kyllä, tallenna lista", exact: true }).click();
      await expect(section.getByText("Muutos odottaa ylläpitoapuria.")).toBeVisible();
      await expect(section.getByText("Kun muutos on tehty, kotiverkon osoite ei enää vastaa.")).toHaveCount(0);
      await expect(section.locator(".remote-emails li")).toHaveText(["anna@example.fi", "matti@example.fi", "liisa@example.fi"], { timeout: 15_000 });
      expect(fake.posts("/on").at(-1)).toEqual({ hostname: "talous.example.fi", emails: ["anna@example.fi", "matti@example.fi", "liisa@example.fi"], password: PASSWORD });

      // off: the page says first where the app is found afterwards (a home network address, so no box to tick)
      await expect(section.getByText("Kun etäkäyttö otetaan pois käytöstä, etäosoitteella avattu selain menettää yhteyden.")).toBeVisible();
      await expect(section.getByText(`Tämän jälkeen Omatalous löytyy osoitteesta ${HOME}.`)).toBeVisible();
      // the token stays while remote access is on
      await expect(section.getByText("Tunniste tarvitaan, kun etäkäyttö otetaan pois käytöstä.")).toBeVisible();
      await expect(button("Poista tunniste")).toHaveCount(0);
      await shot(section, "on-off-button", width);
      dialog = await openAsk(page, button("Ota etäkäyttö pois käytöstä"));
      await expect(dialog.getByRole("heading", { name: "Ota etäkäyttö pois käytöstä" })).toBeVisible();
      await expect(dialog).toContainText(`Tämän jälkeen Omatalous löytyy osoitteesta ${HOME}.`);
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      await shot(page.getByRole("dialog"), "off-home", width);
      // the server is not ready to answer: its sentence, as it comes
      fake.refuse = { status: 409, error: NOT_REPORTED };
      await dialog.getByRole("button", { name: "Ota pois käytöstä", exact: true }).click();
      await expect(dialog.getByText(NOT_REPORTED)).toBeVisible();
      await dialog.getByLabel("Salasanasi").fill(PASSWORD);
      await dialog.getByRole("button", { name: "Ota pois käytöstä", exact: true }).click();
      await expect(section.getByText("Etäkäyttö otetaan pois käytöstä.").first()).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista.")).toBeVisible();
      await expect(button("Ota etäkäyttö pois käytöstä")).toHaveCount(0);
      await expect(button("Poista tunniste")).toHaveCount(0);
      await shot(section, "removal-waiting", width);
      await expect(section.getByText("Etäkäyttö ei ole käytössä.")).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("Cloudflaren puoli poistetaan")).toHaveCount(0);
      await expect(host).toHaveValue("talous.example.fi");
      await expect(host).not.toHaveAttribute("readonly", "");
      // a home address off sends no localOnly
      expect(fake.posts("/off").every((b) => b.localOnly === undefined)).toBe(true);

      // the token goes with the password: a wrong one is explained, the right one removes it and the field is back
      dialog = await openAsk(page, button("Poista tunniste"), "väärä salasana");
      await expect(dialog.getByRole("heading", { name: "Poista API-tunniste" })).toBeVisible();
      await dialog.getByRole("button", { name: "Poista tunniste", exact: true }).click();
      await expect(dialog.getByText("Salasana ei täsmää.")).toBeVisible();
      await dialog.getByLabel("Salasanasi").fill(PASSWORD);
      await dialog.getByRole("button", { name: "Poista tunniste", exact: true }).click();
      await expect(section.getByLabel("API-tunniste", { exact: true })).toBeVisible();
      const removals = fake.seen.filter((r) => r.method === "DELETE");
      expect(removals.map((r) => JSON.parse(r.body))).toEqual([{ password: "väärä salasana" }, { password: PASSWORD }]);

      // the token was in one request body and nowhere else
      const withToken = fake.seen.filter((r) => JSON.stringify(r).includes(TOKEN));
      expect(withToken.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(["PUT /api/admin/remote-access/token", "PUT /api/admin/remote-access/token"]);
      const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href]));
      expect(stored).not.toContain(TOKEN);
      expect(logged.join("\n")).not.toContain(TOKEN);
      expect(await overflow(page)).toBe(0);
      // the only console errors are the refusals this test asked for (403 and 409)
      expect(logged.filter((l) => !/Failed to load resource.*(403|409)/.test(l))).toEqual([]);
      await context.close();
    });

    test("off for a copy that would answer on the server machine alone: waits for an explicit choice and sends localOnly", async ({ browser }) => {
      const { context, page, fake, section, logged } = await open(browser, width, IN_TUNNEL(["anna@example.fi"], { afterOff: "http://localhost:8080" }));
      await expect(section.getByText("Tämän jälkeen Omatalous vastaa vain palvelimella itsellään, osoitteessa http://localhost:8080.").first()).toBeVisible();
      await expect(section.getByText("löytyy osoitteesta")).toHaveCount(0);
      const dialog = await openAsk(page, section.getByRole("button", { name: "Ota etäkäyttö pois käytöstä", exact: true }));
      const choice = dialog.getByRole("checkbox", { name: "Ymmärrän tämän ja haluan ottaa etäkäytön pois käytöstä." });
      await expect(choice).not.toBeChecked();
      await expect(dialog).toContainText("Kotiverkon muut laitteet eivät pääse siihen.");
      await shot(page.getByRole("dialog"), "off-local-only", width);
      // not ticked: the browser holds the form back and no call is made
      await dialog.getByRole("button", { name: "Ota pois käytöstä", exact: true }).click();
      await page.waitForTimeout(300);
      expect(fake.posts("/off")).toHaveLength(0);
      // ticked, and the server still asks (as if the choice had not reached it): its sentence stays in the dialog
      await choice.check();
      fake.refuse = { status: 400, error: LOCAL_ASKED };
      await dialog.getByRole("button", { name: "Ota pois käytöstä", exact: true }).click();
      await expect(dialog.getByText(LOCAL_ASKED)).toBeVisible();
      // the dialog empties its form after a refusal, the box too: the choice is made again
      await choice.check();
      await dialog.getByLabel("Salasanasi").fill(PASSWORD);
      await dialog.getByRole("button", { name: "Ota pois käytöstä", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(section.getByText("Etäkäyttö otetaan pois käytöstä.").first()).toBeVisible();
      expect(fake.posts("/off")).toEqual([{ password: PASSWORD, localOnly: true }, { password: PASSWORD, localOnly: true }]);
      expect(await overflow(page)).toBe(0);
      expect(logged.filter((l) => !/Failed to load resource.*(400|403|409)/.test(l))).toEqual([]);
      await context.close();
    });

    test("the home address stops answering after the turning on: the page points to the remote address and stops asking", async ({ browser }) => {
      const { context, page, fake, section } = await open(browser, width, { ...OFF, token: SAVED, suggestedHostname: "talous.example.fi", pending: PENDING("tunnel") });
      await expect(section.getByText("Muutos odottaa ylläpitoapuria.")).toBeVisible();
      fake.blocked = true;
      await expect(section.getByText("Etäkäyttö on otettu käyttöön, eikä kotiverkon osoite enää vastaa.")).toBeVisible({ timeout: 15_000 });
      await expect(section.getByRole("link", { name: "https://talous.example.fi" })).toHaveAttribute("href", "https://talous.example.fi");
      await expect(section).toContainText("15 minuutin kuluessa");
      await shot(section, "home-blocked", width);
      const reads = fake.seen.filter((r) => r.method === "GET").length;
      await page.waitForTimeout(4000);
      expect(fake.seen.filter((r) => r.method === "GET").length).toBe(reads);
      expect(await overflow(page)).toBe(0);
      await context.close();
    });

    const STATES: [string, Json, string][] = [
      ["off-token-saved", { ...OFF, token: SAVED, suggestedHostname: "talous.example.fi" }, "Ota etäkäyttö käyttöön"],
      ["token-unusable", { ...OFF, token: { ...SAVED, usable: false } }, "Tallennettu tunniste ei enää aukea."],
      ["on", IN_TUNNEL(["anna@example.fi", "matti@example.fi"]), "Etäkäyttö on käytössä."],
      ["trial", ON_TRIAL(["anna@example.fi", "matti@example.fi"]), "Uusi osoite on kokeilussa."],
      [
        "trial-overdue",
        IN_TUNNEL(["anna@example.fi"], { confirmed: false, revertAt: "2026-01-01T08:20:00.000Z" }),
        "Kokeiluaika päättyi kello",
      ],
      [
        "reverted",
        {
          ...OFF,
          token: SAVED,
          suggestedHostname: "talous.example.fi",
          last: {
            want: "tunnel",
            hostname: "talous.example.fi",
            outcome: "reverted",
            summary: "Etäkäyttö otettiin pois käytöstä, koska kukaan ei päässyt sisään uuden osoitteen kautta 15 minuutissa.",
            at: "2026-10-12T08:20:00.000Z",
          },
        },
        "Uusi osoite ei toiminut, joten etäkäyttö otettiin pois käytöstä.",
      ],
      [
        "installer-host",
        { ...IN_TUNNEL([]), access: { ...IN_TUNNEL([]).access, emailsKnown: false, checked: false }, cloudflare: { hostname: null, emails: [], removal: null, note: null } },
        "Lista on tehty palvelimella asennusohjelmalla",
      ],
      [
        "installer-left",
        {
          ...OFF,
          token: SAVED,
          cloudflare: {
            hostname: null,
            emails: [],
            removal: "installer",
            note: "Tämän osoitteen on tehnyt Cloudflareen palvelimen asennusohjelma, joten tunneli, DNS-tietue ja kirjautumissuojaus (Access) jäivät sinne. Poista ne Cloudflaren hallinnasta tai palvelimen asennusohjelmalla.",
          },
        },
        "Tämän osoitteen on tehnyt Cloudflareen palvelimen asennusohjelma",
      ],
      ["pending-first-on", { ...OFF, token: SAVED, suggestedHostname: "talous.example.fi", pending: PENDING("tunnel") }, "Kun muutos on tehty, kotiverkon osoite ei enää vastaa."],
      ["pending-queued", { ...IN_TUNNEL(["anna@example.fi"]), pending: PENDING("tunnel") }, "Muutos odottaa ylläpitoapuria."],
      ["pending-running-off", { ...IN_TUNNEL(["anna@example.fi"]), pending: PENDING("lan", "running") }, "Etäkäyttö otetaan pois käytöstä."],
      [
        "failed",
        { ...OFF, token: SAVED, suggestedHostname: "talous.example.fi", last: { want: "tunnel", hostname: "talous.example.fi", outcome: "failed", summary: "Sovellus ei käynnistynyt uudelleen, joten vanha asetus palautettiin.", at: "2026-10-12T08:05:00.000Z" } },
        "Edellinen muutos ei onnistunut.",
      ],
      [
        "cloudflare-kept",
        { ...LEFT, cloudflare: { ...LEFT.cloudflare, removal: "kept", note: "Osoitteeseen johtaa Cloudflaressa vielä jotain, mitä tämä asennus ei ole tehnyt, joten kirjautumissuojaus (Access) jätettiin päälle. Poista ylimääräinen tunneli tai DNS-tietue Cloudflaren hallinnasta ja ota etäkäyttö sitten uudelleen pois käytöstä." } },
        "Cloudflaressa on osoite talous.example.fi, mutta sovellus ei ole sen takana.",
      ],
      ["helper-off", { ...OFF, token: SAVED, helper: { ...OFF.helper, status: "off", knowsAccess: false } }, "Etäkäyttö ei ole käytössä."],
      ["helper-old", { ...OFF, token: SAVED, helper: { ...OFF.helper, knowsAccess: false } }, "Etäkäyttö ei ole käytössä."],
      ["domain", { ...OFF, access: { ...OFF.access, mode: "domain" } }, "Tällä asennuksella on oma verkkotunnus (Caddy)"],
    ];

    test("every state shows its own block and fits the screen", async ({ browser }) => {
      const { context, page, fake, section } = await open(browser, width);
      for (const [name, state, text] of STATES) {
        fake.state = structuredClone(state);
        await page.reload();
        await expect(section.getByText(text).first()).toBeVisible();
        await section.scrollIntoViewIfNeeded();
        expect(await overflow(page), name).toBe(0);
        // the token is not offered for removal while a change or a removal waits
        if (state.pending) await expect(section.getByRole("button", { name: "Poista tunniste", exact: true }), name).toHaveCount(0);
        await shot(section, name, width);
      }
      await context.close();
    });
  });
}
