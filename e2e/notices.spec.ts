import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// Ilmoitukset on Yhteenveto: the notices of the server (a sign-in from a new device), one line a row, read with Kuittaa.
// Alerts and insights are not here any more: Huomioitavaa and Tarkistettavat have them.
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


test("a sign-in from a new device is the first row, leading to Asetukset, and Kuittaa takes it away for good", async ({ browser }) => {
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

    // Kuittaa reads the notice, and it stays read after a reload
    await first.getByRole("button", { name: /^Kuittaa: Kirjautuminen uudelta laitteelta/ }).click();
    await expect(card.getByText(/Kirjautuminen uudelta laitteelta/)).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".home-answer-line")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Ilmoitukset" })).toHaveCount(0);
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
