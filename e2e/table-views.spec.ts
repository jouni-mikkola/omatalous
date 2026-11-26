import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

// Every table of every page is audited by route-walk.spec.ts, with the toolbar and the CSV link of each. This file holds
// the paging of Tapahtumat.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

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
  const sums = new Map<string, { date: string; inCents: number; outCents: number }>();
  for (const row of made) {
    const sum = sums.get(row.bookingDate) ?? { date: row.bookingDate, inCents: 0, outCents: 0 };
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
      await expect(head.locator(".rt-group-count"), `${day}: no row count`).toHaveCount(0);
      expect(digits(await head.locator(".rt-sub:not(.rt-sub-in)").textContent()), `${day}: out`).toBe(sum.outCents);
      if (sum.inCents > 0) expect(digits(await head.locator(".rt-sub-in").textContent()), `${day}: in`).toBe(sum.inCents);
    }
  };

  await page.goto("/#/transactions?period=all");
  await page.reload();
  const rows = page.locator(TX_ROWS);
  await expect(rows).toHaveCount(PAGE_ROWS);
  await expect(rows.first()).toContainText("Keksitty kauppa 1");
  expect(new URL(page.url()).hash, "the first page has no number").not.toContain("page=");
  await daysAddUp(0, PAGE_ROWS);
  expect(PAGE_ROWS % ROWS_A_DAY, "the first page ends in the middle of a day").not.toBe(0);

  const next = page.locator("main").getByRole("link", { name: "Seuraava", exact: true });
  await next.click();
  await expect(page).toHaveURL(/#\/transactions\?period=all&page=2$/);
  await expect(rows.first()).toContainText(`Keksitty kauppa ${PAGE_ROWS + 1}`);
  await expect(rows).toHaveCount(PAGE_ROWS);
  await daysAddUp(PAGE_ROWS, 2 * PAGE_ROWS);

  await next.click();
  await expect(page).toHaveURL(/#\/transactions\?period=all&page=3$/);
  await expect(rows.last()).toContainText(`Keksitty kauppa ${MADE_ROWS}`);
  await expect(rows).toHaveCount(MADE_ROWS - 2 * PAGE_ROWS);
  await daysAddUp(2 * PAGE_ROWS, MADE_ROWS);
  await expect(next, "the last page has no next link").toHaveCount(0);

  // the address alone opens the page: a reload of the last one shows the last row again
  await page.reload();
  await expect(rows.last()).toContainText(`Keksitty kauppa ${MADE_ROWS}`);
  expect(asked.every((a) => a.limit === PAGE_ROWS), "every question is for one page").toBe(true);
  expect([...new Set(asked.map((a) => a.offset))].sort((a, b) => a - b)).toEqual([0, PAGE_ROWS, 2 * PAGE_ROWS]);

  // the file of a page is the whole list: it asks for every page, by 100
  const csv = page.locator(".rt-wrap:has(.tx-table) ~ .rt-csv").getByRole("button", { name: "Lataa CSV" });
  const savedRows = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), csv.click()]);
    return (await readFile((await download.path())!, "utf8")).split("\r\n").filter((l) => l.includes("Keksitty kauppa")).length;
  };
  expect(await savedRows(), "the file of the last page has every row").toBe(MADE_ROWS);
  await context.close();
});
