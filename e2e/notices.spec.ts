import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// Ilmoitukset on Yhteenveto: the notices of the server (a sign-in from a new device), one line a row with no button:
// a notice goes when its cause or its time ends.
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

const cardOf = (page: Page) => page.getByRole("region", { name: "Ilmoitukset" });


test("a sign-in from a new device is the first row, leading to Asetukset, and has nothing to press", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "kirjaus");
  const context = await browser.newContext({ storageState: state });
  const other = await browser.newContext({ userAgent: FIREFOX });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    const login = await other.request.post("/api/auth/login", { headers: FETCH, data: { username: "kirjaus", password: "kirjaus-123456" } });
    expect(login.ok(), `POST /api/auth/login answered ${login.status()}`).toBe(true);
    const page = await open(context);
    const seen = watch(page);
    const card = cardOf(page);
    // not a banner above the page, but a row of the list
    await expect(page.locator(".notice")).toHaveCount(0);
    const first = card.getByRole("listitem").first();
    await expect(first).toContainText(/Kirjautuminen uudelta laitteelta \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2} \(Firefox, Linux\)/);
    await expect(first.getByRole("link")).toHaveAttribute("href", "#/settings/household#kirjautuminen");

    // nothing marks it as read: the card has no button, the old route is gone, and the row is there after a reload
    await expect(card.getByRole("button")).toHaveCount(0);
    expect((await context.request.post("/api/security/notices/seen", { headers: FETCH })).status()).toBe(404);
    await page.reload();
    await expect(page.locator(".home-answer-line")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Ilmoitukset" }).getByRole("listitem").first()).toContainText(/Kirjautuminen uudelta laitteelta/);
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
