import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SECRET_PATHS, definitions, namedElsewhere, notIgnored, quietGrepPipes } from "./shell.ts";

const lines = (text: string) => quietGrepPipes(text).map((f) => f.line);

describe("rule 25 detection", () => {
  it("finds a pipe into grep -q in each form it is written", () => {
    expect(lines("set -o pipefail\ncmd | grep -q x\n")).toEqual([2]);
    expect(lines("cmd | grep -qE 'a|b'\n")).toEqual([1]);
    expect(lines("cmd | grep -Eq a\n")).toEqual([1]);
    expect(lines("cmd | grep -i --quiet a\n")).toEqual([1]);
    expect(lines("cmd | grep --silent a\n")).toEqual([1]);
    expect(lines("cmd | tee log | grep -qx 'x y'\n")).toEqual([1]);
    expect(lines("if a | b | grep -q .; then :; fi\n")).toEqual([1]);
    expect(lines("LC_ALL=C cmd | LANG=C grep -q x\n")).toEqual([1]);
    expect(lines("cmd | command grep -q x\n")).toEqual([1]);
    expect(lines("cmd | egrep -q x\n")).toEqual([1]);
  });

  it("finds the pipe in a string a shell runs, a continued line and a workflow step", () => {
    expect(lines(`check "name" bash -c "! ls '$D' | grep -q '\\.db\\.gz\\$'"\n`)).toEqual([1]);
    expect(lines("check \"n\" bash -c 'ps -p \"$1\" | grep -q update.sh' _ \"$P\"\n")).toEqual([1]);
    expect(lines("cmd |\n  grep -q x\n")).toEqual([2]);
    expect(lines("cmd \\\n  | grep -q x\n")).toEqual([2]);
    expect(lines("    run: |\n      docker compose config | grep -q 'host_ip: ::1'\n")).toEqual([2]);
  });

  it("allows grep -q on a file, a grep that prints, and the writer after >/dev/null", () => {
    expect(lines("grep -q x file\n")).toEqual([]);
    expect(lines("grep -qx x a b\n")).toEqual([]);
    expect(lines("cmd | grep -q x file\n")).toEqual([]);
    expect(lines("cmd | grep -qe x file\n")).toEqual([]);
    expect(lines("cmd | grep -q x < file\n")).toEqual([]);
    expect(lines("cmd | grep x >/dev/null\n")).toEqual([]);
    expect(lines("cmd | grep -E 'a|b' >/dev/null && echo yes\n")).toEqual([]);
    expect(lines("cmd | grep -c x\n")).toEqual([]);
    expect(lines("cmd || grep -q x\n")).toEqual([]);
    expect(lines("cmd 2>&1 >| out; grep -q x f\n")).toEqual([]);
    expect(lines("# cmd | grep -q x\n")).toEqual([]);
    expect(lines("cmd | grep x # was grep -q\n")).toEqual([]);
  });

  it("does not take a pattern or a value for the option q", () => {
    expect(lines("cmd | grep -e q\n")).toEqual([]);
    expect(lines("cmd | grep -eq\n")).toEqual([]);
    expect(lines("cmd | grep -m1 -A2 q\n")).toEqual([]);
    expect(lines("cmd | grep 'x' -- -q\n")).toEqual([]);
    expect(lines("cmd | grep -q -e x\n")).toEqual([1]);
    expect(lines("cmd | grep -A1 -q x\n")).toEqual([1]);
  });
});

describe("rule 26 detection", () => {
  const script = "dead() { echo no; }\nused() { echo yes; }\nfunction fn {\n  :\n}\nmain() {\n  used\n  # dead is gone\n  fn_other\n}\n";

  it("finds the definitions of both forms", () => {
    expect(definitions(script)).toEqual([
      { name: "dead", line: 1 },
      { name: "used", line: 2 },
      { name: "fn", line: 3 },
      { name: "main", line: 6 },
    ]);
    expect(definitions("  helper () {\n    :\n  }\n")).toEqual([{ name: "helper", line: 1 }]);
    expect(definitions("x=$(foo)\nif cond; then\n")).toEqual([]);
  });

  it("a function with a caller is named elsewhere, one with no caller is not", () => {
    expect(namedElsewhere(script, "used")).toBe(true);
    expect(namedElsewhere(script, "dead")).toBe(false);
    expect(namedElsewhere(script, "fn")).toBe(false);
    expect(namedElsewhere(`${script}fn\n`, "fn")).toBe(true);
    expect(namedElsewhere("a() { b; }\nb() { :; }\n", "b")).toBe(true);
    expect(namedElsewhere("a() { b; }\nb() { :; }\n", "a")).toBe(false);
  });

  it("a name in a comment, a longer name and a flag are no caller; a call in a string and in another file is", () => {
    expect(namedElsewhere("dc() { :; }\n# dc is called by x\n", "dc")).toBe(false);
    expect(namedElsewhere("dc() { :; }\nabc_dc\ndc-more\n--dc\n", "dc")).toBe(false);
    expect(namedElsewhere("dc() { :; }\ntrap 'dc' EXIT\n", "dc")).toBe(true);
    expect(namedElsewhere("dc() { :; }\nx=$(dc ps)\n", "dc")).toBe(true);
    expect(namedElsewhere("dc() { :; }\nfoo # then dc\n", "dc")).toBe(false);
  });
});

describe("rule 27 detection", () => {
  const dir = mkdtempSync(join(tmpdir(), "repo-rules-ignore-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

  it("names the secret path that .gitignore lets through", () => {
    execFileSync("git", ["init", "-q"], { cwd: dir, env, stdio: "ignore" });
    mkdirSync(join(dir, "ops"));
    writeFileSync(join(dir, ".gitignore"), ".env.new\n/ops/\n");
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("GIT_")));
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      expect(SECRET_PATHS).toEqual([".env.new", "ops/env.prev", ".env.bak.1"]);
      expect(notIgnored(dir, SECRET_PATHS)).toEqual([".env.bak.1"]);
      writeFileSync(join(dir, ".gitignore"), ".env.new\n/ops/\n.env.bak.*\n");
      expect(notIgnored(dir, SECRET_PATHS)).toEqual([]);
      writeFileSync(join(dir, ".gitignore"), "");
      expect(notIgnored(dir, SECRET_PATHS)).toEqual(SECRET_PATHS);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
