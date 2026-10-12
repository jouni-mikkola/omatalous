import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Tapahtumat on a phone: rows under day headers, the filters behind Rajaa. It needs the administrator and the demo
// household that e2e/run.mjs makes; on a server without them it creates them itself.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";

async function signedIn(browser: Browser, width: number, height: number): Promise<BrowserContext> {
  if (!existsSync(STATE)) {
    const setup = await browser.newContext();
    const post = async (path: string, data: object) => {
      const r = await setup.request.post(`${BASE}${path}`, { data, headers: { "X-Requested-With": "fetch" } });
      expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
    };
    await post("/api/auth/setup", { code: process.env.E2E_SETUP_CODE ?? "", username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" });
    await post("/api/admin/instance/complete", {});
    await post("/api/demo", {});
    await setup.storageState({ path: STATE });
    await setup.close();
  }
  const phone = width < 600;
  return browser.newContext({ storageState: STATE, viewport: { width, height }, isMobile: phone, hasTouch: phone });
}

const WEEKDAY = ["su", "ma", "ti", "ke", "to", "pe", "la"];

test("390 px: rows sit under day headers, newest first, the merchant, category and amount on two lines", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const headers = page.locator(".tx-day h3");
  await expect(headers.first()).toBeVisible();
  expect(await headers.count()).toBeGreaterThan(5);

  // "ma 12.10." (a day of an earlier year has the year too), the weekday is the date's, and the days run backwards
  const year = new Date().getFullYear();
  const days: number[] = [];
  for (const text of (await headers.allInnerTexts()).slice(0, 12)) {
    const m = /^(su|ma|ti|ke|to|pe|la) (\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(text.trim());
    expect(m, `"${text}" is a day header`).not.toBeNull();
    const [, weekday, d, mo, y] = m!;
    const time = Date.UTC(Number(y ?? year), Number(mo) - 1, Number(d));
    expect(WEEKDAY[new Date(time).getUTCDay()], `the weekday of ${text}`).toBe(weekday);
    days.push(time);
  }
  days.forEach((time, i) => i > 0 && expect(time, "newest day first").toBeLessThan(days[i - 1]!));

  // no table; each row has a merchant, a category that can be changed and an amount, and is at most two lines tall
  await expect(page.locator("table.tx-table")).toHaveCount(0);
  const rows = page.locator(".tx-item");
  const first = rows.first();
  await expect(first.locator(".tx-main a")).toBeVisible();
  await expect(first.locator("button.select-lite")).toBeVisible();
  await expect(first.locator(".tx-amount")).toContainText("€");
  for (let i = 0; i < 20; i++) expect((await rows.nth(i).boundingBox())!.height, `row ${i} is two lines`).toBeLessThan(80);
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: the filters sit behind Rajaa, which counts them, opens them and applies them; the search stays in view", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const toggle = page.getByRole("button", { name: /^Rajaa/ });
  const search = page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" });
  const category = page.getByLabel("Kategoria", { exact: true });
  const account = page.getByLabel("Tili", { exact: true });
  await expect(search).toBeVisible();
  await expect(toggle).toHaveText("Rajaa");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(category).toBeHidden();
  await expect(account).toBeHidden();
  // the first rows are on the first screen
  await expect(page.locator(".tx-item").first()).toBeInViewport();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(category).toBeVisible();
  await expect(account).toBeVisible();
  await expect(page.getByLabel("Alkaen")).toBeVisible();
  await expect(page.getByLabel("Asti", { exact: true })).toBeVisible();
  await expect(search).toBeVisible();

  // a category narrows the list at once, and the button counts it
  await category.selectOption("groceries");
  const label = (await category.locator("option:checked").innerText()).trim();
  await expect(page).toHaveURL(/#\/transactions\?category=groceries$/);
  await expect(toggle).toHaveText("Rajaa (1)");
  await expect.poll(async () => (await page.locator(".tx-item button.select-lite").allInnerTexts()).filter((t) => t.trim() !== label).length).toBe(0);
  expect(await page.locator(".tx-item").count()).toBeGreaterThan(0);
  await account.selectOption({ index: 1 });
  await expect(toggle).toHaveText("Rajaa (2)");

  // closed, the count stays and the search is still there
  await toggle.click();
  await expect(category).toBeHidden();
  await expect(toggle).toHaveText("Rajaa (2)");
  await expect(search).toBeVisible();

  // Tyhjennä, inside the panel, takes every filter off
  await toggle.click();
  await page.getByRole("button", { name: "Tyhjennä" }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(toggle).toHaveText("Rajaa");
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: a category changed in a row saves, shows its answer on the screen and is kept after a reload", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const rows = page.locator(".tx-item");
  await expect(rows.first()).toBeVisible();

  // a row down the list, categorised by rule and not a transfer, so "käsin" is new after the change
  const row = rows.filter({ hasNot: page.locator(".badge", { hasText: "käsin" }) }).filter({ hasNotText: /Omat siirrot|Kortin lasku|Luotonnostot/ }).nth(12);
  await row.scrollIntoViewIfNeeded();
  const picker = row.locator("button.select-lite");
  const merchant = (await row.locator(".tx-main a").innerText()).trim();
  const before = (await picker.innerText()).trim();
  const target = before === "Lemmikit" ? "Rahapelit" : "Lemmikit";
  await picker.click();
  // only one picker is open at a time, so its select is the only one with this name
  await page.getByLabel(`Kategoria: ${merchant}`, { exact: true }).selectOption({ label: target });

  // the answer is on the screen although the card's top is far above, and it can be closed
  const notice = page.getByRole("status").filter({ hasText: /siirrettiin kategoriaan/ });
  await expect(notice).toBeVisible();
  await expect(notice).toBeInViewport();
  await notice.getByRole("button", { name: "Sulje" }).click();
  await expect(notice).toHaveCount(0);

  const named = (category: string) => page.getByRole("button", { name: `Kategoria: ${merchant}, nyt ${category}` });
  await page.reload();
  await expect(named(target).first()).toBeVisible();
  // the row that was picked is marked "käsin"; the merchant's other rows follow its rule and are not
  await expect(rows.filter({ has: named(target) }).locator(".badge", { hasText: "käsin" }).first()).toBeVisible();

  // put the category back, so no later spec meets the change
  await named(target).first().click();
  await page.getByLabel(`Kategoria: ${merchant}`, { exact: true }).selectOption({ label: before });
  await expect(page.getByRole("status").filter({ hasText: /siirrettiin kategoriaan/ })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("1366 px: the page is still the table with its filters in a row", async ({ browser }) => {
  const context = await signedIn(browser, 1366, 800);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  await expect(page.locator("table.tx-table thead th")).toHaveText(["Päivä", "Kauppias", "Kategoria", "Summa"]);
  await expect(page.locator("table.tx-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".tx-day")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rajaa/ })).toHaveCount(0);
  await expect(page.getByLabel("Kategoria", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Tili", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lataa CSV" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});
