import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openCategoryPicker, overflow, watch } from "./helpers.ts";

// Tapahtumat on a phone and on wider screens: rows under day headers, the filter chips, the table's columns. It needs the administrator and the demo
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

const DATA_ROW = "table.tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer)";

test("390 px: rows sit under day groups, newest first, each a block of the merchant, category and amount", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const headers = page.locator("table.tx-table tr.rt-group th");
  await expect(headers.first()).toBeVisible();
  // a page of 100 rows has several days, and the strip above does not push the list off the first screen
  expect(await headers.count(), "the days of the page").toBeGreaterThanOrEqual(2);
  await expect(page.locator(DATA_ROW).first(), "the first row is on the first screen").toBeInViewport();
  // the strip above the list: what the rows add up to, and nothing scrolls sideways
  const strip = page.getByRole("region", { name: "Rajattujen tapahtumien summat" });
  expect((await strip.locator("dt").allInnerTexts()).slice(0, 3)).toEqual(["Menot", "Tulot", "Erotus"]);
  await expect(strip.locator("dd").last()).toBeInViewport();

  // "ma 12.10." (a day of an earlier year has the year too), the weekday is the date's, and the days run backwards
  const year = new Date().getFullYear();
  const days: number[] = [];
  for (const text of (await headers.allTextContents()).slice(0, 12)) {
    const m = /^(su|ma|ti|ke|to|pe|la) (\d{1,2})\.(\d{1,2})\.(\d{4})?\s*\d+ tapahtuma/.exec(text.trim());
    expect(m, `"${text}" is a day group`).not.toBeNull();
    const [, weekday, d, mo, y] = m!;
    const time = Date.UTC(Number(y ?? year), Number(mo) - 1, Number(d));
    expect(WEEKDAY[new Date(time).getUTCDay()], `the weekday of ${text}`).toBe(weekday);
    days.push(time);
  }
  days.forEach((time, i) => i > 0 && expect(time, "newest day first").toBeLessThan(days[i - 1]!));

  // one table at every width: at 390 px each row is a block with a merchant, a category and an amount
  await expect(page.locator(".rt-wrap").first()).toHaveAttribute("data-block", "");
  const rows = page.locator(DATA_ROW);
  // the list comes a page of 100 at a time, not the 700 of the year
  expect(await rows.count(), "more than a screen of rows").toBeGreaterThan(5);
  expect(await rows.count(), "not the whole year").toBeLessThanOrEqual(100);
  expect(await page.getByRole("button").count(), "one button a row, and the page's few").toBeLessThanOrEqual((await rows.count()) + 20);
  const targets = await rows.evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll("button, a[href], input, select, textarea, [tabindex='0']")).map((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height };
  })));
  for (const [i, controls] of targets.entries()) {
    expect(controls, `row ${i}: only the shared open button`).toHaveLength(1);
    expect(controls[0]!.width, `row ${i}: target width`).toBeGreaterThanOrEqual(32);
    expect(controls[0]!.height, `row ${i}: target height`).toBeGreaterThanOrEqual(32);
  }
  const first = rows.first();
  await expect(first.locator(".tx-name")).toBeVisible();
  await expect(first.locator(".tx-category .tx-chip")).toBeVisible();
  await expect(first.locator(".tx-amount")).toContainText("€");
  for (let i = 0; i < Math.min(await rows.count(), 20); i++) expect((await rows.nth(i).boundingBox())!.height, `row ${i} is two or three lines`).toBeLessThan(120);
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: no row is taller than 72 px, no short name is cut and every row names its account by its digits, not by a logo", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const rows = page.locator(DATA_ROW);
  await expect(rows.first()).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "transactions-390.png") });
  // walk down the list and measure the rows each screen draws
  const tall: string[] = [];
  const cutNames: string[] = [];
  const withoutDigits: string[] = [];
  const withLogo: string[] = [];
  let seenRows = 0;
  let reachedEnd = false;
  for (let step = 0; step < 120; step++) {
    const found = await rows.evaluateAll((els) =>
      els.map((row) => {
        const name = row.querySelector<HTMLElement>(".tx-name");
        return { id: row.id, height: row.getBoundingClientRect().height, name: name?.textContent?.trim() ?? "", cut: !!name && name.scrollWidth > name.clientWidth, digits: !!row.querySelector(".tx-acct-short") && getComputedStyle(row.querySelector(".tx-acct-short")!).display !== "none", logo: (row.querySelector(".tx-account .acc-mark")?.getClientRects().length ?? 0) > 0 };
      }),
    );
    for (const r of found) {
      seenRows++;
      // the chevron's 44 px stands inside the row, over its second line of 24 px, with 4 px above and below
      if (r.height > 72) tall.push(`${r.name} ${Math.round(r.height)} px`);
      if (r.name.length <= 20 && r.cut) cutNames.push(r.name);
      if (!r.digits) withoutDigits.push(r.name);
      if (r.logo) withLogo.push(r.name);
    }
    const atEnd = await page.evaluate(() => {
      window.scrollBy(0, 600);
      return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    });
    if (atEnd) {
      reachedEnd = true;
      break;
    }
    await page.waitForTimeout(50);
  }
  if (process.env.E2E_SHOTS) {
    const wide = await signedIn(browser, 1440, 900);
    const desk = await wide.newPage();
    await desk.goto("/#/transactions?period=all");
    await expect(desk.locator(DATA_ROW).first()).toBeVisible();
    await desk.screenshot({ path: join(process.env.E2E_SHOTS, "transactions-1440.png") });
    await wide.close();
  }
  expect(reachedEnd, "the walk reached the end of the list").toBe(true);
  expect(seenRows, "rows measured").toBeGreaterThan(50);
  expect(tall, "rows over 72 px").toEqual([]);
  expect(cutNames, "names of 20 characters or fewer that are cut").toEqual([]);
  expect(withoutDigits, "rows that do not show the account's digits").toEqual([]);
  expect(withLogo, "rows that show a bank's logo").toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: every row's account is its digits, whole and under nothing, and the opened row names the account with its digits", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const rows = page.locator(DATA_ROW);
  await expect(rows.first()).toBeVisible();
  const n = Math.min(await rows.count(), 40);
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    // the middle of the screen, clear of the sticky head and the tab bar
    await row.evaluate((e) => e.scrollIntoView({ block: "center" }));
    const mark = (await row.locator("td.tx-account .tx-acct").boundingBox())!;
    expect(mark.x + mark.width, `row ${i}: the account's mark is inside the screen`).toBeLessThanOrEqual(390);
    // the topmost element at the middle of the mark is the mark itself, not something over it
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".tx-acct")?.outerHTML ?? document.elementFromPoint(x!, y!)?.outerHTML.slice(0, 120), [mark.x + mark.width / 2, mark.y + mark.height / 2]);
    expect(top, `row ${i}: nothing covers the account's mark`).toMatch(/^<span class="tx-acct"/);
  }
  // the digits are in the opened row
  const first = rows.first();
  const merchant = (await first.locator(".tx-name").innerText()).trim();
  await first.getByRole("button", { name: `Avaa ${merchant}: 12 kuukautta` }).click();
  await expect(page.locator(".tx-detail-facts").first()).toContainText(/Tili.*•• \d{4}/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: Suodata opens its list as a sheet, narrows the list, names the limit in a chip and the chip comes off with its x", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const search = page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" });
  await expect(search).toBeVisible();
  await expect(page.locator(DATA_ROW).first()).toBeInViewport();
  // the period and the search come first, the rows follow high on the screen
  expect((await page.locator(DATA_ROW).first().boundingBox())!.y, "the first row's top").toBeLessThan(560);

  await page.getByRole("button", { name: "Suodata", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Suodata" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Kategoria/ }).click();
  await sheet.getByRole("option", { name: "Ruokakauppa" }).click();
  await expect(page).toHaveURL(/#\/transactions\?category=groceries&period=all$/);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".tx-fchip.set")).toContainText("Ruokakauppa");
  await expect.poll(async () => (await page.locator(`${DATA_ROW} .tx-category .tx-chip-label`).allInnerTexts()).filter((t) => t.trim() !== "Ruokakauppa").length).toBe(0);
  expect(await page.locator(DATA_ROW).count()).toBeGreaterThan(0);

  // Escape closes a sheet and gives the focus back to its chip
  await page.getByRole("button", { name: "Suodata", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Suodata" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Suodata" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suodata", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "Poista rajaus: Kategoria" }).click();
  await expect(page).toHaveURL(/#\/transactions\?period=all$/);
  await expect(page.getByRole("button", { name: "Tyhjennä rajaukset" })).toHaveCount(0);
  await expect(search).toBeVisible();
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: a category changed in an opened row saves, shows its answer on the screen and is kept after a reload", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const rows = page.locator(DATA_ROW);
  await expect(rows.first()).toBeVisible();

  // a row down the list, categorised by rule and not a transfer, so "käsin" is new after the change
  const row = rows.filter({ hasNot: page.locator(".tx-chip-manual") }).filter({ hasNotText: /Omat siirrot|Luottokortin lasku|Luotonnostot/ }).nth(3);
  await row.scrollIntoViewIfNeeded();
  const merchant = (await row.locator(".tx-name").innerText()).trim();
  const before = (await row.locator(".tx-category .tx-chip-label").innerText()).trim();
  const target = before === "Lemmikit" ? "Rahapelit" : "Lemmikit";
  // the row opens, and its category is changed there
  await row.getByRole("button", { name: `Avaa ${merchant}: 12 kuukautta` }).click();
  await openCategoryPicker(page, merchant, before);
  const picker = page.getByRole("dialog", { name: `Kategoria: ${merchant}` });
  await expect(picker).toContainText("Muutos koskee myös kauppiaan muita ja tulevia tapahtumia.");
  await picker.getByRole("option", { name: target }).click();

  // the answer is on the screen although the card's top is far above, and it can be closed
  const notice = page.getByRole("status").filter({ hasText: /Siirsimme .* kategoriaan/ });
  await expect(notice).toBeVisible();
  await expect(notice).toBeInViewport();
  await notice.getByRole("button", { name: "Sulje" }).click();
  await expect(notice).toHaveCount(0);

  await page.reload();
  const picked = rows.filter({ hasText: merchant }).filter({ has: page.locator(".tx-chip-manual") });
  await expect(picked.first()).toBeAttached();
  await expect(picked.first().locator(".tx-category .tx-chip-label")).toHaveText(target);

  // put the category back, so no later spec meets the change
  await picked.first().getByRole("button", { name: `Avaa ${merchant}: 12 kuukautta` }).click();
  await openCategoryPicker(page, merchant, target);
  await page.getByRole("dialog", { name: `Kategoria: ${merchant}` }).getByRole("option", { name: before, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Siirsimme .* kategoriaan/ })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("1366 px: the page is the table under the filter chips, the download in the head's menu", async ({ browser }) => {
  const context = await signedIn(browser, 1366, 800);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  await expect(page.locator("table.tx-table thead th")).toHaveText(["Saaja tai maksaja", "Tili", "Kategoria", "Summa"]);
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  // the day is the group row above its rows, with how many there are
  await expect(page.locator("table.tx-table tr.rt-group th").first()).toHaveText(/^(su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.(\d{4})? *\d+ tapahtuma/);
  await expect(page.locator(".tx-day")).toHaveCount(0);
  // no native select on the page: the filters are chips, a row's category a chip
  await expect(page.locator(".tx-page select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Aikaväli/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Suodata", exact: true })).toBeVisible();
  // the toolbar holds the search and the chips of the rows, the download is a link under the list; the category, the rule checkbox and the other actions are in the menu of an opened row
  await expect(page.locator(".rt-csv").getByRole("button", { name: "Lataa CSV" })).toBeVisible();
  const first = page.locator(DATA_ROW).filter({ has: page.locator(".tx-category") }).first();
  const merchant = (await first.locator(".tx-name").innerText()).trim();
  await first.getByRole("button", { name: `Avaa ${merchant}: 12 kuukautta` }).click();
  await page.getByRole("button", { name: `Muuta: ${merchant}` }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Sama kategoria kauppiaan muille tapahtumille" })).toBeChecked();
  await expect(page.getByRole("menuitem", { name: `Kategoria: ${merchant}, nyt` })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: `Kaikki: ${merchant}` })).toHaveAttribute("href", /merchant=/);
  await page.keyboard.press("Escape");
  expect(seen.problems).toEqual([]);
  await context.close();
});

// The table of Tapahtumat on a screen wider than a phone: no bank text on a closed row (the opened row has it), and the
// account's mark whole in its cell. Where the columns do not fit the rows are blocks, so the heads
// are checked only while it is a table.
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
  test(`${width} px: the bank's text only in the opened row, the account whole in its cell, nothing scrolls sideways`, async ({ browser }) => {
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
    await page.goto("/#/transactions?period=all");
    await expect(page.locator(DATA_ROW).first()).toBeVisible();
    const block = (await page.locator(".rt-wrap").first().getAttribute("data-block")) !== null;
    if (width >= 1000) expect(block, "a table where there is room").toBe(false);
    if (!block) await expect(page.locator("table.tx-table thead th")).toHaveText(["Saaja tai maksaja", "Tili", "Kategoria", "Summa"]);
    const rowOf = (name: string) => page.locator(DATA_ROW).filter({ has: page.locator(".tx-name", { hasText: new RegExp(`^${name}$`) }) });

    // a closed row holds the payee and the amount: what the bank wrote is not on it
    await expect(page.locator(`${DATA_ROW} .tx-text`)).toHaveCount(0);
    await expect(page.locator(DATA_ROW).filter({ hasText: "Lasku 1234" })).toHaveCount(0);
    const vaasa = rowOf("Esimerkki Vaasa Oy");
    await vaasa.getByRole("button", { name: "Avaa Esimerkki Vaasa Oy: 12 kuukautta" }).click();
    await expect(page.locator(".tx-detail-facts").first()).toContainText("Lasku 1234");
    await expect(page.locator(".tx-detail-facts").first()).toContainText("ESIMERKKI VAASA OY");
    await vaasa.getByRole("button", { name: "Avaa Esimerkki Vaasa Oy: 12 kuukautta" }).click();

    // the account is its mark and a short text that is never cut; its whole name is the title
    const names = (await (await page.request.get("/api/meta")).json()).accounts.map((a: { name: string }) => a.name);
    for (const name of ROWS.map((r) => r.merchant)) {
      const mark = rowOf(name).locator("td.tx-account .tx-acct");
      await expect(mark).toBeVisible();
      expect(names, `the account of ${name}`).toContain(await mark.getAttribute("title"));
      const short = mark.locator(".tx-acct-short");
      expect(await short.evaluate((el) => el.scrollWidth <= el.clientWidth), `the short text of ${name} is whole`).toBe(true);
    }

    expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
    expect(await page.locator(".rt-wrap").first().evaluate((el) => el.scrollWidth - el.clientWidth), "the table scrolls inside its card").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("1280 px: the bar is one line, the sums stand on one line and the histogram under them", async ({ browser }) => {
  const context = await signedIn(browser, 1280, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const strip = page.getByRole("region", { name: "Rajattujen tapahtumien summat" });
  await expect(strip.locator("dt").first()).toBeVisible();
  const cells = await strip.locator(".tx-totals-kv > div").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  // Menot, Tulot and Erotus, and what the rows move to or from savings: the demo data moves money to savings
  expect(cells.length).toBe(4);
  await expect(strip.locator("dt").nth(3)).toHaveText(/^(Säästöön siirretty|Otettu säästöistä)$/);
  const tops = cells.map((c) => Math.round(c.top));
  expect(Math.max(...tops) - Math.min(...tops), "the sums share a line").toBeLessThanOrEqual(1);
  expect(cells[1]!.left, "side by side").toBeGreaterThan(cells[0]!.right - 1);
  expect(cells[2]!.left, "side by side").toBeGreaterThan(cells[1]!.right - 1);
  const hist = (await strip.locator(".tx-hist").boundingBox())!;
  expect(hist.y, "the histogram under the sums").toBeGreaterThan(cells.at(-1)!.bottom - 1);
  // the bar is one line: the search, the period and Suodata share a bottom edge
  const bottoms = await page.locator(".tx-search, .tx-period, .tx-filter-btn").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().bottom)));
  expect(Math.max(...bottoms) - Math.min(...bottoms), `bottom edges ${bottoms.join(", ")}`).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: a tap on a row opens it, a second tap closes it, and the chevron opens it once", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const first = page.locator(DATA_ROW).first();
  await expect(first).toBeVisible();
  await expect(page.locator(".tx-detail-facts")).toHaveCount(0);
  await first.locator(".tx-name").tap();
  await expect(page.locator(".tx-detail-facts").first()).toBeVisible();
  await first.locator(".tx-name").tap();
  await expect(page.locator(".tx-detail-facts")).toHaveCount(0);
  await first.getByRole("button", { name: /: 12 kuukautta$/ }).tap();
  await expect(page.locator(".tx-detail-facts").first()).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("1280 px: a search being typed takes one place in the history, however many pauses it has", async ({ browser }) => {
  const context = await signedIn(browser, 1280, 900);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  const search = page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" });
  await expect(search).toBeVisible();
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  const before = await page.evaluate(() => history.length);
  const asked = () => new URLSearchParams(page.url().split("?")[1] ?? "").get("q");
  await search.pressSequentially("ka");
  await expect.poll(asked).toBe("ka");
  await expect.poll(() => page.evaluate(() => history.length)).toBe(before + 1);
  // a pause later the rest of the word replaces that place
  await search.pressSequentially("hvi");
  await expect.poll(asked).toBe("kahvi");
  await search.pressSequentially("la");
  await expect.poll(asked).toBe("kahvila");
  expect(await page.evaluate(() => history.length), "history entries added by the whole search").toBe(before + 1);
  // back leaves the search in one step, not one for each pause
  await page.goBack();
  await expect(page).toHaveURL(/#\/transactions\?period=all$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// a day with Menot, Tulot and a savings sum has three; every day with more than one stands on a second line, the rule the longest of them needs
test("390 px: a day with more than one sum puts them on a second line under the day and nothing scrolls sideways", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions?period=all");
  await expect(page.locator("table.tx-table tr.rt-group th").first()).toBeVisible();
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("table.tx-table tr.rt-group")]
        .filter((row) => row.querySelectorAll(".rt-sub").length >= 2)
        .map((row) => {
          const day = row.querySelector("th")!.getBoundingClientRect();
          const sums = row.querySelector("td")!.getBoundingClientRect();
          return { day: row.querySelector("th")!.textContent, under: sums.top >= day.bottom - 1, inside: sums.right <= document.documentElement.clientWidth + 1 };
        }),
    );
  const severalSums = await read();
  expect(severalSums.length, "days with more than one sum").toBeGreaterThan(0);
  for (const row of severalSums) expect(row, row.day ?? "").toMatchObject({ under: true, inside: true });
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  // a text twice the size wraps the sums, and the page is no wider
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  for (const row of await read()) expect(row.inside, row.day ?? "").toBe(true);
  expect(await overflow(page), "sideways scroll at 200 %").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
