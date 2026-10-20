/**
 * The built server on a temporary data directory and a free port, shared by `pnpm e2e` (run.mjs) and `pnpm shots`.
 * Needs `pnpm build` first. `stop()` ends the server and removes its data, as does SIGINT or SIGTERM. Each call starts a
 * server, a fake bank and a data directory of its own, so several can run side by side.
 */
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * The fake bank (e2e/fake-bank/) in a process of its own: run.mjs waits for the specs in a call that blocks this one,
 * which would leave it unable to answer. Resolves with its address and consent host once it prints them.
 */
function startFakeBank() {
  const child = spawn(process.execPath, [join(root, "e2e/fake-bank/server.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((ok, fail) => {
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`the fake bank exited with ${code}`)));
    child.stdout.once("data", (line) => ok({ ...JSON.parse(String(line)), child }));
  });
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

/** @returns {Promise<{ base: string, dir: string, setupCode: string, fakeBank: string, log: () => string, stop: () => void }>} */
export async function startServer() {
  // `pnpm e2e` builds a run that may stamp into a folder of its own and names it here: the tree's `dist` is not touched
  const own = process.env.E2E_BUILD;
  const built = own ? { bundle: join(own, "node.js"), web: join(own, "web") } : { bundle: join(root, "apps/server/dist/node.js"), web: join(root, "apps/web/dist") };
  if (!existsSync(built.bundle) || !existsSync(join(built.web, "index.html"))) throw new Error("No build found. Run `pnpm build` first.");
  const dir = mkdtempSync(join(tmpdir(), "banking-e2e-"));
  let server;
  let bank;
  let log = "";
  // an interrupted run must not leave the server running or its data in /tmp. Registered at once: nothing between
  // mkdtemp and here lets the event loop run, so a signal cannot arrive before it.
  const onInt = () => (stop(), process.exit(130));
  const onTerm = () => (stop(), process.exit(143));
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  const stop = () => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    server?.kill("SIGTERM");
    bank?.child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  };
  // a copy, so a build started while the suite runs cannot change the files under test
  const bundle = join(dir, "app", "node.js");
  cpSync(built.bundle, bundle);
  // a build with migrations of its own keeps them beside its bundle, in private-migrations/
  const privateMigrations = join(dirname(built.bundle), "private-migrations");
  if (existsSync(privateMigrations)) cpSync(privateMigrations, join(dir, "app", "private-migrations"), { recursive: true });
  cpSync(built.web, join(dir, "app", "public"), { recursive: true });
  // the bank's API for the specs that link a bank; the app is pointed at it for every spec, and one that does not link never calls it
  bank = await startFakeBank();
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
    EB_API_URL: bank.base,
    // the host of the fake consent page; the bank application itself is saved by the spec that links (helpers.ts)
    EB_AUTH_HOSTS: bank.consentHost,
  };
  delete env.APP_SECRET;
  // the application the fake bank accepts: made now and kept in memory, never in a file. It goes to the specs as
  // `fakeBank` (run.mjs puts it in their environment) and not to the app, which gets it from the spec that links.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const fakeBank = JSON.stringify({
    url: bank.base,
    consentHost: bank.consentHost,
    appId: randomUUID(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const nodeArgs = ["--disable-warning=ExperimentalWarning", bundle];
  try {
    const setup = spawnSync(process.execPath, [...nodeArgs, "setup-code"], { env, encoding: "utf8" });
    if (setup.status !== 0) throw new Error(`setup-code failed: ${setup.stderr || setup.stdout}`);
    const setupCode = setup.stdout.trim().split("\n").pop() ?? "";
    server = spawn(process.execPath, nodeArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
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
    return { base, dir, setupCode, fakeBank, log: () => log, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
