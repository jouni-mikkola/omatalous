import { describe, expect, it } from "vitest";
import { shutdown } from "../src/entry/shutdown.ts";
import { inflightCount, track, waitForInflight } from "../src/platform/inflight.ts";

describe("stopping", () => {
  const deps = (over: Partial<Parameters<typeof shutdown>[0]> = {}) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        stopScheduler: () => calls.push("scheduler"),
        closeServer: (done: () => void) => (calls.push("server"), setTimeout(done, 5)),
        closeConnections: () => calls.push("connections"),
        waitForInflight: async () => true,
        closeDb: () => calls.push("db"),
        exit: (code: number) => calls.push(`exit ${code}`),
        timeoutMs: 200,
        log: (m: string) => calls.push(`log ${m}`),
        ...over,
      },
    };
  };

  it("stops the scheduler first, waits for running work and then closes the database", async () => {
    let finished = false;
    const { calls, d } = deps({ waitForInflight: async () => (await new Promise((r) => setTimeout(r, 30)), (finished = true)) });
    await shutdown(d);
    expect(finished).toBe(true);
    expect(calls).toEqual(["scheduler", "server", "connections", "db", "exit 0"]);
  });

  it("gives up after the bounded time, cuts the connections and still closes the database", async () => {
    const { calls, d } = deps({ timeoutMs: 40, waitForInflight: () => new Promise<boolean>(() => {}) });
    const started = Date.now();
    await shutdown(d);
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls).toEqual(["scheduler", "server", expect.stringMatching(/^log stopping: work still running after/), "connections", "db", "exit 0"]);
  });

  it("tracks background work for the wait", async () => {
    let release!: () => void;
    const work = track(new Promise<void>((r) => (release = r)));
    expect(inflightCount()).toBe(1);
    expect(await waitForInflight(30)).toBe(false);
    release();
    await work;
    expect(await waitForInflight(30)).toBe(true);
    expect(inflightCount()).toBe(0);
  });
});
