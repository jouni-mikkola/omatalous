/** The time of stopping: a wait that never ends is cut at the bound, not later. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { stopHandler } from "../src/entry/shutdown.ts";

describe("stopping", () => {
  it("gives up after the bounded time", async () => {
    const deps = (exit: () => void) => ({
      stopScheduler: () => {},
      closeServer: (done: () => void) => setTimeout(done, 5),
      closeConnections: () => {},
      waitForInflight: () => new Promise<boolean>(() => {}),
      closeDb: () => {},
      exit,
      timeoutMs: 40,
      log: () => {},
    });
    // the bound is of waiting, so it is wall time (CPU time would not see a wait); the best of three runs, each on deps
    // of its own, so a busy machine does not fail it
    let ms = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await new Promise<void>((exited) => stopHandler(deps(exited))("SIGTERM"));
      ms = Math.min(ms, performance.now() - started);
    }
    expect(ms).toBeLessThan(500);
  });
});
