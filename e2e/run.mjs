/**
 * `pnpm e2e`: starts the built server on a temporary data directory and a free port, then runs the Playwright
 * specs against it. Run `pnpm build` first. The server and its data are removed afterwards.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const built = { bundle: join(root, "apps/server/dist/node.js"), web: join(root, "apps/web/dist") };
if (!existsSync(built.bundle) || !existsSync(join(built.web, "index.html"))) {
  console.error("No build found. Run `pnpm build` first.");
  process.exit(1);
}

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), "banking-e2e-"));
// a copy, so a build started while the suite runs cannot change the files under test
const bundle = join(dir, "app", "node.js");
cpSync(built.bundle, bundle);
cpSync(built.web, join(dir, "app", "public"), { recursive: true });
const port = await freePort();
const env = {
  ...process.env,
  DATA_DIR: join(dir, "data"),
  APP_SECRET_FILE: join(dir, "secrets", "app_secret"),
  PORT: String(port),
  HOST: "127.0.0.1",
  APP_BASE_URL: `http://127.0.0.1:${port}`,
  // nothing in a test may reach a real register or bank
  INDUSTRY_LOOKUP: "false",
  STATIC_DIR: join(dir, "app", "public"),
  MIGRATIONS_DIR: join(root, "apps/server/migrations"),
};
delete env.APP_SECRET;
const nodeArgs = ["--disable-warning=ExperimentalWarning", bundle];

let server;
let code = 1;
const stop = () => server?.kill("SIGTERM");
try {
  const setup = spawnSync(process.execPath, [...nodeArgs, "setup-code"], { env, encoding: "utf8" });
  if (setup.status !== 0) throw new Error(`setup-code failed: ${setup.stderr || setup.stdout}`);
  const setupCode = setup.stdout.trim().split("\n").pop();

  server = spawn(process.execPath, nodeArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  server.on("exit", (c) => c !== null && c !== 0 && console.error(`server exited with ${c}\n${log}`));

  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > until) throw new Error(`server did not start\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }

  const pw = spawnSync(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "-c", join(root, "e2e/playwright.config.ts"), ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, E2E_BASE_URL: base, E2E_SETUP_CODE: setupCode, E2E_DIR: dir },
  });
  code = pw.status ?? 1;
  if (code !== 0 && /error|Error/.test(log)) console.error(`--- server log ---\n${log.slice(-3000)}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  stop();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
