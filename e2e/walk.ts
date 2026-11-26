import { type Browser, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

// The routes the walks open. Each check names the subset it reads, so a route is opened once per width and every check
// that reads it runs on that one load.
const PAGES = [
  "/#/overview",
  "/#/bills",
  "/#/transactions",
  "/#/transactions?view=merchants",
  "/#/reports",
  "/#/reports?q=tulot",
  "/#/reports?q=menot",
  "/#/balances",
  "/#/review",
  "/#/settings/banks",
  "/#/settings/members",
  "/#/settings/security",
  "/#/settings/data",
  "/#/settings/server",
];
/** The reports' other questions, which the accessibility checks read too. */
export const A11Y_ROUTES = [...PAGES, "/#/reports?q=yhteiset"];
/** The tables' routes: the same pages with the report's yearly table. */
export const TABLE_ROUTES = [...PAGES, "/#/reports?q=menot#vuodet"];
export const ONE_LINK_ROUTES = PAGES;

export interface Check {
  name: string;
  routes: readonly string[];
  /** The problems found on the page as it stands, one line each. */
  run: (page: Page, route: string) => Promise<string[]>;
  /** Problems that only the whole walk can tell, such as a search that no table could run. */
  end?: () => string[];
}

/**
 * Opens each route once in one context and runs every check on it, in the order given: a check that opens things
 * (details, drills) comes after those that read the page as it loads. A check that throws is a problem of its own and
 * the others still run. The problems come back as one list, `name: route: problem`.
 */
export async function walk(
  browser: Browser,
  { width, touch = width < 600, downloads = false, checks, console: readConsole = false }: { width: number; touch?: boolean; downloads?: boolean; checks: Check[]; console?: boolean },
): Promise<string[]> {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, acceptDownloads: downloads, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const seen = readConsole ? watch(page) : null;
  const problems: string[] = [];
  const routes = [...new Set(checks.flatMap((c) => c.routes))];
  for (const route of routes) {
    await page.goto(route);
    // a hash-only navigation keeps the old document: reload so the page is read from the start
    await page.reload();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
    if (seen) seen.problems.length = 0;
    for (const check of checks) {
      if (!check.routes.includes(route)) continue;
      try {
        problems.push(...(await check.run(page, route)).map((p) => `${check.name}: ${route}: ${p}`));
      } catch (e) {
        problems.push(`${check.name}: ${route}: stopped: ${String((e as Error).message).split("\n")[0]}`);
      }
      // the console is read once the first check is done, as the page's own first look
      if (seen && check === checks[0]) problems.push(...seen.problems.splice(0).map((p) => `console: ${route}: ${p}`));
    }
  }
  for (const check of checks) problems.push(...(check.end?.() ?? []).map((p) => `${check.name}: ${p}`));
  await context.close();
  return problems;
}
