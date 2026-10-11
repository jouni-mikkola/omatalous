/**
 * `pnpm e2e`: starts the built server on a temporary data directory and a free port (e2e/server.mjs), then runs the
 * Playwright specs against it. Run `pnpm build` first. The server and its data are removed afterwards.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { root, startServer } from "./server.mjs";

let app;
let code = 1;
try {
  app = await startServer();
  const pw = spawnSync(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "-c", join(root, "e2e/playwright.config.ts"), ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, E2E_BASE_URL: app.base, E2E_SETUP_CODE: app.setupCode, E2E_DIR: app.dir },
  });
  code = pw.status ?? 1;
  if (code !== 0 && /error|Error/.test(app.log())) console.error(`--- server log ---\n${app.log().slice(-3000)}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  app?.stop();
}
process.exit(code);
