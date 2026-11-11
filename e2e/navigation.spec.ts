import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The header and the phone's tab bar: Asetukset in the user menu, Tarkistettavat with its word, five tabs at the foot of a
// phone (Yhteenveto, Kuukausi, Laskut, Tapahtumat, Säästövinkit); Asetukset is in the user menu.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const TAP = 44;

const phone = async (browser: Browser, width = 390) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
  return { context, page: await context.newPage() };
};
const tabs = (page: Page) => page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link");

for (const width of [390, 320]) {
  test(`${width} px: the tab bar has five tabs, each at least ${TAP} px, in one row, and nothing scrolls sideways`, async ({ browser }) => {
    const { context, page } = await phone(browser, width);
    const seen = watch(page);
    await page.goto("/#/overview");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(tabs(page)).toHaveText(["Yhteenveto", "Kuukausi", "Laskut", "Tapahtumat", "Säästövinkit"]);
    const boxes = await tabs(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), width: r.width, height: r.height, right: r.right })));
    expect(boxes).toHaveLength(5);
    expect(new Set(boxes.map((b) => b.top)).size, "one row").toBe(1);
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(TAP);
      expect(b.height).toBeGreaterThanOrEqual(TAP);
    }
    expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(width);
    // the labels are whole words, not cut
    expect(await tabs(page).evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent))).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("390 px: Säästövinkit is the fifth tab and shows when open, Asetukset is in the user menu, and #/more opens Yhteenveto", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/#/overview");
  await tabs(page).getByText("Säästövinkit", { exact: true }).tap();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/optimise");
  await expect(tabs(page).filter({ hasText: "Säästövinkit" })).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).filter({ hasText: "Lisää" })).toHaveCount(0);
  await page.locator(".user-menu summary").tap();
  await page.locator(".user-menu .menu").getByRole("link", { name: "Asetukset" }).tap();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings/banks");
  await expect(tabs(page)).toHaveCount(5);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.goto("/#/more");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/overview");
  await expect(page).toHaveTitle(/^Yhteenveto/);
  await context.close();
});

test("1280 px: every page is a link in the header, Asetukset is in the user menu with the other language and Kirjaudu ulos", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(tabs(page)).toHaveText(["Yhteenveto", "Kuukausi", "Laskut", "Tapahtumat", "Säästövinkit"]);
  await expect(page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true })).toHaveCount(0);
  await page.locator(".user-menu summary").click();
  const menu = page.locator(".user-menu .menu");
  await expect(menu.getByRole("link")).toHaveText(["Asetukset"]);
  await expect(menu.getByRole("button")).toHaveText(["English", "Kirjaudu ulos"]);
  await expect(menu.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
  await context.close();
});

test("390 px: Tarkistettavat has its word in the header and the header holds one row", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/#/overview");
  const link = page.locator("header.topbar .review-link");
  await expect(link).toContainText("Tarkistettavat");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(TAP);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const centres = await page.locator("header.topbar .topbar-in > :is(.brand, .review-link, .user-menu)").evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.top + r.height / 2);
  }));
  expect(centres).toHaveLength(3);
  expect(Math.max(...centres) - Math.min(...centres), "the header row does not wrap").toBeLessThan(4);
  await context.close();
});

// The header at its fullest: the view switch (a shared account), Tarkistettavat with a three-digit count (or none) and the user.
for (const width of [320, 360, 390]) {
  for (const count of [130, 0]) {
    test(`${width} px: the header with the view switch and ${count} open questions stays inside the screen, the word and the count in sight`, async ({ browser }) => {
      const { context, page } = await phone(browser, width);
      await context.route(/\/api\/meta(\?|$)/, async (r) => {
        const response = await r.fetch();
        const json = await response.json();
        if (!json.sharedAccounts.length && json.accounts.length) json.sharedAccounts = [{ ...json.accounts[0], id: "shared-nav", ownerName: "Eero" }];
        await r.fulfill({ response, json });
      });
      const items = Array.from({ length: count }, (_, n) => ({ kind: "payee_out", id: `payee_out:Kauppa ${n}`, cents: 100_000 - n, merchant: `Kauppa ${n}`, count: 2, lastDate: "2026-09-20", picks: ["groceries"], rows: [], rowCount: 0 }));
      await context.route(/\/api\/review$/, (r) => r.fulfill({ json: { items } }));
      // the header reads the count alone (routes/review.ts)
      await context.route(/\/api\/review\/count$/, (r) => r.fulfill({ json: { count: items.length } }));
      await page.goto("/#/overview");
      await expect(page.locator(".scope-toggle")).toBeVisible({ timeout: 15_000 });
      // what is drawn, not only the name a screen reader gets: the word is inside the link's box and has a size
      const link = page.locator(".review-link");
      await expect(link).toContainText("Tarkistettavat");
      const word = await link.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const r = range.getBoundingClientRect();
        return { width: r.width, height: r.height, clip: getComputedStyle(el).clipPath };
      });
      expect(word.width, "the word is drawn").toBeGreaterThan(40);
      expect(word.clip).toBe("none");
      if (count) await expect(link.locator(".nav-count")).toBeVisible();
      else await expect(link.locator(".nav-count")).toHaveCount(0);
      const right = await page.locator(".user-menu .avatar").evaluate((e) => e.getBoundingClientRect().right);
      expect(right, "the avatar is inside the screen").toBeLessThanOrEqual(width);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await context.close();
    });
  }
}
