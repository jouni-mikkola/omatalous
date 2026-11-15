/**
 * A CLI call prints its answer on stdout and nothing else, also when the install has an add-on module folder
 * (docs/MODULES.md). The maintenance helper reads `ops poll` as one exact line (scripts/ops-helper.sh, poll_once): a
 * line about the module before it made every poll "an unexpected shape", so no maintenance action ran.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchDir } from "./helpers.ts";

const ENTRY = fileURLToPath(new URL("../src/entry/node.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

let dataDir: string;
const env = () => ({ PATH: process.env.PATH, DATA_DIR: dataDir, APP_SECRET: "test-secret-that-is-long-enough-0123456789", PORT: "0", HOST: "127.0.0.1" });
const cli = (...args: string[]) => spawnSync(TSX, ["--disable-warning=ExperimentalWarning", ENTRY, ...args], { env: env(), encoding: "utf8", timeout: 100_000 });

beforeAll(() => {
  dataDir = scratchDir("talous-cli-module-");
  // an installed module the start refuses (its bundle is not there): the start says one line about it
  mkdirSync(join(dataDir, "modules"), { recursive: true });
  writeFileSync(join(dataDir, "modules", "active.json"), JSON.stringify({ id: "example", version: "1.2.0" }));
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("a CLI call on an install with an add-on module folder", () => {
  it("answers `ops poll` with the one line the maintenance helper reads, and says the module's line on stderr", () => {
    const r = cli("ops", "poll", "--helper", "1", "--done", "");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('{"request":null}\n');
    expect(r.stderr).toContain("add-on module example 1.2.0 refused: the installed bundle is missing; running without it");
  }, 120_000);

  it("prints only the version for `version`", () => {
    const r = cli("version");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("add-on module");
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  }, 120_000);
});
