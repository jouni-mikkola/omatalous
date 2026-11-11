import { describe, expect, it, vi } from "vitest";
import { stopHandler } from "../src/entry/shutdown.ts";
import { inflightCount, track, waitForInflight } from "../src/platform/inflight.ts";

describe("stopping", () => {
  const deps = (over: Partial<Parameters<typeof stopHandler>[0]> = {}) => {
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

  /** Resolves when the run has called exit. */
  const untilExit = (calls: string[]) => vi.waitFor(() => expect(calls.some((c) => c.startsWith("exit"))).toBe(true));
  const SIGNAL_LOG = expect.stringMatching(/^log SIGTERM: stopping/);

  it("stops the scheduler first, waits for running work and then closes the database", async () => {
    let finished = false;
    const { calls, d } = deps({ waitForInflight: async () => (await new Promise((r) => setTimeout(r, 30)), (finished = true)) });
    stopHandler(d)("SIGTERM");
    await untilExit(calls);
    expect(finished).toBe(true);
    expect(calls).toEqual([SIGNAL_LOG, "scheduler", "server", "connections", "db", "exit 0"]);
  });

  it("gives up after the bounded time, cuts the connections and still closes the database", async () => {
    const run = deps({ timeoutMs: 40, waitForInflight: () => new Promise<boolean>(() => {}) });
    stopHandler(run.d)("SIGTERM");
    await untilExit(run.calls);
    expect(run.calls).toEqual([SIGNAL_LOG, "scheduler", "server", expect.stringMatching(/^log stopping: work still running after/), "connections", "db", "exit 0"]);
  });

  it.each(["uncaughtException", "unhandledRejection"] as const)("logs one line with the error on %s and exits 1", async (event) => {
    const { calls, d } = deps();
    stopHandler(d)(event, new Error("the disk went away"));
    await untilExit(calls);
    const logs = calls.filter((c) => c.startsWith("log "));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(`${event}: Error: the disk went away`);
    expect(logs[0]).not.toContain("\n");
    expect(calls).toEqual([logs[0], "scheduler", "server", "connections", "db", "exit 1"]);
  });

  it("logs a rejection that is not an Error", async () => {
    const { calls, d } = deps();
    stopHandler(d)("unhandledRejection", "no such bank");
    await untilExit(calls);
    expect(calls[0]).toContain("unhandledRejection: no such bank");
    expect(calls.at(-1)).toBe("exit 1");
  });

  it("starts no second shutdown on a second fault or a signal during the first", async () => {
    const { calls, d } = deps();
    const stop = stopHandler(d);
    stop("uncaughtException", new Error("first"));
    stop("unhandledRejection", new Error("second"));
    stop("SIGTERM");
    await untilExit(calls);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => c === "scheduler")).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("exit"))).toEqual(["exit 1"]);
    // the later fault keeps its error in the log, the later signal says nothing
    const logs = calls.filter((c) => c.startsWith("log "));
    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain("unhandledRejection while stopping: Error: second");
    expect(logs[1]).not.toContain("\n");
  });

  it("logs a fault during a signal stop and keeps the one shutdown", async () => {
    const { calls, d } = deps();
    const stop = stopHandler(d);
    stop("SIGTERM");
    stop("uncaughtException", new Error("late"));
    await untilExit(calls);
    expect(calls.filter((c) => c === "scheduler")).toHaveLength(1);
    expect(calls).toContainEqual(expect.stringContaining("uncaughtException while stopping: Error: late"));
    expect(calls.filter((c) => c.startsWith("exit"))).toEqual(["exit 0"]);
  });

  it("still exits 0 on a signal alone", async () => {
    const { calls, d } = deps();
    stopHandler(d)("SIGTERM");
    await untilExit(calls);
    expect(calls).toEqual(["log SIGTERM: stopping, running work gets 0.2 s", "scheduler", "server", "connections", "db", "exit 0"]);
  });

  it("exits 1 when the shutdown itself fails", async () => {
    const { calls, d } = deps({
      stopScheduler: () => {
        throw new Error("scheduler is gone");
      },
    });
    stopHandler(d)("SIGINT");
    await untilExit(calls);
    expect(calls.at(-2)).toContain("stopping failed: Error: scheduler is gone");
    expect(calls.at(-1)).toBe("exit 1");
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
