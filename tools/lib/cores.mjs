// @ts-check
/**
 * A lease on a share of the machine's cores for a node process that sizes its own workers (vitest.config.ts, e2e/run.mjs):
 * tools/cores.sh --hold, kept until this process ends (its stdin pipe closes then, killed or not). Decision: how many
 * workers a run may start without loading the machine to a multiple of its cores.
 *
 * `await holdCores(label)` resolves to the number of cores this run may use, or null when no limit applies: the lease is
 * held by a run around this one (CORES_HELD, then CORES_SHARE is its share), CI or a release cut (VITEST_MAX_WORKERS) hands out shares of its own,
 * or tools/cores.sh is missing. A lease taken sets CORES_HELD and CORES_SHARE in this process, so a run it starts
 * (a check, a page test run) does not take a second one. The wait for a lease is told on stderr by tools/slots.sh.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "cores.sh");

/** @param {string} label @param {NodeJS.ProcessEnv} [env] @returns {Promise<number | null>} */
export function holdCores(label, env = process.env) {
  const given = Number(env.CORES_SHARE);
  if (env.CORES_HELD) return Promise.resolve(given > 0 ? given : null);
  if (env.CI || env.VITEST_MAX_WORKERS || !existsSync(script)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn("bash", [script, "--hold", "--label", label], { stdio: ["pipe", "pipe", "inherit"], env });
    let seen = "";
    const done = (/** @type {number | null} */ share) => {
      child.stdout.removeAllListeners("data");
      resolve(share);
    };
    child.on("error", () => done(null));
    child.on("exit", () => done(null));
    child.stdout.on("data", (chunk) => {
      seen += chunk;
      const m = /^(\d+)\n/.exec(seen);
      if (!m) return;
      const share = Number(m[1]);
      env.CORES_HELD = "1";
      env.CORES_SHARE = String(share);
      // the lease lasts as long as this process: the pipes must not keep it alive, and a closed stdin ends the holder
      child.unref();
      // the pipes of a spawned child are sockets, which can be unref'd
      /** @type {import("node:net").Socket} */ (/** @type {unknown} */ (child.stdin)).unref();
      /** @type {import("node:net").Socket} */ (/** @type {unknown} */ (child.stdout)).unref();
      done(share);
    });
  });
}
