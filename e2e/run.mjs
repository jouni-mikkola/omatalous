/**
 * `pnpm e2e`: starts the built server on a temporary data directory and a free port (e2e/server.mjs), then runs the
 * Playwright specs against it. Run `pnpm build` first. The servers and their data are removed afterwards.
 *
 * `E2E_WORKERS` (default 3) is the number of Playwright workers. Each has a server of its own, with its own port, data
 * directory and fake bank, and the config gives a worker the server of its `parallelIndex`. Every server starts with the
 * administrator made and the demo household loaded, which is what the first two tests of app.spec.ts leave behind; that
 * file makes them through the page on a server of its own. With `E2E_WORKERS=1` the specs run one after the other.
 */
import { spawnSync } from "node:child_process";
import { request } from "@playwright/test";
import { join } from "node:path";
import { root, startServer } from "./server.mjs";

const FETCH = { "X-Requested-With": "fetch" };

/** The administrator the specs sign in as (`admin-state.json`, as app.spec.ts saves it), the wizard finished, the demo loaded. */
async function prepare(app) {
  const api = await request.newContext({ baseURL: app.base, extraHTTPHeaders: FETCH });
  try {
    for (const [path, data] of [
      ["/api/auth/setup", { code: app.setupCode, username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" }],
      ["/api/admin/instance/complete", undefined],
      ["/api/demo", undefined],
    ]) {
      const answer = await api.post(path, { data });
      if (!answer.ok()) throw new Error(`POST ${path} answered ${answer.status()} ${await answer.text()}`);
    }
    await api.storageState({ path: join(app.dir, "admin-state.json") });
  } finally {
    await api.dispose();
  }
}

const workers = Number(process.env.E2E_WORKERS ?? 3);
const apps = [];
// startServer ends its own server at SIGINT and exits the process there, so the others are ended here
process.on("exit", () => apps.forEach((app) => app.stop()));
let code = 1;
try {
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`E2E_WORKERS is "${process.env.E2E_WORKERS}": use a whole number from 1.`);
  const started = await Promise.allSettled(
    Array.from({ length: workers }, async () => {
      const app = await startServer();
      apps.push(app);
      await prepare(app);
    }),
  );
  for (const one of started) if (one.status === "rejected") throw one.reason;
  const servers = apps.map(({ base, dir, setupCode, fakeBank }) => ({ base, dir, setupCode, fakeBank }));
  const pw = spawnSync(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "-c", join(root, "e2e/playwright.config.ts"), ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, E2E_SERVERS: JSON.stringify(servers) },
  });
  code = pw.status ?? 1;
  const failing = apps.map((app) => app.log()).filter((log) => /error|Error/.test(log));
  if (code !== 0 && failing.length) console.error(`--- server log ---\n${failing.join("\n").slice(-3000)}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  apps.forEach((app) => app.stop());
}
process.exit(code);
