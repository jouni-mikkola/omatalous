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
  // the count and the two sums wrap under the (hidden) heading as labelled figures, and nothing scrolls sideways
  const facts = page.locator(".tx-card dl.kv");
  await expect(facts.locator("dt")).toHaveText(["Tapahtumia", "Maksettu yhteensä", "Saatu yhteensä"]);
  await expect(facts.locator("dd").last()).toBeInViewport();

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
  await expect(page.locator("table.tx-table thead th")).toHaveText(["Päivä", "Saaja/maksaja", "Tili", "Kategoria", "Summa"]);
  await expect(page.locator("table.tx-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".tx-day")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rajaa/ })).toHaveCount(0);
  await expect(page.getByLabel("Kategoria", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Tili", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lataa CSV" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

// The table of Tapahtumat on a screen wider than a phone: the bank's text under the payee's name only when the name does
// not say it, and the account in a column of its own, or under the name where five columns do not fit.
const LONG = "Kuukausimaksu kuvauksen kanssa, joka on aika pitkä ja jatkuu vielä pidemmälle kuin mikään sarake jaksaa näyttää, viite 1234 5678 9012";
const ROWS = [
  // the bank's payee is the name in capitals and without its umlauts: nothing to add
  { merchant: "Esimerkki Käpylä Oy", counterparty: "ESIMERKKI KAPYLA OY", description: null },
  // the same payee with a message: the message alone
  { merchant: "Esimerkki Vaasa Oy", counterparty: "ESIMERKKI VAASA OY", description: "Lasku 1234" },
  // a near miss: the legal form differs, so the bank's text says something
  { merchant: "Esimerkki Tele Oy", counterparty: "ESIMERKKI TELE OYJ", description: null },
  { merchant: "Esimerkki Tyhjä Oy", counterparty: null, description: null },
  { merchant: "Esimerkki Pitkä Oy", counterparty: "ESIMERKKI PITKA OY", description: LONG },
];

for (const width of [1366, 1000, 700, 601]) {
  test(`${width} px: the bank's text only where it adds to the name, the account in a column or under the name, nothing scrolls sideways`, async ({ browser }) => {
    const context = await signedIn(browser, width, 900);
    const page = await context.newPage();
    const seen = watch(page);
    await page.route(/\/api\/transactions\?/, async (route) => {
      const response = await route.fetch().catch(() => null);
      const json = await response?.json().catch(() => null);
      if (!response || !json) return;
      ROWS.forEach((row, i) => Object.assign(json.items[i], row));
      // a joint account's row tells the viewer's part under its amount, which is the widest the amount column gets
      json.items[1].partCents = -123_456;
      await route.fulfill({ response, json });
    });
    await page.goto("/#/transactions");
    const wide = width > 960;
    const heads = page.locator("table.tx-table thead th:visible");
    await expect(heads).toHaveText(wide ? ["Päivä", "Saaja/maksaja", "Tili", "Kategoria", "Summa"] : ["Päivä", "Saaja/maksaja", "Kategoria", "Summa"]);
    const rowOf = (name: string) => page.locator("table.tx-table tbody tr").filter({ has: page.getByRole("link", { name, exact: true }) });
    const textOf = (name: string) => rowOf(name).locator("td").nth(1).locator(".tx-text");

    await expect(textOf("Esimerkki Käpylä Oy")).toHaveCount(0);
    await expect(textOf("Esimerkki Tyhjä Oy")).toHaveCount(0);
    await expect(textOf("Esimerkki Vaasa Oy")).toHaveText("Lasku 1234");
    await expect(textOf("Esimerkki Vaasa Oy")).toHaveAttribute("title", "Lasku 1234");
    await expect(textOf("Esimerkki Tele Oy")).toHaveText("ESIMERKKI TELE OYJ");
    await expect(textOf("Esimerkki Tele Oy")).toHaveAttribute("title", "ESIMERKKI TELE OYJ");

    // a long text is one line cut with an ellipsis, and its title holds all of it
    const long = textOf("Esimerkki Pitkä Oy");
    await expect(long).toHaveAttribute("title", LONG);
    const box = await long.evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height }));
    expect(box.cut, "the long text is cut").toBe(true);
    expect(box.height, "on one line").toBeLessThan(20);

    // the account is named by the filter above the list; it stands in a cell of its own, or under the name when there is no room
    const names = await page.getByLabel("Tili", { exact: true }).locator("option").allInnerTexts();
    for (const name of ROWS.map((r) => r.merchant)) {
      const row = rowOf(name);
      if (wide) {
        const account = (await row.locator("td.tx-account").innerText()).trim();
        expect(names, `the account of ${name}`).toContain(account);
        await expect(row.locator("td").nth(1).locator(".tx-account-under")).toBeHidden();
      } else {
        await expect(row.locator("td.tx-account")).toBeHidden();
        const account = (await row.locator("td").nth(1).locator(".tx-account-under").innerText()).trim();
        expect(names, `the account of ${name}`).toContain(account);
      }
    }
    if (!wide) {
      // under the bank's text, not beside it
      const text = (await textOf("Esimerkki Vaasa Oy").boundingBox())!;
      const account = (await rowOf("Esimerkki Vaasa Oy").locator(".tx-account-under").boundingBox())!;
      expect(account.y, "the account is below the text").toBeGreaterThanOrEqual(text.y + text.height - 1);
    }

    expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
    expect(await page.locator(".table-wrap").evaluate((el) => el.scrollWidth - el.clientWidth), "the table scrolls inside its card").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
