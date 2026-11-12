import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// The notices on Yhteenveto: one line at most, under the answer, for an event the user has not seen (a sign-in from a
// new device). Opening the line or the security log marks the events seen, and the line goes.
// Alerts and insights are not here any more: Tarkistettavat has them.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

async function open(context: BrowserContext, width = 1280): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/#/overview?period=month");
  await expect(page.locator(".home-answer-line")).toBeVisible();
  await page.waitForLoadState("networkidle");
  return page;
}

const lineOf = (page: Page) => page.locator(".home-notice");

test("a sign-in from a new device is one line under the answer, and goes once the security log is opened", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "kirjaus");
  const context = await browser.newContext({ storageState: state });
  const other = await browser.newContext({ userAgent: FIREFOX });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    const login = await other.request.post("/api/auth/login", { headers: FETCH, data: { username: "kirjaus", password: "kirjaus-123456" } });
    expect(login.ok(), `POST /api/auth/login answered ${login.status()}`).toBe(true);
    const page = await open(context);
    const seen = watch(page);
    // not a banner above the page, nor a card with a heading: one line
    await expect(page.locator(".notice")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ilmoitukset" })).toHaveCount(0);
    const line = lineOf(page);
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(/Kirjautuminen uudelta laitteelta \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2} \(Firefox, Linux\)/);
    await expect(line.getByRole("link")).toHaveAttribute("href", "#/settings/security#turvallisuusloki");

    await line.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Turvallisuusloki" })).toBeVisible();
    await page.goto("/#/overview?period=month");
    await expect(page.locator(".home-answer-line")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(lineOf(page)).toHaveCount(0);
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
  await expect(page.locator(".home-answer-line")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(asked).toBe(1);
  await context.close();
});
