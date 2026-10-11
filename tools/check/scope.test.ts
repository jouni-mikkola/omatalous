import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { changedFiles, scopeOf, workspace } from "./scope.mjs";

const RULES = "tools/repo-rules";
const real = workspace();

describe("check --changed: scope of a diff", () => {
  it("reads the workspace: core is the dependency of server and web", () => {
    expect(real.map((p) => p.dir).sort()).toEqual(["apps/server", "apps/web", "packages/core"]);
    expect(real.find((p) => p.dir === "apps/web")!.deps).toContain("@banking/core");
    expect(real.find((p) => p.dir === "packages/core")!.deps).toEqual([]);
  });

  it("a core change runs core and every package that imports it, the repo rules, and no shell step", () => {
    const s = scopeOf(["packages/core/src/recurring.ts", "packages/core/test/recurring.test.ts"]);
    expect(s).toMatchObject({ full: false, tests: ["apps/server", "apps/web", "packages/core", RULES], lint: false, sh: false });
  });

  it("a server or web change leaves core's tests out", () => {
    expect(scopeOf(["apps/server/src/routes/admin.ts"]).tests).toEqual(["apps/server", RULES]);
    expect(scopeOf(["apps/web/src/pages/Wizard.tsx", "apps/web/src/styles/tokens.css"]).tests).toEqual(["apps/web", RULES]);
  });

  it("docs, fragments, the plan folder and the browser suite run only the repo rules", () => {
    const s = scopeOf(["docs/WORKERS.md", "changelog.d/H2a.md", ".claude/plan/0.9.0/H2a.md", "e2e/app.spec.ts", "README.md"]);
    expect(s).toMatchObject({ full: false, tests: [RULES], lint: false, sh: false });
  });

  it("a shell script, scripts/ and the shell suites turn the lint and the suites on", () => {
    for (const f of ["tools/check.sh", "tools/test/slots.test.sh", "tools/ci/wait.sh", "tools/release/ship.sh", ".claude/hooks/session-start.sh"]) {
      expect(scopeOf([f]), f).toMatchObject({ lint: true, sh: true });
    }
    expect(scopeOf(["scripts/lib/dbcopy.sh"])).toMatchObject({ lint: true, sh: true });
  });

  it("the compose file turns the shell suites on, without the lint", () => {
    expect(scopeOf(["docker-compose.yml"])).toMatchObject({ full: true, lint: false, sh: true });
    expect(scopeOf(["Dockerfile"])).toMatchObject({ lint: false, sh: false });
  });

  it("a tools change runs the tools tests", () => {
    expect(scopeOf(["tools/check/scope.mjs"]).tests).toEqual(["tools", RULES]);
  });

  it("a path that tests read from other places runs all of vitest", () => {
    // the compose file, the changelog and the relay page are read by server and core tests
    for (const f of ["docker-compose.yml", "Dockerfile", "CHANGELOG.md", "relay/callback/index.html", "package.json", "pnpm-lock.yaml", ".github/workflows/release.yml", "contracts/0.8.0/schema.sql"]) {
      expect(scopeOf([f]), f).toMatchObject({ full: true });
    }
  });

  it("one unknown path among known ones still runs everything", () => {
    expect(scopeOf(["docs/WORKERS.md", "apps/server/src/app.ts", "Dockerfile"]).full).toBe(true);
  });

  it("an empty diff runs only the repo rules", () => {
    expect(scopeOf([])).toMatchObject({ full: false, tests: [RULES], lint: false });
  });
});

describe("check --changed: the files of a diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "scope-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });

  it("lists committed, unstaged, deleted and untracked paths since the merge base", () => {
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "docs"));
    for (const f of ["a.txt", "b.txt", "docs/old.md"]) writeFileSync(join(dir, f), "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "work");
    writeFileSync(join(dir, "a.txt"), "2\n");
    git("commit", "-q", "-am", "committed");
    writeFileSync(join(dir, "b.txt"), "2\n");
    rmSync(join(dir, "docs/old.md"));
    writeFileSync(join(dir, "new.txt"), "x\n");
    expect(changedFiles("main", dir)).toEqual(["a.txt", "b.txt", "docs/old.md", "new.txt"]);
    expect(() => changedFiles("no-such-base", dir)).toThrow();
  });
});
