import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { auditTables, openAll } from "./table-audit.ts";

// Every page that has a table, at the width of a phone and of a desktop, with every chart's table under it
// and every details open: the page does not scroll sideways, no table scrolls inside its frame, every table is shown (a
// table that exists is on the page, not hidden behind a rule) and axe finds nothing in any table.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const ROUTES = [
  "/#/overview",
  "/#/bills",
  "/#/transactions",
  "/#/transactions?view=merchants",
  // Kuukausi, the tab
  "/#/reports",
  // the list of reports: Rahankäyttö, Tilit ja saldot, Velat and Verovuosi (Yhteiset menot needs a shared account)
  "/#/reports?q=menot#vuodet",
  "/#/reports?q=saldot",
  "/#/reports?q=velat",
  "/#/reports?q=tulot#verovuosi",
  // the question pages still behind their addresses
  "/#/reports?q=kiinteat",
  "/#/reports?q=kuukausi",
  "/#/settings/banks",
  "/#/settings/household",
  "/#/settings/members",
  "/#/settings/security",
  "/#/settings/data",
  "/#/settings/server",
  "/#/review",
];

for (const width of [1440, 390]) {
  test(`every table: ${width} px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const problems: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // A hash-only navigation keeps the old document's completed load state. Reload before auditing the new view.
      await page.reload();
      await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
      problems.push(...(await auditTables(page, width)).map((p) => `${route}: ${p}`));
      if (process.env.E2E_SHOTS) {
        const name = route.replace(/^\/#\//, "").replace(/[^a-z0-9]+/g, "-");
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name}-${width}.png`), fullPage: true });
      }
    }
    expect(problems).toEqual([]);
    await context.close();
  });
}

// What the toolbar and the CSV link of a table read is what the table shows: the search finds a row by the first word the row
// says, and the CSV has a word or a figure in each of its lines. A cell made of components (a payee with its tags, an amount) is
// read too. Both exist only for a long list (LONG_LIST_ROWS in table/view.ts): a table of ten rows or fewer has no search box and
// no CSV link, and the link is one for every table, under it, never a button in the bar above.
const LONG_LIST = 10;
const DATA_ROWS = "tbody tr:not(.rt-group):not(.rt-detail):not(.rt-subrow):not(.rt-spacer)";

test("every table: a short one has no search and no CSV, a long one's search finds its row and its CSV is not empty", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, bypassCSP: true, acceptDownloads: true });
  const page = await context.newPage();
  const problems: string[] = [];
  let searched = 0;
  let saved = 0;
  for (const route of ROUTES) {
    await page.goto(route);
    await page.reload();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    await openAll(page);
    const frames = page.locator("main .rt-wrap");
    for (let i = 0; i < (await frames.count()); i++) {
      const frame = frames.nth(i);
      if (!(await frame.isVisible())) continue;
      const name = ((await frame.locator("caption").first().textContent()) ?? "").trim();
      const rows = frame.locator(DATA_ROWS);
      const count = await rows.count();
      const bar = frame.locator("xpath=preceding-sibling::*[1][contains(@class,'rtb')]");
      const link = frame.locator("xpath=following-sibling::*[1][contains(@class,'rt-csv')]");
      const box = bar.getByRole("searchbox");
      // a table the page reads whole (`search={false} csv={false}`) has neither, however long
      if ((await frame.getAttribute("data-plain")) !== null) {
        if ((await box.count()) > 0 || (await link.count()) > 0) problems.push(`${route} ${name}: a plain table has a search box or a CSV link`);
        continue;
      }
      if (count <= LONG_LIST) {
        if ((await box.count()) > 0) problems.push(`${route} ${name}: ${count} rows have a search box`);
        if ((await link.count()) > 0) problems.push(`${route} ${name}: ${count} rows have a CSV link`);
        continue;
      }
      if ((await bar.getByRole("button", { name: "Lataa CSV" }).count()) > 0) problems.push(`${route} ${name}: the CSV is a button in the bar`);
      const first = ((await rows.first().locator("th, td").first().innerText()) ?? "").split(/\s+/).find((w) => /^\p{L}{3,}$/u.test(w));
      if (first && (await box.count()) > 0) {
        searched++;
        await box.fill(first);
        if ((await rows.count()) === 0) problems.push(`${route} ${name}: searching "${first}" finds no row`);
        await box.fill("");
      }
      // a sheet (Verot) saves its tables in one file of its own, with its own button
      if ((await link.count()) === 0 && (await frame.locator("xpath=ancestor::*[@id][1]").getByRole("button", { name: "Lataa CSV" }).count()) > 0) continue;
      if ((await link.count()) === 0) {
        problems.push(`${route} ${name}: ${count} rows have no CSV link`);
        continue;
      }
      saved++;
      const [download] = await Promise.all([page.waitForEvent("download"), link.getByRole("button", { name: "Lataa CSV" }).click()]);
      const lines = (await readFile((await download.path())!, "utf8")).replace(/^\ufeff/, "").trim().split("\r\n").slice(1);
      const empty = lines.filter((l) => /^[;"\s]*$/.test(l.replace(/;/g, ""))).length;
      if (empty > 0) problems.push(`${route} ${name}: ${empty} of ${lines.length} CSV lines have no content`);
    }
  }
  expect(searched, "some long table was searched").toBeGreaterThan(0);
  expect(saved, "some long table was saved").toBeGreaterThan(0);
  expect(problems).toEqual([]);
  await context.close();
});

