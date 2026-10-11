import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset: the header link, Omat and Talous, and the repair of a bank connection that ended. Runs after app.spec.ts,
// which created the administrator and loaded the demo household.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Asetukset is a link in the header with Omat and Talous, Tietojen laatu is in Tilit, and the old addresses keep working", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const nav = page.getByRole("navigation", { name: "Päävalikko" });
  const hash = () => new URL(page.url()).hash;

  // five questions in the nav, and Asetukset beside the user menu instead of among them
  await page.goto("/#/overview");
  await expect(nav.getByRole("link")).toHaveText(["Kuukausi", "Laskut", "Tapahtumat", "Raportit", "Säästövinkit"]);
  await expect(nav.getByRole("link", { name: "Asetukset" })).toHaveCount(0);
  const header = page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true });
  await header.click();
  await expect.poll(hash).toBe("#/settings");
  await expect(page).toHaveTitle(/^Asetukset/);
  await expect(header).toHaveAttribute("aria-current", "page");

  // Omat holds a member's own cards; Tilit carries the data quality notes that used to be a report
  const tabs = page.getByRole("group", { name: "Asetukset" });
  await expect(tabs.getByRole("button", { name: "Omat" })).toHaveAttribute("aria-pressed", "true");
  for (const heading of ["Pankkiyhteydet", "Tilit", "Kirjautuminen"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator("#tilit").getByRole("heading", { name: "Tietojen laatu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turvallisuusloki" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lisää pankkiyhteys" })).toBeVisible();
  await expect(page.getByText("Lisää seuraava tili")).toHaveCount(0);

  // Raportit no longer has the card, and the month page links to it
  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Tietojen laatu" })).toHaveCount(0);
  await page.goto("/#/overview");
  await page.locator(".data-scope").getByRole("link", { name: "Tietojen laatu" }).click();
  await expect.poll(hash).toBe("#/settings#laatu");
  await expect(page.locator("#tilit").getByRole("heading", { name: "Tietojen laatu" })).toBeVisible();

  // Talous is the household's: members, the server, the log and the way to maintenance
  await tabs.getByRole("button", { name: "Talous" }).click();
  await expect.poll(hash).toBe("#/settings?tab=talous");
  for (const heading of ["Talouden jäsenet", "Palvelin", "Turvallisuusloki", "Ylläpito"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Avaa ylläpito" })).toBeVisible();

  // the old security page: an admin lands at the log, in the Talous tab; the rewrite leaves no old entry for Back
  await page.goto("/#/overview");
  await page.goto("/#/settings?section=security");
  await expect.poll(hash).toBe("#/settings?tab=talous#turvallisuusloki");
  await expect(page.getByRole("heading", { name: "Turvallisuusloki" })).toBeVisible();
  await expect(tabs.getByRole("button", { name: "Talous" })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  expect(page.url()).toMatch(/#\/overview$/);

  // Palvelin, the CSV import and the bank picker keep their addresses
  await page.goto("/#/settings?section=server");
  await expect(tabs.getByRole("button", { name: "Talous" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Palvelin", exact: true })).toBeVisible();
  await page.goto("/#/settings?section=csv");
  await expect(page.getByRole("heading", { name: "Tuo CSV" })).toBeVisible();
  await page.goto("/#/settings?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();

  // Vaihda salasana in the user menu opens Kirjautuminen with the form
  await page.goto("/#/overview");
  await page.locator("summary[aria-label='Käyttäjävalikko']").click();
  await page.getByRole("link", { name: "Vaihda salasana" }).click();
  await expect.poll(hash).toBe("#/settings#salasana");
  await expect(page.getByLabel("Nykyinen salasana")).toBeVisible();
  await expect(page.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();

  // a phone: five labels in one row, and Asetukset still in the header
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/overview");
  const tops = await nav.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, "the five labels share one row").toBe(1);
  await expect(page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an ended or ending bank connection has Yhdistä uudelleen on its row and in the banner, and the row starts the same bank again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const connection = (id: string, state: string, daysLeft: number | null) => ({
    id,
    institution: "Nordea",
    status: state === "active" ? "active" : "expired",
    state,
    history: false,
    replaced: false,
    validUntil: state === "active" ? "2026-10-20T00:00:00Z" : "2026-09-01T00:00:00Z",
    createdAt: "2026-03-01T00:00:00Z",
    lastSyncedAt: null,
    daysLeft,
  });
  // one consent that ended and one that ends in nine days, on a server that has its bank application
  let metaAsked = 0;
  let metaAnswered = 0;
  await page.route("**/api/meta", async (route) => {
    metaAsked++;
    const response = await route.fetch();
    const json = await response.json();
    json.connections = [connection("old", "lapsed", null), connection("soon", "active", 9)];
    json.bank = { ...json.bank, configured: true, redirectMode: "own" };
    await route.fulfill({ response, json });
    metaAnswered++;
  });
  const started: unknown[] = [];
  await page.route("**/api/connections/start", async (route) => {
    started.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/#/settings?connected=1" } });
  });

  await page.goto("/#/overview");
  // the banner of the ended consent opens the bank picker at Asetukset
  const banner = page.locator(".notice", { hasText: "vanhentui" });
  await expect(banner.getByRole("link", { name: "Yhdistä uudelleen" })).toHaveAttribute("href", "#/settings?add=1");
  await banner.getByRole("link", { name: "Yhdistä uudelleen" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lisää pankkiyhteys" })).toBeHidden();

  // both rows offer it, one click starts Nordea again without the picker
  await page.getByRole("button", { name: "Sulje" }).click();
  await expect(page.getByRole("button", { name: "Lisää pankkiyhteys" })).toBeVisible();
  const reconnect = page.getByRole("table").getByRole("button", { name: "Yhdistä uudelleen" });
  await expect(reconnect).toHaveCount(2);
  const readBefore = metaAsked;
  await reconnect.first().click();
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "nordea-fi" });
  // The click is not over when the start is answered: the page goes to the address it was given and reads /api/meta
  // again, a few ms later. Closing the context before that read is answered cuts its route.fetch off (1 run in 100).
  await expect.poll(() => metaAsked > readBefore && metaAnswered === metaAsked).toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});
