/**
 * The switch for new versions is gone: every release is offered at once. The two requests it sent are no longer
 * actions, a row an older version queued for one ends unanswered, and a snapshot from an older helper that still
 * reports the old setting is taken whole (contracts/*\/ops-state.json). What the helper does on the host is in tools/test/channel.test.sh.
 */
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { ACTION_SINCE, normaliseState, OPS_ACTIONS, parseOpsRequest } from "../src/services/ops-validate.ts";
import { NOW, setupApp } from "./helpers.ts";

type Services = Awaited<ReturnType<typeof setupApp>>["s"];
const RETIRED = ["prerelease-on", "prerelease-off"] as const;

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Services, args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}
const helperOn = (s: Services, version: string, state: object = {}) => cli(s, ["state", "--helper", version], JSON.stringify(state));

describe("ops: the retired switch for new versions", () => {
  it("is no action any more: not listed, not timed, refused by name", () => {
    for (const action of RETIRED) {
      expect(OPS_ACTIONS as readonly string[]).not.toContain(action);
      expect(Object.keys(ACTION_SINCE)).not.toContain(action);
      expect(() => parseOpsRequest({ action }), action).toThrow();
    }
  });

  it("a request for it is refused and nothing is written", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "6");
    for (const action of RETIRED) expect((await admin.call("POST", "/api/ops/request", { action })).status, action).toBe(400);
    expect(await s.ops.recent(5)).toEqual([]);
  });

  it("a row an older version queued for it ends as a bad request and is never handed to the helper", async () => {
    const { s, adminId } = await setupApp();
    await helperOn(s, "6");
    for (const [i, action] of RETIRED.entries()) {
      const id = `op_00000000000000c${i}`;
      await s.db.run("INSERT INTO ops_requests (id, action, params, requested_by, requested_at) VALUES (?, ?, '{}', ?, ?)", [id, action, adminId, NOW.toISOString()]);
      expect(await cli(s, ["poll", "--helper", "6", "--done", ""]), action).toEqual({ request: null });
      expect((await s.ops.get(id))!, action).toMatchObject({ status: "failed", summary: "Virheellinen pyyntö." });
    }
  });

  it("the page's helper facts no longer say whether the helper knows the switch", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "6");
    expect((await admin.call("GET", "/api/ops/state")).body.helper).not.toHaveProperty("knowsPrerelease");
  });

  it("a snapshot from an older helper that still reports the old setting is kept whole, and anything but its two words is dropped", () => {
    expect(normaliseState({ prerelease: "yes", channel: "release" })).toMatchObject({ prerelease: "yes", channel: "release" });
    expect(normaliseState({ prerelease: "no" })).toMatchObject({ prerelease: "no" });
    for (const bad of [{ prerelease: "true" }, { prerelease: true }, { prerelease: "YES" }, { prerelease: ["yes"] }, { prerelease: "<b>yes</b>" }]) {
      expect(normaliseState(bad).prerelease, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("the channel the helper reports still reaches the page", async () => {
    const { admin, s } = await setupApp();
    const state = async () => (await admin.call("GET", "/api/ops/state")).body.state;
    await helperOn(s, "6", { channel: "release" });
    expect(await state()).toMatchObject({ channel: "release" });
    await helperOn(s, "6", { channel: "private" });
    expect(await state()).toMatchObject({ channel: "private" });
    for (const bad of [{ channel: "main" }, { channel: 1 }]) expect(normaliseState(bad).channel, JSON.stringify(bad)).toBeUndefined();
  });
});
