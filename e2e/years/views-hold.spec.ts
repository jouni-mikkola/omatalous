import { type BrowserContext, expect, type Page, request, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { overflow, watch } from "../helpers.ts";
import { root, startServer } from "../server.mjs";

// Design, section 4 (V8): every view holds up on a made-up household of five years (100 000 rows or more,
// apps/server/scripts/history-gen.ts) with a payee of 60 characters, on a phone 390 px wide. No view scrolls sideways,
// no sum is cut, the first answer of each view is there in under a second, and a failed fetch stays as an item of
// Tarkistettavat. The server is this file's own, as in transactions-years.spec.ts: a heavy local check (`pnpm e2e:years`).
const ADMIN = { username: "pito-admin", displayName: "Pito Admin", password: "pito-salasana-123456" };
const FETCH = { "X-Requested-With": "fetch" };
const WIDTH = 390;
const FIRST_ANSWER_MS = 1000;
const MIN_ROWS = 100_000;
// 60 characters, no place to break in the first half
const LONG = "Pitkänimisenkauppiaanerikoistavarakauppa Hämeenlinna Oy 0001";
const LONG_CENTS = -123_456_78;
const VIEWS = ["overview", "transactions", "bills", "reports", "reports?q=kuukausi", "reports?q=menot", "reports?q=tulot", "reports?q=saldot", "reports?q=kiinteat", "reports?q=velat", "review"];
// where a sum is typeset: the figure of an answer, a number cell of a table, a row's sum
const SUMS = ".fig, .num, .st-num, .review-row-sum, .review-figure, [class*='sum'], [class*='amount']";

let app: Awaited<ReturnType<typeof startServer>>;
let state = "";
const test = base.extend({ baseURL: async ({}, use) => use(app?.base) });
test.beforeAll(async () => {
  app = await startServer();
  const api = await request.newContext({ baseURL: app.base, extraHTTPHeaders: FETCH });
  const post = async (path: string, data?: object) => {
    const answer = await api.post(path, { data });
    if (!answer.ok()) throw new Error(`POST ${path} answered ${answer.status()} ${await answer.text()}`);
  };
  await post("/api/auth/setup", { code: app.setupCode, ...ADMIN });
  await post("/api/admin/instance/complete");
  state = join(app.dir, "admin-state.json");
  await api.storageState({ path: state });
  const seed = spawnSync("pnpm", ["--filter", "@banking/server", "seed:years"], { cwd: root, env: { ...process.env, DATA_DIR: join(app.dir, "data") }, encoding: "utf8", timeout: 240_000, killSignal: "SIGKILL" });
  if (seed.status !== 0) throw new Error(`seed:years failed: ${seed.stderr || seed.stdout}`);
  // the long payee comes as a bank's file brings it, to an account of its own (a fetched account takes no file rows): three purchases, the newest today
  const { today } = (await (await api.get("/api/meta")).json()) as { today: string };
  const day = (back: number) => new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
  await post("/api/bank-file", { accountId: null, name: "Tiedostotili", last4: null, rows: [0, 1, 35].map((back) => ({ day: day(back), cents: LONG_CENTS - back, text: LONG })) });
  await api.dispose();
});
test.afterAll(() => app?.stop());
test.setTimeout(10 * 60_000);

const phone = async (browser: import("@playwright/test").Browser): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ storageState: state, viewport: { width: WIDTH, height: 844 }, isMobile: true, hasTouch: true });
  return { context, page: await context.newPage() };
};

/** The view has answered: its page is drawn, nothing in it still loads, and it holds text of its own. */
async function answered(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector("main");
    if (!main || main.querySelector('[aria-busy="true"]') || /Ladataan…/.test(main.textContent ?? "")) return false;
    return main.querySelector("h1, h2, h3, table, li, .fig") !== null && (main.textContent ?? "").trim().length > 20;
  });
}

/** The sums on the page that are not whole: wider than their box, outside the screen, or under the edge of a box that clips. */
const cutSums = (page: Page): Promise<string[]> =>
  page.evaluate(
    ({ sums, width }) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(sums)) {
        const text = (el.textContent ?? "").trim();
        const r = el.getBoundingClientRect();
        if (!/\d/.test(text) || r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
        if (el.closest(".sr-only, [hidden], [aria-hidden='true'], details:not([open]) > :not(summary)")) continue;
        const say = (why: string) => out.push(`${why}: "${text.slice(0, 40)}" (${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]})`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") say("wider than its box");
        else if (r.left < -0.5 || r.right > width + 0.5) say("outside the screen");
        else
          for (let box = el.parentElement; box && box !== document.documentElement; box = box.parentElement) {
            if (getComputedStyle(box).overflowX === "visible") continue;
            const b = box.getBoundingClientRect();
            if (r.left < b.left - 0.5 || r.right > b.right + 0.5) {
              say(`under the edge of ${box.tagName.toLowerCase()}.${String(box.className).split(" ")[0]}`);
              break;
            }
          }
      }
      return out;
    },
    { sums: SUMS, width: WIDTH },
  );

