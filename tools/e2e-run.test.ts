import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// e2e/run.mjs under the cut lock, with `flock` itself as the holder. E2E_WORKERS=0 makes a run that gets past the lock
// end at once on its own message, so no server or browser starts.
const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "cut-lock-"));
// a lock file of its own: under `pnpm check` the repository's cut.lock is held shared by the check itself
const lock = join(dir, "cut.lock");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const haveFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;

function runner(env: Record<string, string>) {
  const clean: Record<string, string | undefined> = { ...process.env, E2E_NETNS: "0", E2E_WORKERS: "0", CUT_LOCK_WAIT: "0", CUT_LOCK_FILE: lock };
  delete clean.CUT_LOCK_HELD;
  delete clean.CI;
  return spawnSync(process.execPath, [join(root, "e2e/run.mjs")], { env: { ...clean, ...env }, encoding: "utf8" });
}

/** `flock` holds the lock around a `cat` that waits on its stdin; once it prints "held" the lock is ours. */
async function holding(mode: "-x" | "-s", body: () => void | Promise<void>, file = lock) {
  const holder = spawn("flock", [mode, file, "sh", "-c", "echo held; cat"], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise<void>((ok) => holder.stdout.once("data", () => ok()));
  try {
    await body();
  } finally {
    holder.stdin.end();
    await new Promise((ok) => holder.once("exit", ok));
  }
}

describe.skipIf(!haveFlock)("pnpm e2e and the cut lock", () => {
  it("waits for an exclusive holder, says so once, and ends red naming the lock file", async () => {
    await holding("-x", () => {
      const r = runner({ CUT_LOCK_WAIT: "0" });
      expect(r.status).toBe(1);
      expect(r.stderr.match(/waiting for the cut/g)).toHaveLength(1);
      expect(r.stderr).toContain(`the cut did not end within 0 s: ${lock}`);
      expect(r.stderr).not.toContain("E2E_WORKERS");
    });
  });

  it("stands behind a cut that holds the queue file: says so once and ends red naming that file", async () => {
    const queue = join(dir, "cut.wait");
    await holding(
      "-x",
      () => {
        const r = runner({ CUT_LOCK_WAIT: "0.3" });
        expect(r.status).toBe(1);
        expect(r.stderr.match(/waiting for the cut/g)).toHaveLength(1);
        expect(r.stderr).toContain(`the cut did not end within 0.3 s: ${queue}`);
        expect(r.stderr).not.toContain("E2E_WORKERS");
      },
      queue,
    );
  });

  it("runs beside a shared holder without a word about the cut", async () => {
    await holding("-s", () => {
      const r = runner({ CUT_LOCK_WAIT: "0" });
      expect(r.stderr).not.toContain("the cut");
      expect(r.stderr).toContain('E2E_WORKERS is "0"');
    });
  });

  it("does not lock when the cut itself or CI started the run", async () => {
    await holding("-x", () => {
      for (const env of [{ CUT_LOCK_HELD: "1" }, { CI: "1" }] as Record<string, string>[]) {
        const r = runner(env);
        expect(r.stderr).not.toContain("the cut");
        expect(r.stderr).toContain('E2E_WORKERS is "0"');
      }
    });
    expect(existsSync(lock)).toBe(true);
  });
});

// The stamp of a whole run. A stand-in world: a git repository with the real run.mjs and tools/check/{stamps,key}.sh, a
// stand-in Playwright (the report it writes is the one a scenario asks for), a stand-in server module and a stand-in pnpm
// that only note that they were called. The real Chromium and the real app are not started.
const world = join(dir, "world");
const stamps = join(dir, "stamps");
const calls = join(dir, "calls");
const tmp = join(dir, "tmp");
const left = () => readdirSync(tmp).filter((f) => f.startsWith("e2e-build-"));
const browsers = (name: string) => join(dir, "browsers", name);
const git = (...args: string[]) => spawnSync("git", args, { cwd: world, encoding: "utf8" });
const put = (file: string, text: string) => {
  mkdirSync(dirname(join(world, file)), { recursive: true });
  writeFileSync(join(world, file), text);
};
const commit = (message: string) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
};
let base = "";

