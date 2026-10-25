import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Two rules behind the stamps of `pnpm check` (tools/check/key.sh, tools/check/reads.txt): a test that reads an environment
 * variable the key does not carry would be a hit on a run where it differs, and a step that quietly gained a line in
 * reads.txt would read less than the whole tree without anyone deciding it.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, ROOT), "utf8");
const tracked = (): string[] => execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: ROOT }).split("\n").filter(Boolean);

/** the names on the `env:` line of reads.txt, and the steps that have a line of their own */
export function parseReads(text: string): { steps: string[]; env: string[] } {
  const steps: string[] = [];
  let env: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const at = line.indexOf(": ");
    const name = line.slice(0, at);
    if (name === "env") env = line.slice(at + 2).trim().split(/\s+/);
    else steps.push(name);
  }
  return { steps, env };
}

/** the upper-case names a shell file assigns (NAME=..., also as a prefix of a command): its own, not the caller's */
export function shellAssigns(text: string): Set<string> {
  return new Set([...text.matchAll(/(?:^|[\s;(])(?:export\s+|local\s+|declare\s+(?:-\w+\s+)?|readonly\s+)?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] ?? ""));
}

/**
 * The environment variables a file reads: process.env.X, process.env["X"], process.env[k] (every upper-case string of the file,
 * since k comes from a list there), a destructuring from process.env, and in a shell file the default forms ${X:-...}
 * ${X-...} ${X:=...} ${X:+...} of a name that is not in `assigned` (the file's own assignments unless given: a world file
 * sourced by a suite reads names the suite sets)
 */
export function envReads(text: string, shell = false, assigned: Set<string> = shellAssigns(text)): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1] ?? "");
  for (const m of text.matchAll(/process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g)) names.add(m[1] ?? "");
  if (/process\.env\[\s*[A-Za-z_]/.test(text)) for (const m of text.matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)) names.add(m[1] ?? "");
  for (const m of text.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*process\.env/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const name = part.trim().split(/[:=\s]/)[0];
      if (name) names.add(name);
    }
  }
  if (shell) {
    for (const m of text.matchAll(/\$\{([A-Z][A-Z0-9_]+):?[-=+]/g)) {
      const n = m[1] ?? "";
      if (!assigned.has(n)) names.add(n);
    }
  }
  return [...names].sort();
}

/** the steps that have no line in reads.txt (directly or through the word before their first colon) and are not on the whole-tree list */
export function unlisted(steps: string[], lines: string[], whole: string[]): string[] {
  return steps.filter((s) => !whole.includes(s) && !lines.some((k) => k === s || k.startsWith(`${s}:`)));
}

/** The names a test reads that the key need not carry, each with the reason. */
const ALLOWED_ENV: Record<string, string> = {
  CI: "set by the runner: with it set no stamp is read or written",
  HOME: "the user's home, only a place for scratch files",
  TMPDIR: "where scratch files go, not what a test finds",
  PATH: "which tool is found: node's version is in the key already",
  NODE_ENV: "a run that sets it reads and writes no stamp",
  VITEST_MAX_WORKERS: "how many workers vitest uses, not what a test finds",
  ISLAND_DEBUG: "a debug print only",
  INCREMENTAL_DEBUG: "a debug print only",
  E2E_BASE_URL: "set by pnpm e2e for the page specs, which are no stamped step",
  E2E_DIR: "set by pnpm e2e for the page specs, which are no stamped step",
  E2E_FAKE_BANK: "set by pnpm e2e for the page specs, which are no stamped step",
  CADDY_ADDRESS: "the stub of docker compose in the image-checks suite reads the one the script under test sets for it",
  CHECK_FRESH: "reads no stamp: the shell suites that name it test the stamps themselves",
  SHOTS_DIR: "only where a picture is written; a run that sets it reads and writes no stamp",
  GIT_: "the prefix of git's own variables, which a test clears for the scratch repository it makes",
  E2E_BUILD: "set by the test itself for the stub of the page runner it starts",
  E2E_SERVERS: "set by the page runner under test for the stub of Playwright it starts",
  FAKE_LOG: "set by the test itself for the stub it starts",
  FAKE_PW: "set by the test itself for the stub it starts",
  FAKE_PW_TOUCH: "set by the test itself for the stub it starts",
  PLAYWRIGHT_JSON_OUTPUT_NAME: "set by the test itself for the stub it starts",
  RUNLOG: "the file a suite's own stub writes its calls to, set by the suite before it reads it",
  DBG: "a debug print of the install suite only",
  USER: "the name of the account; a suite that needs one sets it for itself",
  CLOUDFLARE_ACCESS_EMAILS: "the install suite sets it for the script it runs, to made-up addresses",
  APP_VERSION: "the default of the maintenance world, which each suite sets for itself when it matters",
  GIT_COMMIT: "the default of the maintenance world, which each suite sets for itself when it matters",
  OPS_T_WAKE: "how long the maintenance world's docker waits for the helper's wake; the suite that waits sets it for the one tick",
};

