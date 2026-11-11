import { MAX_LIST_ROWS } from "../packages/core/src/list-limits.ts";
import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Tapahtumat with a year of rows: the list is drawn a page (100 rows) at a time, so it opens at once, has a button a row and
// few others, and keeps its filter over a reload. It needs the administrator and the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

/** The slowdown of the processor the page is drawn under, and the time it has to show its first rows. */
const CPU_SLOWDOWN = 4;
const FIRST_ROWS_MS = 1000;
/** The rows of a page of the list (PAGE_ROWS in TransactionRows.tsx): each has the one button that opens it. */
const PAGE_ROWS = 100;
const MAX_BUTTONS = PAGE_ROWS + 10;
const DATA_ROW = "table.tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer)";

async function signedIn(browser: Browser, width: number, height: number): Promise<BrowserContext> {
  expect(existsSync(STATE), "run.mjs makes the signed-in state").toBe(true);
  return browser.newContext({ storageState: STATE, viewport: { width, height } });
}

const yearBack = (today: string) => `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`${width} px: twelve months of rows show in under a second at ${CPU_SLOWDOWN}x slower processor, with ${MAX_BUTTONS} buttons at most`, async ({ browser }) => {
    const context = await signedIn(browser, width, height);
    const page = await context.newPage();
    const seen = watch(page);
    const { today } = await (await page.request.get("/api/meta")).json();
    const year = `from=${yearBack(today)}&to=${today}`;
    // the page's code, the route's chunk and the server's answer are fetched once before, so the time is the page's own: the answer's
    // parsing and the drawing of the rows under the slower processor
    const answer = await (await page.request.get(`/api/transactions?${year}&limit=${MAX_LIST_ROWS}`)).json();
    await page.goto("/#/transactions");
    await expect(page.locator(DATA_ROW).first()).toBeVisible();
    const cdp = await context.newCDPSession(page);
    // other workers share the machine's cores and can slow one try for reasons that are not the page's: a slowdown of the
    // page itself shows in every try, so the best of three is the time the rows need
    const tries: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto("/#/overview");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
      const started = Date.now();
      await page.goto(`/#/transactions?${year}`);
      await expect(page.locator(DATA_ROW).first()).toBeVisible();
      tries.push(Date.now() - started);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      if (tries[attempt]! < FIRST_ROWS_MS) break;
    }
    const took = Math.min(...tries);
    expect(answer.total, "a year of example rows").toBeGreaterThan(300);
    expect(took, `rows after ${took} ms`).toBeLessThan(FIRST_ROWS_MS);
    expect(await page.locator(DATA_ROW).count(), "one page of rows is drawn").toBe(PAGE_ROWS);
    expect(await page.getByRole("button").count(), "buttons on the page").toBeLessThanOrEqual(MAX_BUTTONS);

    // the next link, page after page, reaches the oldest day
    const oldest = answer.items[answer.items.length - 1].merchant as string;
    const next = page.locator("main").getByRole("link", { name: "Seuraava", exact: true });
    for (let n = 2; n <= Math.ceil(answer.total / PAGE_ROWS); n++) {
      await next.click();
      await expect(page).toHaveURL(new RegExp(`[?&]page=${n}$`));
      await expect(page.locator(".loading")).toHaveCount(0);
    }
    await expect(next, "the last page has no next link").toHaveCount(0);
    await expect(page.locator(".tx-name", { hasText: oldest }).last()).toBeVisible();
    expect(await page.locator(DATA_ROW).count(), "the last page has the rest of the rows").toBe(answer.total - (Math.ceil(answer.total / PAGE_ROWS) - 1) * PAGE_ROWS);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("a filter and the toolbar's search stay in the address and come back after a reload", async ({ browser }) => {
  const context = await signedIn(browser, 1440, 900);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  await page.getByRole("button", { name: "Kategoria", exact: true }).click();
  await page.getByRole("option", { name: "Ruokakauppa" }).click();
  await expect(page).toHaveURL(/category=groceries/);
  await page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" }).fill("k-");
  await expect(page).toHaveURL(/q=k-/);
  const shown = async () => (await page.locator(`${DATA_ROW} .tx-category .tx-chip-label`).allInnerTexts()).map((t) => t.trim());
  await expect(page.locator(".tx-fchip.set")).toContainText("Ruokakauppa");
  const before = await shown();
  expect(before.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  await expect(page).toHaveURL(/category=groceries/);
  await expect(page.locator(".tx-fchip.set")).toContainText("Ruokakauppa");
  await expect(page.getByRole("searchbox", { name: "Hae kauppiasta tai viestiä" })).toHaveValue("k-");
  expect(await shown()).toEqual(before);
  expect(seen.problems).toEqual([]);
  await context.close();
});
