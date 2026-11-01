import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import "./browser-hosts.ts";

// Started by e2e/run.mjs: one temporary server for each worker, in the order of the workers' `parallelIndex`.
const servers: { base: string; dir: string; setupCode: string; fakeBank: string }[] = JSON.parse(process.env.E2E_SERVERS ?? "[]");
if (!servers.length) throw new Error("Run the suite with `pnpm e2e` (after `pnpm build`).");
// The config is loaded again in every worker, after Playwright has set its index. The specs read their server from
// the environment, so a worker gets the environment of its own server before it loads any spec.
const own = servers[Number(process.env.TEST_PARALLEL_INDEX ?? 0)];
if (!own) throw new Error(`There are ${servers.length} servers and more workers: set E2E_WORKERS for \`pnpm e2e\` instead of --workers.`);
Object.assign(process.env, { E2E_BASE_URL: own.base, E2E_DIR: own.dir, E2E_SETUP_CODE: own.setupCode, E2E_FAKE_BANK: own.fakeBank });

export default defineConfig({
  testDir: ".",
  // the specs of one file run in order; the files are shared out among the workers, and each worker has its own server
  workers: servers.length,
  projects: [
    { name: "app", testMatch: "*.spec.ts", testIgnore: ["private/**", "first-evening/**", "years/**"] },
    // the First evening check starts a server of its own and runs for minutes: a local check (`pnpm first-evening`), not part of the suite or of CI
    ...(process.env.E2E_FIRST_EVENING ? [{ name: "first-evening", testMatch: "first-evening/*.spec.ts", workers: 1 }] : []),
    // the list of Tapahtumat on five years of rows (100 000 or more) starts a server of its own and loads them: a local check (`pnpm e2e:years`), like the one above
    ...(process.env.E2E_YEARS ? [{ name: "years", testMatch: "years/*.spec.ts", workers: 1 }] : []),
    // the private specs switch an instance-wide flag and share the demo's data: one at a time, so each starts from
    // the state the one before it left while no other spec changes it (KV7, the flag race).
    // A server bundle built without the private modules has no pages for them (e2e/run.mjs says so).
    ...(process.env.E2E_SKIP_PRIVATE ? [] : [{ name: "private", testMatch: "private/*.spec.ts", workers: 1 }]),
  ],
  fullyParallel: false,
  // E2E_RETRY=1 reruns a failed test once (e2e/run.mjs lists what only passed on the rerun); the default is no rerun
  retries: Number(process.env.E2E_RETRY) > 0 ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  // outside the servers' folders, which the runner deletes, so the trace of a failed test outlives the run (test-results/ is ignored by git)
  outputDir: process.env.E2E_RESULTS ?? fileURLToPath(new URL("../test-results/e2e", import.meta.url)),
  use: {
    baseURL: own.base,
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
    screenshot: "only-on-failure",
    // a failed test leaves its trace (test-results/e2e/<test>/trace.zip) and a retry of it too, a passing one leaves nothing
    trace: "retain-on-failure",
    // PLAYWRIGHT_BROWSERS_PATH picks the preinstalled Chromium where there is one; otherwise `playwright install chromium`
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
