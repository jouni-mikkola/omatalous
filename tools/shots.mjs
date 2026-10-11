// @ts-check
/**
 * `pnpm shots <route> [--widths 390,1366] [--demo]`: screenshots of one page of the built app, for a UI change.
 *   pnpm shots overview --demo            the overview with the demo household, at 390 and 1366 px
 *   pnpm shots "reports?tab=income"       a route with its query (the part after #/)
 * Builds first when the build is older than the sources, starts the app on a free port with a temporary data directory
 * (e2e/server.mjs, as `pnpm e2e` does), creates the administrator, loads the demo household with --demo, saves one
 * full-page PNG per width to $SHOTS_DIR (default /tmp/claude-0/shots), fails when a width scrolls sideways or has a
 * table wider than the screen, and stops the app. Needs a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/** @param {string[]} argv */
export function parseArgs(argv) {
  let widths = [390, 1366];
  let demo = false;
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--demo") demo = true;
    else if (a === "--widths" || a.startsWith("--widths=")) {
      const v = a.includes("=") ? a.slice(9) : argv[++i] ?? "";
      widths = v.split(",").map(Number);
      if (!widths.length || widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) throw new Error(`--widths takes pixel widths like 390,1366 (got: ${v})`);
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a} (usage: pnpm shots <route> [--widths 390,1366] [--demo])`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new Error("usage: pnpm shots <route> [--widths 390,1366] [--demo]");
  const route = (rest[0] ?? "").replace(/^#?\/?/, "");
  if (!/^[a-z][a-z-]*(\?[\w=&%.-]*)?$/.test(route)) throw new Error(`the route is a page id with an optional query, like overview or reports?tab=income (got: ${route})`);
  return { route, widths, demo, slug: route.replace(/[?=&%]+/g, "-") };
}

/** True when the build is missing or older than the newest source file. */
function stale() {
  const built = [join(ROOT, "apps/server/dist/node.js"), join(ROOT, "apps/web/dist/index.html")];
  if (!built.every(existsSync)) return true;
  const oldest = Math.min(...built.map((f) => statSync(f).mtimeMs));
  /** @param {string} d @returns {number} */
  const newest = (d) => readdirSync(d, { withFileTypes: true }).reduce((m, e) => (e.name === "node_modules" || e.name === "dist" ? m : Math.max(m, e.isDirectory() ? newest(join(d, e.name)) : statSync(join(d, e.name)).mtimeMs)), 0);
  return ["apps/web/src", "apps/web/public", "apps/server/src", "packages/core/src"].some((d) => newest(join(ROOT, d)) > oldest) || statSync(join(ROOT, "apps/web/index.html")).mtimeMs > oldest;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (stale()) {
    console.log("shots: the build is older than the sources, building");
    if (spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" }).status !== 0) throw new Error("pnpm build failed");
  }
  const { startServer } = await import("../e2e/server.mjs");
  const { chromium } = await import("@playwright/test");
  const out = process.env.SHOTS_DIR ?? "/tmp/claude-0/shots";
  mkdirSync(out, { recursive: true });
  const app = await startServer();
  /** @type {import("@playwright/test").Browser | undefined} */
  let browser;
  let bad = 0;
  try {
    browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
    const context = await browser.newContext({ locale: "fi-FI", timezoneId: "Europe/Helsinki" });
    const call = async (/** @type {string} */ path, /** @type {object} */ data = {}) => {
      const r = await context.request.post(`${app.base}${path}`, { data, headers: { "X-Requested-With": "fetch" } });
      if (!r.ok()) throw new Error(`POST ${path} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`);
    };
    await call("/api/auth/setup", { code: app.setupCode, username: "shots", displayName: "Shots", password: "shots-salasana-123456" });
    await call("/api/admin/instance/complete");
    if (o.demo) await call("/api/demo");
    for (const width of o.widths) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${app.base}/#/${o.route}`);
      await page.waitForLoadState("networkidle");
      await page.getByText("Ladataan…").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
      const file = join(out, `${o.slug}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const m = await page.evaluate(() => ({
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tables: Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length,
      }));
      const ok = m.over <= 1 && m.tables === 0;
      if (!ok) bad++;
      console.log(`shots: ${o.route} at ${width}px ${file} ${ok ? "no horizontal scroll" : `SCROLLS SIDEWAYS (${m.over}px over, ${m.tables} tables wider than the screen)`}`);
      await page.close();
    }
  } finally {
    await browser?.close();
    app.stop();
  }
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`shots: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
