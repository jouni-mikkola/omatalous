import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseArgs } from "./shots.mjs";

describe("pnpm shots arguments", () => {
  it("takes a route, widths and --demo, and names the files after the route", () => {
    expect(parseArgs(["overview"])).toEqual({ route: "overview", widths: [390, 1366], demo: false, slug: "overview" });
    expect(parseArgs(["#/reports?tab=income", "--widths", "320,768", "--demo"])).toEqual({ route: "reports?tab=income", widths: [320, 768], demo: true, slug: "reports-tab-income" });
    expect(parseArgs(["optimise", "--widths=500"]).widths).toEqual([500]);
  });

  it("refuses what is no route, a bad width, an unknown option and a missing route", () => {
    expect(() => parseArgs(["../etc/passwd"])).toThrow(/page id/);
    expect(() => parseArgs(["overview", "--widths", "wide"])).toThrow(/pixel widths/);
    expect(() => parseArgs(["overview", "--full"])).toThrow(/unknown option/);
    expect(() => parseArgs([])).toThrow(/usage/);
  });
});

// needs the build that pnpm shots otherwise makes, so it is skipped on a fresh clone
describe.skipIf(!existsSync(join(import.meta.dirname, "../apps/server/dist/node.js")))("pnpm shots cleans up", () => {
  const tmp = mkdtempSync(join(tmpdir(), "shots-test-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const env = (chrome: string) => ({ ...process.env, TMPDIR: tmp, SHOTS_DIR: join(tmp, "out"), E2E_CHROMIUM: chrome });
  const left = () => readdirSync(tmp).filter((f) => f.startsWith("banking-e2e-"));

  it("removes the server's data when the browser does not start", () => {
    const r = spawnSync(process.execPath, ["tools/shots.mjs", "overview"], { cwd: join(import.meta.dirname, ".."), env: env("/nonexistent/chrome"), encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(left()).toEqual([]);
  }, 60_000);

  it("removes it and exits on SIGTERM while the browser is still starting", async () => {
    const hang = join(tmp, "hang");
    writeFileSync(hang, "#!/bin/sh\nexec sleep 20\n");
    chmodSync(hang, 0o755);
    const child = spawn(process.execPath, ["tools/shots.mjs", "overview"], { cwd: join(import.meta.dirname, ".."), env: env(hang), stdio: "ignore" });
    const exit = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
    for (let i = 0; i < 100 && left().length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(left().length, "the server started").toBe(1);
    child.kill("SIGTERM");
    expect(await exit).toBe(143);
    expect(left()).toEqual([]);
  }, 60_000);
});