// A table that folds its months into a list (a desktop only just narrower than the grid) keeps its total's months within
// reach: the total has its own button, and opening it shows the figures.
test("a folded total opens its months, at 1100 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1100, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  await page.goto("/#/reports?q=menot");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("details.card").first()).toBeVisible({ timeout: 15_000 });
  await openAll(page);
  const folded = page.locator('.rt-wrap[data-block]:has(tfoot td.rt-series)');
  const n = await folded.count();
  expect(n, "a table with months folds at this width").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const table = folded.nth(i);
    const button = table.locator("tfoot .rt-fold");
    await expect(button, "the total of a folded table has the button").toHaveCount(await table.locator("tfoot tr").count());
    await button.first().click();
    await expect(table.locator("tfoot tr[data-series-open] td.rt-series").first()).toBeVisible();
  }
  await context.close();
});

// The twelve months of Saldot have one main column: rows at 1440 px, blocks at 390 px, and no two figures of a row
// drawn over each other (a block with two main cells puts both sums on one line).
for (const [width, block] of [[1440, false], [390, true]] as const) {
  test(`the forecast table is ${block ? "blocks" : "rows"}, its figures apart: ${width} px`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await page.goto("/#/reports?q=saldot");
    await page.reload();
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    await openAll(page);
    const frame = page.locator("main .rt-wrap").filter({ has: page.locator("caption", { hasText: "Seuraavat 12 kuukautta" }) });
    await expect(frame).toHaveCount(1);
    expect(await frame.getAttribute("data-block")).toBe(block ? "" : null);
    expect(await frame.locator('[data-rt="main"]').count(), "one main cell in each row").toBe(await frame.locator(DATA_ROWS).count());
    const clash = await frame.locator(DATA_ROWS).evaluateAll((rows) => rows.flatMap((row) => {
      const boxes = Array.from(row.querySelectorAll("th, td")).filter((c) => (c as HTMLElement).innerText.trim()).map((c) => {
        const range = document.createRange();
        range.selectNodeContents(c);
        return { text: (c as HTMLElement).innerText.trim(), box: range.getBoundingClientRect() };
      });
      const out: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.box, b = boxes[j]!.box;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${boxes[i]!.text} / ${boxes[j]!.text}`);
      }
      return out;
    }));
    expect(clash).toEqual([]);
    if (process.env.E2E_SHOTS) await frame.screenshot({ path: join(process.env.E2E_SHOTS, `forecast-${width}.png`) });
    await context.close();
  });
}

// Tapahtumat asks the server for one page of rows (100) and has the page in the address. The server here is the test's own:
// 250 made-up rows, seven a day, so a day lies on both sides of a page's end. The day's row says what all seven add up to.
const MADE_ROWS = 250;
const PAGE_ROWS = 100;
const ROWS_A_DAY = 7;
const TX_ROWS = "table.tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer)";
/** The digits of a figure as the page writes it: "−1 234,56 €" is 123456 cents. */
const digits = (text: string | null): number => Number((text ?? "").replace(/\D/g, ""));

test("Tapahtumat pages by 100: the next link reaches the last row, the page is in the address, a day's sum is all its rows", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, bypassCSP: true, acceptDownloads: true });
  const page = await context.newPage();
  const { today } = await (await page.request.get("/api/meta")).json();
  const real = await (await page.request.get("/api/transactions?limit=1")).json();
  expect(real.items.length, "a row of the demo household to shape the made-up ones on").toBe(1);
  const { partCents: _part, openCents: _open, industry: _industry, ...shape } = real.items[0];
  const dayOf = (i: number) => new Date(Date.parse(`${today}T12:00:00Z`) - Math.floor(i / ROWS_A_DAY) * 86_400_000).toISOString().slice(0, 10);
  const made = Array.from({ length: MADE_ROWS }, (_, i) => ({
    ...shape,
    id: `made-${i}`,
    bookingDate: dayOf(i),
    merchant: `Keksitty kauppa ${i + 1}`,
    counterparty: null,
    description: null,
    amountCents: i % 10 === 3 ? 100_000 + i : -(1_000 + i),
    status: "booked",
    isTransfer: false,
    categorySource: "rule",
  }));
  const sums = new Map<string, { date: string; count: number; inCents: number; outCents: number }>();
  for (const row of made) {
    const sum = sums.get(row.bookingDate) ?? { date: row.bookingDate, count: 0, inCents: 0, outCents: 0 };
    sum.count++;
    if (row.amountCents > 0) sum.inCents += row.amountCents;
    else sum.outCents -= row.amountCents;
    sums.set(row.bookingDate, sum);
  }
  const asked: { limit: number; offset: number }[] = [];
  await page.route("**/api/transactions?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    const limit = Number(q.get("limit") ?? PAGE_ROWS);
    const offset = Number(q.get("offset") ?? 0);
    asked.push({ limit, offset });
    const items = made.slice(offset, offset + limit);
    const onPage = new Set(items.map((t) => t.bookingDate));
    return route.fulfill({ json: { total: made.length, inCents: 0, outCents: 0, netCents: 0, span: null, histogram: null, daySums: [...sums.values()].filter((d) => onPage.has(d.date)), items } });
  });

  /** Each day's row on the page against all the made-up rows of that day, also those on the page before or after. */
  const daysAddUp = async (from: number, to: number) => {
    const days = [...new Set(made.slice(from, to).map((t) => t.bookingDate))];
    const heads = page.locator("table.tx-table tbody tr.rt-group");
    await expect(heads).toHaveCount(days.length);
    for (const [i, day] of days.entries()) {
      const sum = sums.get(day)!;
      const head = heads.nth(i);
      expect(digits(await head.locator(".rt-group-count").textContent()), `${day}: the rows of the day`).toBe(sum.count);
      expect(digits(await head.locator(".rt-sub:not(.rt-sub-in)").textContent()), `${day}: out`).toBe(sum.outCents);
      if (sum.inCents > 0) expect(digits(await head.locator(".rt-sub-in").textContent()), `${day}: in`).toBe(sum.inCents);
    }
  };

  await page.goto("/#/transactions");
  await page.reload();
  const rows = page.locator(TX_ROWS);
  await expect(rows).toHaveCount(PAGE_ROWS);
  await expect(rows.first()).toContainText("Keksitty kauppa 1");
  expect(new URL(page.url()).hash, "the first page has no number").not.toContain("page=");
  await daysAddUp(0, PAGE_ROWS);
  expect(PAGE_ROWS % ROWS_A_DAY, "the first page ends in the middle of a day").not.toBe(0);

  const next = page.locator("main").getByRole("link", { name: "Seuraava", exact: true });
  await next.click();
  await expect(page).toHaveURL(/#\/transactions\?page=2$/);
  await expect(rows.first()).toContainText(`Keksitty kauppa ${PAGE_ROWS + 1}`);
  await expect(rows).toHaveCount(PAGE_ROWS);
  await daysAddUp(PAGE_ROWS, 2 * PAGE_ROWS);

  await next.click();
  await expect(page).toHaveURL(/#\/transactions\?page=3$/);
  await expect(rows.last()).toContainText(`Keksitty kauppa ${MADE_ROWS}`);
  await expect(rows).toHaveCount(MADE_ROWS - 2 * PAGE_ROWS);
  await daysAddUp(2 * PAGE_ROWS, MADE_ROWS);
  await expect(next, "the last page has no next link").toHaveCount(0);

  // the address alone opens the page: a reload of the last one shows the last row again
  await page.reload();
  await expect(rows.last()).toContainText(`Keksitty kauppa ${MADE_ROWS}`);
  expect(asked.every((a) => a.limit === PAGE_ROWS), "every question is for one page").toBe(true);
  expect([...new Set(asked.map((a) => a.offset))].sort((a, b) => a - b)).toEqual([0, PAGE_ROWS, 2 * PAGE_ROWS]);

  // the file of a page is the whole list, and so is the list under the grouping by payee: both ask for every page, by 100
  const csv = page.locator(".rt-wrap:has(.tx-table) ~ .rt-csv").getByRole("button", { name: "Lataa CSV" });
  const savedRows = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), csv.click()]);
    return (await readFile((await download.path())!, "utf8")).split("\r\n").filter((l) => l.includes("Keksitty kauppa")).length;
  };
  expect(await savedRows(), "the file of the last page has every row").toBe(MADE_ROWS);
  asked.length = 0;
  await page.goto("/#/transactions?group=merchant");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("table.tx-table")).toBeVisible();
  await expect(next, "a grouped list has no pages").toHaveCount(0);
  expect(asked.every((a) => a.limit === PAGE_ROWS), "every question is for one page").toBe(true);
  expect([...new Set(asked.map((a) => a.offset))].sort((a, b) => a - b)).toEqual([0, PAGE_ROWS, 2 * PAGE_ROWS]);
  expect(await savedRows(), "the file of the grouped list has every row").toBe(MADE_ROWS);
  await context.close();
});
