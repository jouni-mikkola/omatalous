import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { setupApp } from "./helpers.ts";

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Awaited<ReturnType<typeof setupApp>>["s"], args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(lines[0]!);
}

describe("ops: the audit list", () => {
  it("the audit list has one row for an action: the result takes the place of the request that was queued", async () => {
    const { admin, s, adminId } = await setupApp();
    await cli(s, ["state", "--helper", "2"], "{}");
    const id = (await admin.call("POST", "/api/ops/request", { action: "logs" })).body.request.id;
    const rows = async () => ((await admin.call("GET", "/api/ops/audit")).body.events as { action: string; outcome: string }[]).filter((e) => e.action === "lokien luku");
    expect((await rows()).map((e) => e.outcome)).toEqual(["jonossa"]);
    await cli(s, ["poll", "--helper", "2"]);
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Valmis.", output: "x" }));
    const done = await rows();
    expect(done).toHaveLength(1);
    expect(done[0]!.outcome).not.toBe("jonossa");
    // a second request waits beside the finished one: two rows, one for each
    s.opsLimiter.reset(`ops:${adminId}`);
    await s.db.run("UPDATE ops_requests SET requested_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [id]);
    await admin.call("POST", "/api/ops/request", { action: "logs" });
    expect((await rows()).map((e) => e.outcome === "jonossa")).toEqual([true, false]);
  });
});