test(`five years and a 60-character payee at ${WIDTH} px: no view scrolls sideways or cuts a sum, and each answers in under a second`, async ({ browser }) => {
  expect(LONG).toHaveLength(60);
  const { context, page } = await phone(browser);
  const seen = watch(page);
  const total = (await (await page.request.get("/api/transactions?limit=1")).json()).total as number;
  expect(total, "rows in the history").toBeGreaterThanOrEqual(MIN_ROWS);

  // the code and each route's chunk are fetched once before, as transactions-perf.spec.ts does. Each timed visit then starts
  // from an empty document, so the page keeps no answer from before and the view asks the server for its figures again
  for (const view of VIEWS) {
    await page.goto(`/#/${view}`);
    await answered(page);
  }
  const took: Record<string, number> = {};
  for (const view of VIEWS) {
    await page.goto("about:blank");
    const started = Date.now();
    await page.goto(`/#/${view}`);
    await answered(page);
    took[view] = Date.now() - started;
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), `${view} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(await cutSums(page), `${view} cuts a sum`).toEqual([]);
  }
  console.log(`views-hold: ${total} rows, first answers in ms ${JSON.stringify(took)}`);
  test.info().annotations.push({ type: "measured", description: JSON.stringify(took) });
  for (const [view, ms] of Object.entries(took)) expect(ms, `${view} answered after ${ms} ms`).toBeLessThan(FIRST_ANSWER_MS);

  // the long payee is in the rows list, newest first, cut to its line (so asked for by its start), and its sum is whole beside it
  await page.goto("/#/transactions");
  const row = page.locator("main").getByText(LONG.slice(0, 20)).filter({ visible: true }).first();
  await expect(row).toBeVisible();
  const sum = page.locator("main").getByText(/123[\s  ]?456,78/).first();
  await expect(sum).toBeVisible();
  const box = (await sum.boundingBox())!;
  expect(box.x, "the sum starts on the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the sum ends on the screen").toBeLessThanOrEqual(WIDTH);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await cutSums(page)).toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test(`a failed fetch stays as an item of Tarkistettavat at ${WIDTH} px, over a reload and over Ohita`, async ({ browser }) => {
  const { context, page } = await phone(browser);
  // the household has no bank to fail: the server's answer about its last fetch is changed on the way, as open-sync.spec.ts
  // does for its route. Everything else of the answer is the server's own.
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await page.route("**/api/meta", async (route) => {
    const answer = await route.fetch();
    const meta = await answer.json();
    await route.fulfill({ response: answer, json: { ...meta, lastSync: { id: 4242, trigger: "open", startedAt: at, finishedAt: at, status: "failed", fetched: 0, inserted: 0, message: "Pankki ei vastannut." } } });
  });
  const item = page.locator("section.review-item");
  for (const round of ["first", "after a reload"]) {
    if (round === "first") await page.goto("/#/review");
    else await page.reload();
    await expect(item, round).toBeVisible({ timeout: 20_000 });
    await expect(item.locator(".review-q"), round).toContainText("Emme saaneet tapahtumia pankista.");
    await expect(item.locator(".review-line"), round).toContainText("Pankki ei vastannut.");
    await expect(item.getByRole("link", { name: "Hae nyt" }), round).toBeVisible();
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await cutSums(page)).toEqual([]);
  // passed with Ohita it is still of the queue: the next sitting starts with it
  await item.getByRole("button", { name: /Ohita/ }).click();
  await expect(item.locator(".review-q")).not.toContainText("Emme saaneet tapahtumia pankista.");
  await page.reload();
  await expect(item.locator(".review-q")).toContainText("Emme saaneet tapahtumia pankista.", { timeout: 20_000 });
  await context.close();
});

test("a fetch that went through leaves no such item", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/#/review");
  await expect(page.locator("section.review-item, .review-end").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).not.toContainText("Emme saaneet tapahtumia pankista.");
  await context.close();
});
