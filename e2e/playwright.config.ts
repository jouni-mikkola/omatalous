import { defineConfig } from "@playwright/test";

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
  testMatch: "*.spec.ts",
  // the specs of one file run in order; the files are shared out among the workers, and each worker has its own server
  workers: servers.length,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: `${servers[0]!.dir}/results`,
  use: {
    baseURL: own.base,
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
    screenshot: "only-on-failure",
    trace: "off",
    // PLAYWRIGHT_BROWSERS_PATH picks the preinstalled Chromium where there is one; otherwise `playwright install chromium`
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
