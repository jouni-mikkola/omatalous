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
  await page.goto("/#/transactions");
  const headers = page.locator("table.tx-table tr.rt-group th");
  await expect(headers.first()).toBeVisible();
  // a page of 100 rows has several days, and the strip above does not push the list off the first screen
  expect(await headers.count(), "the days of the page").toBeGreaterThanOrEqual(2);
  await expect(page.locator(DATA_ROW).first(), "the first row is on the first screen").toBeInViewport();
  // the strip above the list: what the rows add up to, and nothing scrolls sideways
  const strip = page.getByRole("region", { name: "Rajattujen tapahtumien summat" });
  await expect(strip.locator("dt")).toHaveText(["Rahaa ulos", "Rahaa sisään", "Erotus"]);
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

test("390 px: no row is taller than 64 px, no short name is cut and the row shows no account digits", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const rows = page.locator(DATA_ROW);
  await expect(rows.first()).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "transactions-390.png") });
  // walk down the list and measure the rows each screen draws
  const tall: string[] = [];
  const cutNames: string[] = [];
  const withDigits: string[] = [];
  let seenRows = 0;
  let reachedEnd = false;
  for (let step = 0; step < 120; step++) {
    const found = await rows.evaluateAll((els) =>
      els.map((row) => {
        const name = row.querySelector<HTMLElement>(".tx-name");
        return { id: row.id, height: row.getBoundingClientRect().height, name: name?.textContent?.trim() ?? "", cut: !!name && name.scrollWidth > name.clientWidth, digits: !!row.querySelector(".tx-acct-short") && getComputedStyle(row.querySelector(".tx-acct-short")!).display !== "none" };
      }),
    );
    for (const r of found) {
      seenRows++;
      if (r.height > 64) tall.push(`${r.name} ${Math.round(r.height)} px`);
      if (r.name.length <= 20 && r.cut) cutNames.push(r.name);
      if (r.digits) withDigits.push(r.name);
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
    await desk.goto("/#/transactions");
    await expect(desk.locator(DATA_ROW).first()).toBeVisible();
    await desk.screenshot({ path: join(process.env.E2E_SHOTS, "transactions-1440.png") });
    await wide.close();
  }
  expect(reachedEnd, "the walk reached the end of the list").toBe(true);
  expect(seenRows, "rows measured").toBeGreaterThan(50);
  expect(tall, "rows over 64 px").toEqual([]);
  expect(cutNames, "names of 20 characters or fewer that are cut").toEqual([]);
  expect(withDigits, "rows that show the account's digits").toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: every row's account is its bank's mark, whole and under nothing, and the opened row names the account with its digits", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
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

test("390 px: a filter chip opens its list as a sheet, narrows the list, names its value and comes off with its x", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const search = page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" });
  await expect(search).toBeVisible();
  await expect(page.locator(DATA_ROW).first()).toBeInViewport();
  // the chips stand on one line that scrolls in its own box
  const chips = page.locator(".tx-fchips");
  expect(await chips.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");

  await page.getByRole("button", { name: "Kategoria", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Kategoria" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("option", { name: "Ruokakauppa" }).click();
  await expect(page).toHaveURL(/#\/transactions\?category=groceries$/);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".tx-fchip.set")).toContainText("Ruokakauppa");
  await expect.poll(async () => (await page.locator(`${DATA_ROW} .tx-category .tx-chip-label`).allInnerTexts()).filter((t) => t.trim() !== "Ruokakauppa").length).toBe(0);
  expect(await page.locator(DATA_ROW).count()).toBeGreaterThan(0);

  // Escape closes a sheet and gives the focus back to its chip
  await page.getByRole("button", { name: "Lisää", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Lisää" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Lisää" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lisää", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "Poista rajaus: Kategoria" }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(page.getByRole("button", { name: "Tyhjennä" })).toHaveCount(0);
  await expect(search).toBeVisible();
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: a category changed in an opened row saves, shows its answer on the screen and is kept after a reload", async ({ browser }) => {
  const context = await signedIn(browser, 390, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
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
  await page.goto("/#/transactions");
  await expect(page.locator("table.tx-table thead th")).toHaveText(["Saaja tai maksaja", "Tili", "Kategoria", "Summa"]);
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  // the day is the group row above its rows, with how many there are
  await expect(page.locator("table.tx-table tr.rt-group th").first()).toHaveText(/^(su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.(\d{4})? *\d+ tapahtuma/);
  await expect(page.locator(".tx-day")).toHaveCount(0);
  // no native select on the page: the filters are chips, a row's category a chip
  await expect(page.locator(".tx-page select")).toHaveCount(0);
  for (const name of ["Aikaväli", "Kategoria", "Lisää"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
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

// The table of Tapahtumat on a screen wider than a phone: the bank's text after the payee's name only when the name does
// not say it, and the account's mark whole in its cell. Where the columns do not fit the rows are blocks, so the heads
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
  test(`${width} px: the bank's text only where it adds to the name, the account whole in its cell, nothing scrolls sideways`, async ({ browser }) => {
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
    await expect(page.locator(DATA_ROW).first()).toBeVisible();
    const block = (await page.locator(".rt-wrap").first().getAttribute("data-block")) !== null;
    if (width >= 1000) expect(block, "a table where there is room").toBe(false);
    if (!block) await expect(page.locator("table.tx-table thead th")).toHaveText(["Saaja tai maksaja", "Tili", "Kategoria", "Summa"]);
    const rowOf = (name: string) => page.locator(DATA_ROW).filter({ has: page.locator(".tx-name", { hasText: new RegExp(`^${name}$`) }) });
    const textOf = (name: string) => rowOf(name).locator(".tx-text");

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

test("1280 px: the strip's three figures stand in equal columns, the histogram beside them", async ({ browser }) => {
  const context = await signedIn(browser, 1280, 844);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const strip = page.getByRole("region", { name: "Rajattujen tapahtumien summat" });
  await expect(strip.locator("dt").first()).toBeVisible();
  const cells = await strip.locator(".tx-totals-kv > div").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  expect(cells.length).toBe(3);
  expect(new Set(cells.map((c) => Math.round(c.width))).size, "equal columns").toBe(1);
  expect(cells[1]!.left, "side by side").toBeGreaterThan(cells[0]!.right - 1);
  expect(cells[2]!.left, "side by side").toBeGreaterThan(cells[1]!.right - 1);
  const hist = (await strip.locator(".tx-hist").boundingBox())!;
  expect(hist.x, "the histogram right of the figures").toBeGreaterThan(cells[2]!.right);
  // the filter bar is one line: the search and the chips share a bottom edge
  const bottoms = await page.locator(".rtb-search, .tx-fchip").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().bottom)));
  expect(Math.max(...bottoms) - Math.min(...bottoms), `bottom edges ${bottoms.join(", ")}`).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
