import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// e2e/run.mjs under the cut lock, with `flock` itself as the holder. E2E_WORKERS=0 makes a run that gets past the lock
// end at once on its own message, so no server or browser starts.
const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "cut-lock-"));
// a lock file of its own: under `pnpm check` the repository's cut.lock is held shared by the check itself
const lock = join(dir, "cut.lock");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const haveFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;

function runner(env: Record<string, string>) {
  const clean: Record<string, string | undefined> = { ...process.env, E2E_NETNS: "0", E2E_WORKERS: "0", CUT_LOCK_WAIT: "0", CUT_LOCK_FILE: lock };
  delete clean.CUT_LOCK_HELD;
  delete clean.CI;
  return spawnSync(process.execPath, [join(root, "e2e/run.mjs")], { env: { ...clean, ...env }, encoding: "utf8" });
}

/** `flock` holds the lock around a `cat` that waits on its stdin; once it prints "held" the lock is ours. */
async function holding(mode: "-x" | "-s", body: () => void | Promise<void>, file = lock) {
  const holder = spawn("flock", [mode, file, "sh", "-c", "echo held; cat"], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise<void>((ok) => holder.stdout.once("data", () => ok()));
  try {
    await body();
  } finally {
    holder.stdin.end();
    await new Promise((ok) => holder.once("exit", ok));
  }
}

describe.skipIf(!haveFlock)("pnpm e2e and the cut lock", () => {
  it("waits for an exclusive holder, says so once, and ends red naming the lock file", async () => {
    await holding("-x", () => {
      const r = runner({ CUT_LOCK_WAIT: "0" });
      expect(r.status).toBe(1);
      expect(r.stderr.match(/waiting for the cut/g)).toHaveLength(1);
      expect(r.stderr).toContain(`the cut did not end within 0 s: ${lock}`);
      expect(r.stderr).not.toContain("E2E_WORKERS");
    });
  });

  it("stands behind a cut that holds the queue file: says so once and ends red naming that file", async () => {
    const queue = join(dir, "cut.wait");
    await holding(
      "-x",
      () => {
        const r = runner({ CUT_LOCK_WAIT: "0.3" });
        expect(r.status).toBe(1);
        expect(r.stderr.match(/waiting for the cut/g)).toHaveLength(1);
        expect(r.stderr).toContain(`the cut did not end within 0.3 s: ${queue}`);
        expect(r.stderr).not.toContain("E2E_WORKERS");
      },
      queue,
    );
  });

  it("runs beside a shared holder without a word about the cut", async () => {
    await holding("-s", () => {
      const r = runner({ CUT_LOCK_WAIT: "0" });
      expect(r.stderr).not.toContain("the cut");
      expect(r.stderr).toContain('E2E_WORKERS is "0"');
    });
  });

  it("does not lock when the cut itself or CI started the run", async () => {
    await holding("-x", () => {
      for (const env of [{ CUT_LOCK_HELD: "1" }, { CI: "1" }] as Record<string, string>[]) {
        const r = runner(env);
        expect(r.stderr).not.toContain("the cut");
        expect(r.stderr).toContain('E2E_WORKERS is "0"');
      }
    });
    expect(existsSync(lock)).toBe(true);
  });
});
