/**
 * The wake: the empty file <data>/ops/wake that the app touches once it has queued a request and `ops poll` removes, which the
 * helper waits for inside its minute (scripts/lib/ops-wake.sh), so a press starts within seconds.
 */
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { helperWakes } from "../src/services/ops-validate.ts";
import { scratchDir, setupApp } from "./helpers.ts";

type Services = Awaited<ReturnType<typeof setupApp>>["s"];

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
const helperOn = (s: Services, version: string) => cli(s, ["state", "--helper", version], "{}");

describe("ops: the wake", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  async function world() {
    const dir = scratchDir("talous-wake-");
    dirs.push(dir);
    const app = await setupApp({}, undefined, { backupDir: join(dir, "backups") });
    await helperOn(app.s, "5");
    return { ...app, dir, wake: join(dir, "ops", "wake") };
  }

  it("a queued request leaves an empty wake, and the poll that follows removes it before it reads", async () => {
    const { admin, s, wake } = await world();
    expect(existsSync(wake)).toBe(false);
    expect((await admin.call("POST", "/api/ops/request", { action: "doctor" })).status).toBe(200);
    expect(statSync(wake).size).toBe(0);
    // a dry poll (the self-test) removes nothing
    await cli(s, ["poll", "--dry", "--helper", "5"]);
    expect(existsSync(wake)).toBe(true);
    expect(await cli(s, ["poll", "--helper", "5", "--done", ""])).toMatchObject({ request: { action: "doctor" } });
    expect(existsSync(wake)).toBe(false);
    // a request queued while the poll reads (the server inserts and touches in its own process) leaves its wake
    const read = s.ops.oldestQueued.bind(s.ops);
    vi.spyOn(s.ops, "oldestQueued").mockImplementation(async (done) => {
      writeFileSync(wake, "");
      return read(done);
    });
    await cli(s, ["poll", "--helper", "5", "--done", ""]);
    expect(existsSync(wake)).toBe(true);
  });

  it("a request the queue refused leaves no wake", async () => {
    const { admin, s, wake } = await world();
    expect((await admin.call("POST", "/api/ops/request", { action: "restart" })).status).toBe(200);
    await cli(s, ["poll", "--helper", "5", "--done", ""]);
    expect(existsSync(wake)).toBe(false);
    expect((await admin.call("POST", "/api/ops/request", { action: "backup" })).status).toBe(409);
    expect(existsSync(wake)).toBe(false);
  });

  it("a wake that cannot be written or removed changes nothing: the request is queued all the same", async () => {
    const { admin, s, dir, wake } = await world();
    // the folder is a file, so the wake cannot be made
    writeFileSync(join(dir, "ops"), "not a folder");
    const r = await admin.call("POST", "/api/ops/request", { action: "doctor" });
    expect(r.status).toBe(200);
    expect(await cli(s, ["poll", "--helper", "5", "--done", ""])).toMatchObject({ request: { id: r.body.request.id } });
    expect(existsSync(wake)).toBe(false);
  });

  it("with no data folder known there is no file and nothing else changes", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "5");
    const r = await admin.call("POST", "/api/ops/request", { action: "doctor" });
    expect(r.status).toBe(200);
    expect(await cli(s, ["poll", "--helper", "5", "--done", ""])).toMatchObject({ request: { id: r.body.request.id } });
  });

  it("the page is told the helper wakes from the version it polls with, never from the snapshot", async () => {
    const { admin, s } = await setupApp();
    await helperOn(s, "4");
    expect((await admin.call("GET", "/api/ops/state")).body.helper.wakes).toBe(false);
    await helperOn(s, "5");
    expect((await admin.call("GET", "/api/ops/state")).body.helper.wakes).toBe(true);
    expect(helperWakes("5")).toBe(true);
    expect(helperWakes("4")).toBe(false);
    expect(helperWakes(null)).toBe(false);
  });
});
