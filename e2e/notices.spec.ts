import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// The notices of the server: no page shows them but Asetukset > Turvallisuus. An event the user has not seen (a sign-in
// from a new device) is a dot on the user menu and a line of Turvallisuus; opening Turvallisuus marks the events seen,
// and the dot goes. Alerts and insights are not here: Tarkistettavat has them.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

async function open(context: BrowserContext, width = 1280): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/#/overview?period=month");
  await expect(page.locator(".home-tiles")).toBeVisible();
  await page.waitForLoadState("networkidle");
  return page;
}

const dotOf = (page: Page) => page.locator(".user-menu .notice-dot");

test("a sign-in from a new device is a dot on the user menu and a line of Turvallisuus, never a line of Yhteenveto", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "kirjaus");
  const context = await browser.newContext({ storageState: state });
  const other = await browser.newContext({ userAgent: FIREFOX });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    const login = await other.request.post("/api/auth/login", { headers: FETCH, data: { username: "kirjaus", password: "kirjaus-123456" } });
    expect(login.ok(), `POST /api/auth/login answered ${login.status()}`).toBe(true);
    const page = await open(context);
    const seen = watch(page);
    // Yhteenveto has no notice of any kind
    await expect(page.locator("main .notice, main .notice-list, main .home-notice")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Kirjautuminen uudelta laitteelta");
    await expect(dotOf(page)).toHaveCount(1);
    // the user menu names the news and leads to its line
    await page.locator(".user-menu summary").click();
    const link = page.locator(".user-menu").getByRole("link", { name: "Uusi ilmoitus" });
    await expect(link).toHaveAttribute("href", "#/settings/security#turvallisuusilmoitukset");
    await link.click();
    const list = page.getByRole("region", { name: "Ilmoitukset" });
    await expect(list).toContainText(/Kirjautuminen uudelta laitteelta \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2} \(Firefox, Linux\)/);
    // Turvallisuus has the log under the line, and the list marks the events seen once it has them
    await expect(page.getByRole("heading", { name: "Turvallisuusloki" })).toBeVisible();
    await expect(dotOf(page)).toHaveCount(0);
    // the line that was new keeps its mark while the page is open, so the reader still sees which one it was
    await expect(list.locator("li.notice-news")).toHaveCount(1);
    await page.goto("/#/overview?period=month");
    await expect(page.locator(".home-tiles")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(dotOf(page)).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  } finally {
    await other.close();
    await context.close();
    await removeMember(browser, id);
  }
});

test("one page load of Yhteenveto asks /api/meta once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  let asked = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/meta") asked++;
  });
  await page.goto("/#/overview?period=month");
  await expect(page.locator(".home-tiles")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(asked).toBe(1);
  await context.close();
});