/** The steps check.sh can run that read the whole tree on purpose (no line in reads.txt), each with the reason. */
const WHOLE_TREE: Record<string, string> = {
  types: "the packages, the root config, e2e and the tools import from each other: any change can break any of them",
  tests: "a test reads the sources of every package and the files of the repository",
  sh: "the suites copy or clone the repository they test",
};

const STEPS_OF_CHECK = (): string[] => /^ALL=\(([^)]*)\)/m.exec(read("tools/check.sh"))?.[1]?.trim().split(/\s+/) ?? [];

describe("the stamp keys of tools/check/reads.txt", () => {
  const { steps, env } = parseReads(read("tools/check/reads.txt"));
  const files = tracked();
  const isTest = (f: string) =>
    /\.(ts|tsx|mjs)$/.test(f) && (/^(apps|packages)\/[^/]+\/test\//.test(f) || /\.test\.(ts|tsx|mjs)$/.test(f) || /^tools\/[^/]*kit[^/]*\.ts$/.test(f)) && f !== "tools/repo-rules/check-keys.test.ts";
  const isShell = (f: string) => /^tools\/test\/[^/]+\.sh$/.test(f);

  it("every environment variable a test file or a test helper reads is on the env line or allowed here with a reason", () => {
    const known = new Set([...env, ...Object.keys(ALLOWED_ENV)]);
    // a name some suite or world file of tools/test assigns is the suite's own knob, set before the script reads it
    const shell = files.filter(isShell);
    const set = new Set(shell.flatMap((f) => [...shellAssigns(read(f))]));
    const bad = [
      ...files.filter(isTest).flatMap((f) => envReads(read(f)).filter((n) => !known.has(n)).map((n) => `${f}: ${n}`)),
      ...shell.flatMap((f) => envReads(read(f), true, set).filter((n) => !known.has(n)).map((n) => `${f}: ${n}`)),
    ];
    expect(bad).toEqual([]);
  });

  it("every step check.sh can run has a line in reads.txt or is on the whole-tree list", () => {
    expect(STEPS_OF_CHECK()).not.toEqual([]);
    expect(unlisted(STEPS_OF_CHECK(), steps, Object.keys(WHOLE_TREE))).toEqual([]);
    // the whole-tree list names no step that has a line: it would be narrow after all
    expect(Object.keys(WHOLE_TREE).filter((s) => unlisted([s], steps, []).length === 0)).toEqual([]);
  });
});

describe("envReads", () => {
  it("finds the dot form, the bracket form, a name from a list, a destructuring and a shell default", () => {
    expect(envReads("const a = process.env.TZ_ONE;")).toEqual(["TZ_ONE"]);
    expect(envReads('const a = process.env["SOME_KNOB"];')).toEqual(["SOME_KNOB"]);
    expect(envReads('for (const k of ["AAA_ONE", "BBB_TWO"]) delete process.env[k];')).toEqual(["AAA_ONE", "BBB_TWO"]);
    expect(envReads("const { FOO_BAR, BAZ: qux = 1 } = process.env;")).toEqual(["BAZ", "FOO_BAR"]);
    expect(envReads('echo "${SOME_KNOB:-3}"', true)).toEqual(["SOME_KNOB"]);
  });
  it("passes a word that is no env read: a plain string, a variable the shell file assigns, a shell default in a script of another kind", () => {
    expect(envReads('const label = "SOME_KNOB";')).toEqual([]);
    expect(envReads('n=3\necho "${n:-1} ${LOCAL_VAR:-2}"\nLOCAL_VAR=4', true)).toEqual([]);
    expect(envReads('echo "${SOME_KNOB:-3}"', false)).toEqual([]);
  });
});

describe("unlisted", () => {
  const lines = ["lint", "types:core"];
  it("names a step with no line, directly or through a family, that is not on the whole-tree list", () => {
    expect(unlisted(["types", "tests", "lint", "sh"], ["lint"], [])).toEqual(["types", "tests", "sh"]);
  });
  it("passes a step with its own line, a family's line and a whole-tree step", () => {
    expect(unlisted(["lint", "types", "e2e"], lines, ["e2e"])).toEqual([]);
  });
});