const PW_CLI = String.raw`import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
appendFileSync(process.env.FAKE_LOG, "playwright " + process.argv.slice(2).join(" ") + "\n");
appendFileSync(process.env.FAKE_LOG + ".env", (process.env.E2E_BUILD ?? "") + "\n");
const mode = process.env.FAKE_PW ?? "ok";
const one = (status = "expected", results = [{ retry: 0, status: "passed" }]) => ({ status, results });
const tests = [one(), one(), one()];
if (mode === "retry") tests[1] = one("flaky", [{ retry: 0, status: "failed" }, { retry: 1, status: "passed" }]);
if (mode === "skip") tests[1] = one("skipped", [{ retry: 0, status: "skipped" }]);
if (mode === "failexpected") tests[1] = one("expected", [{ retry: 0, status: "failed" }]);
if (mode === "red") tests[1] = one("unexpected", [{ retry: 0, status: "failed" }]);
const n = (status) => tests.filter((t) => t.status === status).length;
const touch = process.env.FAKE_PW_TOUCH;
if (touch === "untracked") { writeFileSync("scratch.tmp", "x"); rmSync("scratch.tmp"); }
if (touch === "back") { const was = readFileSync("src/a.txt"); writeFileSync("src/a.txt", "other"); writeFileSync("src/a.txt", was); }
if (touch === "tracked") writeFileSync("src/a.txt", "other");
if (process.env.PLAYWRIGHT_JSON_OUTPUT_NAME) {
  const stats = { expected: n("expected"), unexpected: n("unexpected"), flaky: n("flaky"), skipped: n("skipped") };
  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ errors: [], stats, suites: [{ specs: [], suites: [{ specs: [{ tests }] }] }] }));
}
console.log("  " + n("expected") + " passed");
process.exit(mode === "red" ? 1 : 0);
`;
const PW_INDEX = `export const request = { newContext: async () => ({ post: async () => ({ ok: () => true, status: () => 200, text: async () => "" }), storageState: async () => {}, dispose: async () => {} }) };\n`;
const SERVER = `import { appendFileSync, existsSync } from "node:fs";\nimport { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\nexport const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");\nexport async function startServer() {\n  const build = process.env.E2E_BUILD ?? "";\n  appendFileSync(process.env.FAKE_LOG, "server " + build + " " + (build !== "" && existsSync(build + "/web/index.html") && existsSync(build + "/node.js")) + "\\n");\n  return { base: "http://127.0.0.1:1", dir: root, setupCode: "x", fakeBank: "{}", stop() {}, log: () => "" };\n}\n`;
const PNPM = [
  "#!/bin/sh",
  'echo "build $*" >>"$FAKE_LOG"',
  // a private build writes the folder it is given, and its bundle names itself on its first line
  '[ -n "${BUILD_OUT_DIR:-}" ] && { mkdir -p "$BUILD_OUT_DIR/web" && echo built >"$BUILD_OUT_DIR/web/index.html" && echo "// talous: private build" >"$BUILD_OUT_DIR/node.js"; }',
  '[ "${FAKE_BUILD:-}" = fail ] && { echo boom >&2; exit 1; }',
  '[ "${FAKE_BUILD:-}" = touch ] && echo changed >>src/a.txt',
  '[ "${FAKE_BUILD:-}" = int ] && kill -INT $PPID',
  "while [ $# -gt 0 ]; do",
  "  case $1 in",
  '    --outDir) mkdir -p "$2" && echo built >"$2/index.html"; shift ;;',
  '    --outfile=*) mkdir -p "$(dirname "${1#--outfile=}")" && echo built >"${1#--outfile=}" ;;',
  "  esac",
  "  shift",
  "done",
  "",
].join("\n");

beforeAll(() => {
  mkdirSync(world, { recursive: true });
  mkdirSync(tmp);
  git("init", "-q");
  mkdirSync(join(world, "tools/check"), { recursive: true });
  for (const file of ["stamps.sh", "key.sh", "reads.txt"]) copyFileSync(join(root, "tools/check", file), join(world, "tools/check", file));
  mkdirSync(join(world, "e2e"));
  copyFileSync(join(root, "e2e/run.mjs"), join(world, "e2e/run.mjs"));
  put("e2e/server.mjs", SERVER);
  put("package.json", '{"name":"world"}\n');
  put("pnpm-workspace.yaml", "packages: []\n");
  put("pnpm-lock.yaml", "lock: 1\n");
  put("src/a.txt", "a\n");
  put(".gitignore", "node_modules/\ndist/\n");
  commit("world");
  base = git("rev-parse", "HEAD").stdout.trim();
  put("node_modules/.pnpm/lock.yaml", "lock: 1\n");
  put("node_modules/@playwright/test/package.json", '{"name":"@playwright/test","type":"module","exports":{".":"./index.js"}}\n');
  put("node_modules/@playwright/test/index.js", PW_INDEX);
  put("node_modules/@playwright/test/cli.js", PW_CLI);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/pnpm"), PNPM);
  chmodSync(join(dir, "bin/pnpm"), 0o755);
  for (const name of ["a/chromium-1", "b/chromium-2"]) mkdirSync(browsers(name), { recursive: true });
});
beforeEach(() => {
  git("reset", "-q", "--hard", base);
  git("clean", "-fdq");
  rmSync(stamps, { recursive: true, force: true });
  writeFileSync(calls, "");
  writeFileSync(`${calls}.env`, "");
});

