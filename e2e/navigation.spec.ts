import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The header and the phone's tab bar: the tabs (Yhteenveto, Tapahtumat, Laskut, Varat ja velat, Raportit), in the header of a
// wide screen; the bar at the foot of a phone has the same five (it draws Varat for Varat ja velat). Tarkistettavat is a
// link of the header with its count of open items, and Asetukset is in the user menu.
const PHONE = ["Yhteenveto", "Tapahtumat", "Laskut", "Varat ja velat", "Raportit"];
const WIDE = PHONE;
const ADDRESSES = ["#/overview", "#/transactions", "#/bills", "#/balances", "#/reports"];
const review = (page: Page) => page.locator("header.topbar .review-link");
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
    await expect(tabs(page)).toHaveText(PHONE);
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

test("390 px: the bar draws Varat for Varat ja velat, the user button shows the initials and keeps the full name", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const balances = tabs(page).nth(3);
  // what is drawn: the label is hidden and the short text is the ::after content
  const drawn = await balances.evaluate((el) => {
    const label = el.querySelector<HTMLElement>(".nav-label");
    return { label: label ? getComputedStyle(label).display : "", after: getComputedStyle(el, "::after").content };
  });
  expect(drawn).toEqual({ label: "none", after: '"Varat"' });
  await expect(balances).toHaveAccessibleName("Varat ja velat");
  await expect(page.locator(".user-menu summary .user-initials")).toHaveText("EA");
  await expect(page.locator(".user-menu summary .user-name")).toHaveText("E2E Admin");
  await expect(page.locator(".user-menu summary")).toHaveAccessibleName(/E2E Admin/);
  await context.close();
});

for (const width of [390, 1440]) {
  test(`${width} px: the tabs are in sight by name, each opens its page, and Tarkistettavat carries the count of open items`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, ...(width < 641 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const seen = watch(page);
    await context.route(/\/api\/review\/count$/, (r) => r.fulfill({ json: { count: 7 } }));
    await page.goto("/#/review");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    // Tarkistettavat: its own address and title, its link the current one and no tab
    await expect(page).toHaveTitle(/^Tarkistettavat/);
    await expect(tabs(page)).toHaveText(WIDE);
    await expect(page.locator('nav.nav [aria-current="page"]')).toHaveCount(0);
    await expect(review(page)).toHaveAttribute("aria-current", "page");
    // on its own page the count is the queue's; on the others it is the count the header asked for
    await expect(review(page).locator(".nav-count")).toHaveText(/^\d+/);
    for (const [n, address] of ADDRESSES.entries()) {
      await expect(tabs(page).nth(n)).toBeVisible();
      await tabs(page).nth(n).click();
      await expect.poll(() => new URL(page.url()).hash.split("?")[0]).toBe(address);
      await expect(tabs(page).nth(n)).toHaveAttribute("aria-current", "page");
      await expect(page.locator('nav.nav [aria-current="page"]')).toHaveCount(1);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

for (const width of [390, 1440]) {
  test(`${width} px: the logo is a link named Omatalous that opens Yhteenveto, by keyboard too`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, ...(width < 641 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await page.goto("/#/bills");
    const logo = page.locator("header.topbar").getByRole("link", { name: "Omatalous", exact: true });
    await expect(logo).toBeVisible();
    await logo.focus();
    await expect(logo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).hash.split("?")[0]).toBe("#/overview");
    await expect(logo).toHaveAttribute("aria-current", "page");
    await context.close();
  });
}

test("390 px: Tarkistettavat is a link of the top row and shows when open, Asetukset is in the user menu, and #/more opens Yhteenveto", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/#/overview");
  await review(page).tap();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/review");
  await expect(review(page)).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).filter({ hasText: "Tarkistettavat" })).toHaveCount(0);
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
  await expect(tabs(page)).toHaveText(WIDE);
  await expect(page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true })).toHaveCount(0);
  await page.locator(".user-menu summary").click();
  const menu = page.locator(".user-menu .menu");
  await expect(menu.getByRole("link")).toHaveText(["Asetukset"]);
  await expect(menu.getByRole("button")).toHaveText(["English", "Kirjaudu ulos"]);
  await expect(menu.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
  await context.close();
});

test("390 px: Tarkistettavat leaves the header only when the count says nothing is open, not when the count fails", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await context.route(/\/api\/review\/count$/, (r) => r.fulfill({ status: 500, json: { error: "Ei onnistunut" } }));
  await page.goto("/#/overview");
  await expect(page.getByRole("navigation", { name: "Päävalikko" })).toBeVisible();
  await expect(review(page)).toHaveCount(1);
  await context.close();
});

test("390 px: Tarkistettavat has its word in the top row and the header holds one row", async ({ browser }) => {
  const { context, page } = await phone(browser);
  // the header shows its link only while something is open
  await context.route(/\/api\/review\/count$/, (r) => r.fulfill({ json: { count: 7 } }));
  await page.goto("/#/overview");
  const link = review(page);
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
      // with nothing open the header has no link
      if (!count) await expect(link).toHaveCount(0);
      else await expect(link).toContainText("Tarkistettavat");
      const word = count ? await link.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const r = range.getBoundingClientRect();
        return { width: r.width, height: r.height, clip: getComputedStyle(el).clipPath };
      }) : null;
      if (word) {
        expect(word.width, "the word is drawn").toBeGreaterThan(40);
        expect(word.clip).toBe("none");
        await expect(link.locator(".nav-count")).toBeVisible();
      }
      const right = await page.locator(".user-menu summary").evaluate((e) => e.getBoundingClientRect().right);
      expect(right, "the user menu is inside the screen").toBeLessThanOrEqual(width);
      // one row: the switch, the count and the user menu share a vertical centre
      const centres = await page.locator(".scope-toggle, .review-link, .user-menu").evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return r.top + r.height / 2;
      }));
      expect(centres).toHaveLength(count ? 3 : 2);
      expect(Math.max(...centres) - Math.min(...centres), "the header row does not wrap").toBeLessThan(8);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await context.close();
    });
  }
}
