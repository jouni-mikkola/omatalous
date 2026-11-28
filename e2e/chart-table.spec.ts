import { expect, request, test } from "@playwright/test";
import { join } from "node:path";
import { cents, plain, unfold, watch } from "./helpers.ts";
import { startServer } from "./server.mjs";

// A chart and its table are one part (ADR 0023): the table is folded under the chart, a click on a mark opens it on that
// mark's row, and the arrow keys move the readout, which a screen reader hears through aria-live.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

// Laskut: the chart's paid and coming parts of the month the table opens on are the two totals that close that month's rows.
// The demo's bills are dated from today, so the check runs on a server whose clock starts on the 15th of the month of the run
// (e2e/clock.mjs): the running month is the open one, with some bills paid and some still to come, whatever day the run is.
test.describe("the bills chart on the 15th", () => {
  const ADMIN = { username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" };
  const FETCH = { "X-Requested-With": "fetch" };
  const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit" }).format(new Date());
  const today = `${month}-15`;
  let app: Awaited<ReturnType<typeof startServer>>;
  let state = "";

  test.beforeAll(async () => {
    app = await startServer({ today });
    const api = await request.newContext({ baseURL: app.base, extraHTTPHeaders: FETCH });
    try {
      for (const [path, data] of [
        ["/api/auth/setup", { code: app.setupCode, ...ADMIN }],
        ["/api/admin/instance/complete", undefined],
        ["/api/demo", undefined],
      ] as const) {
        const answer = await api.post(path, { data });
        if (!answer.ok()) throw new Error(`POST ${path} answered ${answer.status()} ${await answer.text()}`);
      }
      state = join(app.dir, "admin-state.json");
      await api.storageState({ path: state });
    } finally {
      await api.dispose();
    }
  });
  test.afterAll(() => app?.stop());

  test("names the paid and the coming parts of the opened month as its table's two totals", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: app.base, storageState: state, viewport: { width: 1280, height: 900 } });
    await context.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/bills");
    await expect(page.locator(".month-columns .readout-part").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#laskut-taulukko .bill-month-name")).toHaveCount(1);
    const parts = (await page.locator(".month-columns .readout-part").allInnerTexts()).map(plain);
    // a part reads "<kind>, <state> <sum>"
    const ofState = (word: string) => {
      const own = parts.filter((p) => p.includes(`, ${word} `));
      return { count: own.length, cents: own.reduce((total, p) => total + cents(p.slice(p.lastIndexOf(` ${word} `) + word.length + 2)), 0) };
    };
    const total = async (kind: "paid" | "coming") => {
      const cell = page.locator(`#laskut-taulukko td.bill-total-${kind}`);
      return (await cell.count()) === 0 ? 0 : cents(await cell.first().innerText());
    };
    // the chart's parts are whole euros, the table's total has cents: each part of a state may be off by half a euro
    for (const [word, kind] of [["maksettu", "paid"], ["maksamatta", "coming"]] as const) {
      const chart = ofState(word);
      expect(chart.count, `${word} parts of the chart`).toBeGreaterThan(0);
      expect(Math.abs(chart.cents - (await total(kind))), `${word} parts of the chart against the table's total`).toBeLessThanOrEqual(50 * chart.count);
    }
    expect(ofState("maksettu").cents, "the paid side is not empty").toBeGreaterThan(0);
    expect(await page.locator(".month-columns rect.ms-coming").count(), "hatched parts: every month ahead has some").toBeGreaterThan(0);
    await expect(page.locator(".month-columns line.ms-today")).toHaveCount(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
});

test("a slope chart: arrows move between the lines and Enter keeps that category's row", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  await unfold(page, "vuodet");
  const part = page.locator("figure:has(#vuodet-slope-q)");
  const group = part.locator("svg g[tabindex='0']").first();
  test.skip((await group.count()) === 0, "the demo household has no comparable year");
  await group.focus();
  const live = part.locator('.chart > [aria-live="polite"]');
  const first = (await live.innerText()).trim();
  expect(first).not.toBe("");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await live.innerText()).trim()).not.toBe(first);
  await page.keyboard.press("Enter");
  await expect(part.locator("table.rt tbody tr")).toHaveCount(1);
  await expect(part.locator(".rt-filter .chip")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the slope of Ruoka is read like the other charts: focus and the arrows read a line out", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=12m&q=menot");
  await unfold(page, "ruoka");
  const part = page.locator("figure:has(#ruoka-kauppa-q)");
  const marks = part.locator("svg g.slope-mark");
  test.skip((await marks.count()) === 0, "the demo household has no basket to compare");
  await marks.first().focus();
  const live = part.locator('.chart [aria-live="polite"]').first();
  await expect.poll(async () => (await live.innerText()).trim()).toMatch(/\d/);
  expect(seen.problems).toEqual([]);
  await context.close();
});
