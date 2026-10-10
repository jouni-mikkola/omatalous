import { defineConfig } from "@playwright/test";

// Started by e2e/run.mjs, which provides the address of the temporary server.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error("Run the suite with `pnpm e2e` (after `pnpm build`).");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // one worker: the specs share one server and run in order (setup, demo data, pages, a flow)
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: `${process.env.E2E_DIR ?? "."}/results`,
  use: {
    baseURL,
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
    screenshot: "only-on-failure",
    trace: "off",
    // PLAYWRIGHT_BROWSERS_PATH picks the preinstalled Chromium where there is one; otherwise `playwright install chromium`
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
