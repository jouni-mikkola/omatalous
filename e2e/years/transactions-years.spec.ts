import { expect, request, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { MAX_LIST_ROWS } from "../../packages/core/src/list-limits.ts";
import { watch } from "../helpers.ts";
import { root, startServer } from "../server.mjs";

// Roadmap, Performance budgets: Tapahtumat on five years of invented rows (100 000 or more, apps/server/scripts/history-gen.ts)
// draws its first rows in under a second at a 4x slower processor. The server is this file's own; the history is loaded
// into its database by the seed script, as `pnpm seed:years` does. A heavy local check: `pnpm e2e:years` (no part of
// `pnpm e2e` or of CI, see playwright.config.ts).
const ADMIN = { username: "vuosi-admin", displayName: "Vuosi Admin", password: "vuosi-salasana-123456" };
const CPU_SLOWDOWN = 4;
const FIRST_ROWS_MS = 1000;
const MIN_ROWS = 100_000;
const DATA_ROW = "table.tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer)";
const FETCH = { "X-Requested-With": "fetch" };

let app: Awaited<ReturnType<typeof startServer>>;
let state = "";
const test = base.extend({ baseURL: async ({}, use) => use(app?.base) });
test.beforeAll(async () => {
  app = await startServer();
  const api = await request.newContext({ baseURL: app.base, extraHTTPHeaders: FETCH });
  for (const [path, data] of [
    ["/api/auth/setup", { code: app.setupCode, ...ADMIN }],
    ["/api/admin/instance/complete", undefined],
  ] as const) {
    const answer = await api.post(path, { data });
    if (!answer.ok()) throw new Error(`POST ${path} answered ${answer.status()} ${await answer.text()}`);
  }
  state = join(app.dir, "admin-state.json");
  await api.storageState({ path: state });
  await api.dispose();
  // the history goes straight into the database of the running server (WAL), then its data version moves the caches
  const seed = spawnSync("pnpm", ["--filter", "@banking/server", "seed:years"], { cwd: root, env: { ...process.env, DATA_DIR: join(app.dir, "data") }, encoding: "utf8", timeout: 240_000, killSignal: "SIGKILL" });
  if (seed.status !== 0) throw new Error(`seed:years failed: ${seed.stderr || seed.stdout}`);
});
test.afterAll(() => app?.stop());
test.setTimeout(10 * 60_000);

test(`five years of rows: the list shows its first rows in under a second at ${CPU_SLOWDOWN}x slower processor`, async ({ browser }) => {
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const { today } = await (await page.request.get("/api/meta")).json();
  const total = (await (await page.request.get("/api/transactions?limit=1")).json()).total as number;
  expect(total, "rows in the history").toBeGreaterThanOrEqual(MIN_ROWS);
  // the code, the route's chunk and the answer are fetched once before, as transactions-perf.spec.ts does: the time is the page's own
  await page.goto("/#/transactions");
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  await page.goto("/#/overview");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  const started = Date.now();
  await page.goto("/#/transactions");
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
  const took = Date.now() - started;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  test.info().annotations.push({ type: "measured", description: `${total} rows, first rows after ${took} ms at ${CPU_SLOWDOWN}x (${today})` });
  console.log(`transactions-years: ${total} rows, first rows after ${took} ms at ${CPU_SLOWDOWN}x`);
  expect(took, `rows after ${took} ms`).toBeLessThan(FIRST_ROWS_MS);
  expect(await page.locator(DATA_ROW).count(), "only the rows near the screen are drawn").toBeLessThan(MAX_LIST_ROWS / 4);
  expect(seen.problems).toEqual([]);
  await context.close();
});