/** The line the stand-in Playwright logged for a run with these arguments. */
function playwrightLine(args: string[]) {
  writeFileSync(calls, "");
  expect(e2e({}, args).status).toBe(0);
  return readFileSync(calls, "utf8").split("\n").find((l) => l.startsWith("playwright "))!;
}

/** One run of the stand-in world, as a worker's `pnpm e2e`: no lock, no network of its own, one worker. */
function e2e(env: Record<string, string> = {}, args: string[] = []) {
  const run: Record<string, string | undefined> = { ...process.env, CUT_LOCK_HELD: "1", E2E_NETNS: "0", E2E_WORKERS: "1", CHECK_STAMPS_DIR: stamps, FAKE_LOG: calls };
  for (const name of ["CI", "CHECK_FRESH", "SHOTS_DIR", "E2E_SHOTS", "FAKE_BANK_PORT", "CHECK_LOG", "FAKE_PW", "FAKE_PW_TOUCH", "FAKE_BUILD", "NODE_ENV", "PWDEBUG", "PW_TEST_CONNECT_WS_ENDPOINT", "E2E_BUILD"]) delete run[name];
  run.TMPDIR = tmp; // vitest sets NODE_ENV, which the runner refuses; the build folders of a run are counted in `tmp`
  run.PLAYWRIGHT_BROWSERS_PATH = browsers("a");
  run.PATH = `${join(dir, "bin")}:${process.env.PATH}`;
  const r = spawnSync(process.execPath, [join(world, "e2e/run.mjs"), ...args], { cwd: world, env: { ...run, ...env }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const names = () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(" ")[0]);
const stampFiles = () => (existsSync(join(stamps, "e2e")) ? readdirSync(join(stamps, "e2e")).filter((f) => !f.startsWith(".")) : []);
const STAMP_LINE = /^key=[0-9a-f]{64} date=\S+ commit=\S+ worktree=\S+ seconds=\d+ passed=3 skipped=0\n$/;

describe("pnpm e2e and its stamp", { timeout: 60_000 }, () => {
  it("builds, runs and stamps a whole run; the second run is a hit and starts nothing", () => {
    const first = e2e();
    expect(first.status).toBe(0);
    expect(names()).toEqual(["build", "build", "server", "playwright"]);
    expect(stampFiles()).toHaveLength(1);
    expect(readFileSync(join(stamps, "e2e", stampFiles()[0]!), "utf8")).toMatch(STAMP_LINE);
    const second = e2e();
    expect(second.status).toBe(0);
    expect(second.out).toMatch(/^e2e: 3 passed, from a stamp of \d\d:\d\d \(\d+ s then\)$/m);
    expect(names()).toEqual(["build", "build", "server", "playwright"]);
  });

  it("with an argument it neither reads nor writes a stamp, and builds nothing", () => {
    for (const args of [["e2e/a.spec.ts"], ["--grep", "x"], ["--reporter=list"], ["--last-failed"]]) {
      expect(e2e({}, args).status).toBe(0);
      expect(stampFiles()).toEqual([]);
    }
    expect(names()).toEqual(Array(4).fill(["server", "playwright"]).flat());
    expect(e2e().status).toBe(0);
    expect(stampFiles()).toHaveLength(1);
    const before = names().length;
    expect(e2e({}, ["e2e/a.spec.ts"]).out).not.toContain("from a stamp");
    expect(names().length).toBe(before + 2);
  });

  it("writes none for a test that passed on a retry or a skipped one; a test.fail that failed as it should counts as passed", () => {
    for (const mode of ["retry", "skip"]) {
      const r = e2e({ FAKE_PW: mode });
      expect(r.status).toBe(0);
      expect(r.out).toContain("e2e: no stamp written");
      expect(stampFiles()).toEqual([]);
    }
    expect(e2e({ FAKE_PW: "failexpected" }).status).toBe(0);
    expect(stampFiles()).toHaveLength(1);
  });

  it("writes none for a red run", () => {
    expect(e2e({ FAKE_PW: "red" }).status).toBe(1);
    expect(stampFiles()).toEqual([]);
  });

  it("builds the app itself, also when a build is there; a red build starts nothing and writes none", () => {
    mkdirSync(join(world, "dist"), { recursive: true });
    expect(e2e().status).toBe(0);
    expect(names().slice(0, 2)).toEqual(["build", "build"]);
    rmSync(stamps, { recursive: true, force: true });
    writeFileSync(calls, "");
    const red = e2e({ FAKE_BUILD: "fail" });
    expect(red.status).toBe(1);
    expect(red.out).toContain("pnpm build failed");
    expect(names()).toEqual(["build"]);
    expect(stampFiles()).toEqual([]);
  });

  it("writes none when the build changed a tracked file", () => {
    const r = e2e({ FAKE_BUILD: "touch" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("no stamp written, the tree changed while the steps ran");
    expect(stampFiles()).toEqual([]);
  });

  it("neither reads nor writes on a dirty tree, and builds nothing there", () => {
    expect(e2e().status).toBe(0);
    for (const dirty of [() => put("src/a.txt", "changed\n"), () => put("new.txt", "x\n")]) {
      git("reset", "-q", "--hard", base);
      git("clean", "-fdq");
      writeFileSync(calls, "");
      dirty();
      const r = e2e();
      expect(r.status).toBe(0);
      expect(r.out).toContain("the tree is not clean, so no stamp is read or written");
      expect(r.out).not.toContain("from a stamp");
      expect(names()).toEqual(["server", "playwright"]);
      expect(stampFiles()).toHaveLength(1);
    }
  });

  it("is a miss when any tracked file changed, and a hit again when the tree is back", () => {
    e2e();
    put("src/a.txt", "b\n");
    commit("change");
    expect(e2e().out).not.toContain("from a stamp");
    expect(stampFiles()).toHaveLength(2);
    git("reset", "-q", "--hard", base);
    expect(e2e().out).toContain("from a stamp");
  });

  it("CHECK_FRESH runs and still writes", () => {
    e2e();
    expect(e2e({ CHECK_FRESH: "1" }).out).not.toContain("from a stamp");
    expect(names().filter((n) => n === "playwright")).toHaveLength(2);
    rmSync(stamps, { recursive: true, force: true });
    expect(e2e({ CHECK_FRESH: "1" }).status).toBe(0);
    expect(stampFiles()).toHaveLength(1);
  });

  it("takes an empty, half-written or doubled stamp file for a miss and writes it whole", () => {
    e2e();
    const file = join(stamps, "e2e", stampFiles()[0]!);
    const whole = readFileSync(file, "utf8");
    for (const bad of ["", whole.slice(0, 40), `${whole}${whole}`]) {
      writeFileSync(file, bad);
      expect(e2e().out).not.toContain("from a stamp");
      expect(readFileSync(file, "utf8")).toMatch(STAMP_LINE);
    }
  });

  it("writes none when a tracked file was changed during the run, also if it was changed back", () => {
    const back = e2e({ FAKE_PW_TOUCH: "back" });
    expect(back.status).toBe(0);
    expect(back.out).toContain("src/a.txt was touched while the steps ran");
    expect(stampFiles()).toEqual([]);
    expect(e2e({ FAKE_PW_TOUCH: "tracked" }).out).toContain("the tree changed while the steps ran");
    expect(stampFiles()).toEqual([]);
  });

  it("does NOT see an untracked file that appears and is gone again during the run: a known gap, the stamp is written", () => {
    expect(e2e({ FAKE_PW_TOUCH: "untracked" }).status).toBe(0);
    expect(stampFiles()).toHaveLength(1);
  });

  it("reads and writes none with SHOTS_DIR, E2E_SHOTS or FAKE_BANK_PORT set", () => {
    e2e();
    for (const name of ["SHOTS_DIR", "E2E_SHOTS", "FAKE_BANK_PORT", "NODE_ENV", "PWDEBUG", "PW_TEST_CONNECT_WS_ENDPOINT"]) expect(e2e({ [name]: "x" }).out).not.toContain("from a stamp");
    expect(names().filter((n) => n === "build")).toHaveLength(2);
    expect(stampFiles()).toHaveLength(1);
  });

  it("has every name that changes what the page tests find in its key: another value is a miss, the same one a hit", () => {
    const keyed = ["E2E_WORKERS", "TZ", "INSTANCE_NAME", "SESSION_DAYS", "HISTORY_DAYS", "PASSWORD_ITERATIONS", "TRUST_PROXY", "CF_ACCESS_AUD", "CF_ACCESS_TEAM_DOMAIN"];
    e2e();
    for (const name of keyed) {
      const first = e2e({ [name]: "2" }).out;
      expect(first, name).not.toContain("from a stamp");
      const again = e2e({ [name]: "2" }).out;
      expect(again, `${name}
${first}
--
${again}`).toContain("from a stamp");
    }
    expect(stampFiles()).toHaveLength(keyed.length + 1);
    const plain = e2e().out;
    expect(plain, plain).toContain("from a stamp");
  });

  it("writes a whole stamp also when the clock stepped back and the run took a negative time", () => {
    const state = mkdtempSync(join(dir, "state-"));
    const sh = (...args: string[]) => spawnSync("bash", [join(world, "tools/check/stamps.sh"), ...args], { cwd: world, env: { ...process.env, CHECK_FRESH: "", CI: "", CHECK_STAMPS_DIR: stamps }, encoding: "utf8" }); // the gate runs with CHECK_FRESH=1 and CI writes none, so neither is set
    expect(sh("start", state, "e2e", "e2e").status).toBe(0);
    expect(sh("write", state, "e2e", "-1", "3", "0").status).toBe(0);
    expect(stampFiles()).toHaveLength(1);
    expect(readFileSync(join(stamps, "e2e", stampFiles()[0]!), "utf8")).toMatch(STAMP_LINE);
    expect(sh("start", state, "e2e", "e2e").status).toBe(0);
    expect(sh("hit", state, "e2e").stdout).toMatch(/ 0 3 0$/m);
  });

  it("passes --forbid-only to a run without a spec argument, also with options, and not to one with a spec argument", () => {
    for (const args of [[], ["--reporter=list,json"]]) expect(playwrightLine(args)).toContain("--forbid-only");
    for (const args of [["e2e/a.spec.ts"], ["--grep", "x"]]) expect(playwrightLine(args)).not.toContain("--forbid-only");
  });

  it("builds into a folder of its own, serves and tests from it, leaves the tree's dist alone and removes the folder", () => {
    mkdirSync(join(world, "dist"), { recursive: true });
    writeFileSync(join(world, "dist/index.html"), "old\n");
    const before = statSync(join(world, "dist/index.html"));
    expect(e2e().status).toBe(0);
    const after = statSync(join(world, "dist/index.html"));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(readFileSync(join(world, "dist/index.html"), "utf8")).toBe("old\n");
    expect(readdirSync(join(world, "dist"))).toEqual(["index.html"]);
    const server = readFileSync(calls, "utf8").split("\n").find((l) => l.startsWith("server "))!;
    expect(server).toMatch(new RegExp(`^server ${tmp}/e2e-build-\\w+ true$`));
    expect(readFileSync(`${calls}.env`, "utf8").trim()).toBe(server.split(" ")[1]);
    expect(left()).toEqual([]);
    // the nearest pass: with a spec argument nothing is built, the servers take the tree's build and a value of the caller is dropped
    writeFileSync(calls, "");
    expect(e2e({ E2E_BUILD: "/elsewhere" }, ["e2e/a.spec.ts"]).status).toBe(0);
    expect(names()).toEqual(["server", "playwright"]);
    expect(readFileSync(calls, "utf8")).toContain("server  false");
  });

  it("builds a tree's private build into its folder and runs the private specs; a public build skips them with one line", () => {
    put(join("e2e", "private", "a.spec.ts"), "x\n");
    commit("private specs");
    // the public build: the private specs are skipped, said once
    const pub = e2e();
    expect(pub.status).toBe(0);
    expect(readFileSync(calls, "utf8")).toContain("build --filter @banking/server build");
    expect(pub.out.match(/specs of the private modules are skipped/g)).toHaveLength(1);
    // with a build:private script that build runs alone, into the run's folder, and nothing is skipped
    put("package.json", '{"name":"world","scripts":{"build:private":"x"}}\n');
    commit("private build");
    writeFileSync(calls, "");
    const priv = e2e();
    expect(priv.status).toBe(0);
    expect(readFileSync(calls, "utf8").split("\n").filter((l) => l.startsWith("build "))).toEqual(["build run build:private"]);
    expect(readFileSync(calls, "utf8")).toMatch(new RegExp(`^server ${tmp}/e2e-build-\\w+ true$`, "m"));
    expect(priv.out).not.toContain("are skipped");
    expect(left()).toEqual([]);
  });

  it("removes its build folder when the build or the run is red, and when the run is interrupted", () => {
    expect(e2e({ FAKE_BUILD: "fail" }).status).toBe(1);
    expect(left()).toEqual([]);
    expect(e2e({ FAKE_PW: "red" }).status).toBe(1);
    expect(left()).toEqual([]);
    writeFileSync(calls, "");
    expect(e2e({ FAKE_BUILD: "int" }).status).toBe(130);
    expect(names()).toEqual(["build", "build"]); // the signal is handled when the builds are over, before a server starts
    expect(left()).toEqual([]);
  });

  it("has the names of the installed Chromium folders in its key", () => {
    const path = browsers("c");
    mkdirSync(join(path, "chromium-1"), { recursive: true });
    e2e({ PLAYWRIGHT_BROWSERS_PATH: path });
    expect(e2e({ PLAYWRIGHT_BROWSERS_PATH: path }).out).toContain("from a stamp");
    renameSync(join(path, "chromium-1"), join(path, "chromium-2"));
    expect(e2e({ PLAYWRIGHT_BROWSERS_PATH: path }).out).not.toContain("from a stamp");
    expect(stampFiles()).toHaveLength(2);
  });

  it.skipIf(!haveFlock)("stands behind a cut before it reads a stamp", async () => {
    e2e();
    const lockFile = join(dir, "world.lock");
    await holding(
      "-x",
      () => {
        const r = e2e({ CUT_LOCK_HELD: "", CUT_LOCK_FILE: lockFile, CUT_LOCK_WAIT: "0" });
        expect(r.status).toBe(1);
        expect(r.out).toContain("waiting for the cut");
        expect(r.out).not.toContain("from a stamp");
      },
      lockFile,
    );
    expect(e2e({ CUT_LOCK_HELD: "", CUT_LOCK_FILE: lockFile, CUT_LOCK_WAIT: "5" }).out).toContain("from a stamp");
  });

  /** A stand-in tools/wait-quiet.sh that logs each call and answers 3 (busy) until it was called `BUSY_CALLS` times. */
  function standIn() {
    put("tools/wait-quiet.sh", `#!/usr/bin/env bash
echo "wait-quiet $*" >>"$FAKE_LOG"
n=$(grep -c '^wait-quiet' "$FAKE_LOG")
(( n > \${BUSY_CALLS:-0} )) || { echo "busy: vitest (/elsewhere)"; exit 3; }
`);
    commit("wait-quiet"); // a dirty tree neither reads nor writes a stamp
  }

  it("waits for a quiet machine before it builds when CHECK_WAIT=1, one call at a time", () => {
    standIn();
    const r = e2e({ CHECK_WAIT: "1", CHECK_WAIT_CALL: "7", BUSY_CALLS: "2" });
    expect(r.status).toBe(0);
    expect(r.out.match(/busy: vitest/g)).toHaveLength(2);
    expect(names()).toEqual(["wait-quiet", "wait-quiet", "wait-quiet", "build", "build", "server", "playwright"]);
    expect(readFileSync(calls, "utf8")).toContain("wait-quiet --max 7");
  });

  it("runs anyway when the machine stays busy for CHECK_WAIT_MAX", () => {
    standIn();
    const r = e2e({ CHECK_WAIT: "1", BUSY_CALLS: "99", CHECK_WAIT_MAX: "0" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("still busy after");
    expect(names()).toEqual(["wait-quiet", "build", "build", "server", "playwright"]);
  });

  it("does not wait inside a cut or with CHECK_WAIT=0, and a stamp hit waits for nothing", () => {
    standIn();
    expect(e2e({ BUSY_CALLS: "99" }).status).toBe(0); // CUT_LOCK_HELD=1 in e2e(): the default is 0
    expect(names()).not.toContain("wait-quiet");
    writeFileSync(calls, "");
    expect(e2e({ CHECK_WAIT: "0", BUSY_CALLS: "99", CUT_LOCK_HELD: "" }).status).toBe(0);
    expect(names()).not.toContain("wait-quiet");
    writeFileSync(calls, "");
    expect(e2e({ CHECK_WAIT: "1", BUSY_CALLS: "99" }).out).toContain("from a stamp");
    expect(names()).toEqual([]);
  });
});
