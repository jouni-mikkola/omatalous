/**
 * `pnpm e2e`: starts the built server on a temporary data directory and a free port (e2e/server.mjs), then runs the
 * Playwright specs against it. Run `pnpm build` first. The servers and their data are removed afterwards.
 *
 * `E2E_WORKERS` is the number of Playwright workers. The default is a third of the CPUs, at least 3 and at most 8 (28 CPUs:
 * 8). On a 28-CPU machine the whole suite took 83 s with 3 workers, 58 s with 6, 54 s with 8; 10 or more were a few seconds
 * faster but failed one run in three when the machine was busy, so 8 is the cap. Each worker has a server of its own, with its own port, data
 * directory and fake bank, and the config gives a worker the server of its `parallelIndex`. Every server starts with the
 * administrator made and the demo household loaded, which is what the first two tests of app.spec.ts leave behind; that
 * file makes them through the page on a server of its own. With `E2E_WORKERS=1` the specs run one after the other.
 */
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { root, startServer } from "./server.mjs";

/**
 * A release cut holds `cut.lock` (one file for all worktrees of the repository) exclusively while its gate and proof run, and
 * a suite beside them could make them red. Unless `CUT_LOCK_HELD` or `CI` is set the runner starts itself again under a shared
 * lock on that file, so suites run side by side and only a cut makes them wait: one line, then at most `CUT_LOCK_WAIT` seconds
 * (1800; `CUT_LOCK_FILE` names another file, for a test), after which the run ends red naming the file. `CUT_LOCK_HELD=1` marks what runs under the lock.
 */
function cutLock() {
  if (process.env.CUT_LOCK_HELD || process.env.CI) return;
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).stdout.trim();
  if (!common) return console.error("e2e: no cut lock (not a git checkout)");
  const file = process.env.CUT_LOCK_FILE ?? join(resolve(root, common), "cut.lock");
  const wait = process.env.CUT_LOCK_WAIT ?? "1800";
  // a cut waiting for the lock has its place in the queue: `cut.wait`, held exclusively by the cut, is taken shared for a
  // moment first, so a run that arrives later stands behind the cut. One limit and one line for both waits; a `cut.wait`
  // that cannot be opened (a status other than 99) is no error.
  const queue = join(dirname(file), "cut.wait");
  const began = Date.now();
  let said = false;
  const say = () => said || ((said = true), console.error("e2e: waiting for the cut"));
  if (spawnSync("flock", ["-s", "-n", queue, "true"], { stdio: "ignore" }).status === 1) say();
  const queued = spawnSync("flock", ["-s", "-w", wait, "-E", "99", queue, "true"], { stdio: "ignore" });
  const left = Math.max(0, Number(wait) - (Date.now() - began) / 1000).toFixed(3);
  if (queued.status === 99) {
    console.error(`e2e: the cut did not end within ${wait} s: ${queue}`);
    process.exit(1);
  }
  if (spawnSync("flock", ["-s", "-n", file, "true"], { stdio: "ignore" }).status !== 0) say();
  const again = spawnSync("flock", ["-s", "-w", left, "-E", "99", file, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, CUT_LOCK_HELD: "1" },
  });
  if (again.status === 99) console.error(`e2e: the cut did not end within ${wait} s: ${file}`);
  process.exit(again.status === 99 ? 1 : (again.status ?? 1));
}
cutLock();

/**
 * As root with `unshare` at hand (and `E2E_NETNS` not `0`) the runner starts itself again inside a network of its own with
 * only the loopback up: the suite needs nothing but 127.0.0.1, and another program adding or dropping a network interface
 * on the machine (a container, a VPN) then cannot make the browser drop a request. `E2E_NETNS_DONE` marks the second start.
 */
function ownNetwork() {
  if (process.env.E2E_NETNS_DONE) return;
  const why = process.env.E2E_NETNS === "0" ? "E2E_NETNS=0" : process.getuid?.() !== 0 ? "not root" : null;
  const up = ["-n", "sh", "-c", "ip link set lo up"];
  if (!why && spawnSync("unshare", up, { stdio: "ignore" }).status !== 0) return console.error("e2e: on the machine's network (unshare -n is not available)");
  if (why) return console.error(`e2e: on the machine's network (${why})`);
  console.error("e2e: in a network of its own (unshare -n, loopback only)");
  const again = spawnSync("unshare", ["-n", "sh", "-c", 'ip link set lo up && exec "$@"', "sh", process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, E2E_NETNS_DONE: "1" },
  });
  process.exit(again.status ?? 1);
}
ownNetwork();

const FETCH = { "X-Requested-With": "fetch" };

/** The administrator the specs sign in as (`admin-state.json`, as app.spec.ts saves it), the wizard finished, the demo loaded. */
async function prepare(app) {
  const { request } = await import("@playwright/test"); // loaded here, so a run that only waits for the cut stays light
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

const workers = Number(process.env.E2E_WORKERS ?? Math.min(8, Math.max(3, Math.floor(availableParallelism() / 3))));
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
