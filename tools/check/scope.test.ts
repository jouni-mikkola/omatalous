import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { changedFiles, diffTexts, loadCorpus, scopeOf, uiTokens, workspace } from "./scope.mjs";

const RULES = "tools/repo-rules";
const UI_STRINGS = "tools/ui-strings.test.ts";
const real = workspace();

describe("check --changed: scope of a diff", () => {
  it("reads the workspace: core is the dependency of server and web", () => {
    expect(real.map((p) => p.dir).sort()).toEqual(["apps/server", "apps/web", "packages/core"]);
    expect(real.find((p) => p.dir === "apps/web")!.deps).toContain("@banking/core");
    expect(real.find((p) => p.dir === "packages/core")!.deps).toEqual([]);
  });

  it("a core change runs core and every package that imports it, the repo rules, and no shell step", () => {
    const s = scopeOf(["packages/core/src/recurring.ts", "packages/core/test/recurring.test.ts"]);
    expect(s).toMatchObject({ full: false, tests: ["apps/server", "apps/web", "packages/core", RULES, UI_STRINGS], lint: false, sh: false });
  });

  it("a feature module's folder and its generated registry run core, its dependents and the repo rules; its test file is a vitest file", () => {
    const s = scopeOf(["packages/core/src/features/insight/price-rises/index.ts", "packages/core/src/features/insight/registry.gen.ts"]);
    expect(s).toMatchObject({ full: false, tests: ["apps/server", "apps/web", "packages/core", RULES, UI_STRINGS], sh: false });
    expect(scopeOf(["apps/web/src/features/view/prices/View.test.ts"]).tests).toEqual(["apps/web", RULES, UI_STRINGS]);  });

  it("a server or web change leaves core's tests out", () => {
    expect(scopeOf(["apps/server/src/routes/admin.ts"]).tests).toEqual(["apps/server", RULES, UI_STRINGS]);
    expect(scopeOf(["apps/web/src/pages/Wizard.tsx", "apps/web/src/styles/tokens.css"]).tests).toEqual(["apps/web", RULES, UI_STRINGS]);
  });

  it("a change in the src/ of a package also runs the suite that pins the UI sentences, and a test or a tools change does not add it", () => {
    for (const f of ["packages/core/src/wording.ts", "apps/server/src/services/upgrade.ts", "apps/web/src/pages/Bills.tsx"]) {
      expect(scopeOf([f]).tests, f).toContain(UI_STRINGS);
    }
    for (const f of ["packages/core/test/ahead.test.ts", "apps/web/test/next-days.test.ts", "apps/web/package.json", "docs/INSTALL.md"]) {
      expect(scopeOf([f]).tests, f).not.toContain(UI_STRINGS);
    }
    // a tools change runs all of tools/, which holds it already: it is listed once, under the folder
    expect(scopeOf(["tools/check/scope.mjs", "apps/web/src/pages/Bills.tsx"]).tests).toEqual(["apps/web", RULES, "tools"].sort());
  });

  it("docs, fragments, the .claude folder and the browser suite run only the repo rules", () => {
    const s = scopeOf(["docs/INSTALL.md", "changelog.d/H2a.md", ".claude/notes/H2a.md", "e2e/app.spec.ts", "README.md"]);
    expect(s).toMatchObject({ full: false, tests: [RULES], lint: false, sh: false });
  });

  it("a shell script, scripts/ and the shell suites turn the lint and the suites on", () => {
    for (const f of ["tools/check.sh", "tools/test/slots.test.sh", "tools/ci/wait.sh", "scripts/lib/release.sh"]) {
      expect(scopeOf([f]), f).toMatchObject({ lint: true, sh: true });
    }
    expect(scopeOf(["scripts/lib/dbcopy.sh"])).toMatchObject({ lint: true, sh: true });
    // a hook that only a vitest file names turns the lint on and no suite
    expect(scopeOf([".claude/hooks/session-start.sh"])).toMatchObject({ lint: true });
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
    expect(scopeOf(["docs/INSTALL.md", "apps/server/src/app.ts", "Dockerfile"]).full).toBe(true);
  });

  it("an empty diff runs only the repo rules", () => {
    expect(scopeOf([])).toMatchObject({ full: false, tests: [RULES], lint: false });
  });
});

describe("check --changed: a shell file narrows the suites and tests by name", () => {
  // two scripts that source one library, a script that only mentions it in a comment, one that nothing names, and the
  // suites and vitest files that name them
  const corpus = {
    shell: {
      "scripts/backup.sh": ". scripts/lib/dbcopy.sh\nbackup\n",
      "scripts/restore.sh": '. "$ROOT/scripts/lib/dbcopy.sh"\nrestore\n',
      "scripts/update.sh": "# . scripts/lib/dbcopy.sh would go here\nupdate\n",
      "scripts/lib/dbcopy.sh": "copy() { :; }\n",
      "scripts/orphan.sh": "echo nobody names me\n",
      "scripts/solo.sh": "echo solo\n",
      "tools/slots.sh": "echo slots\n",
      "tools/test/fake-host.sh": "echo host\n",
      "tools/test/backup.test.sh": 'bash "$SRC/scripts/backup.sh"\n',
      "tools/test/restore.test.sh": 'bash "$SRC/scripts/restore.sh"\n',
      "tools/test/update.test.sh": "bash scripts/update.sh\n",
      "tools/test/doctor.test.sh": '. "$HERE/fake-host.sh"\n',
      "tools/test/install.test.sh": '. "$HERE/fake-host.sh"\n',
      "tools/test/slots.test.sh": "bash tools/slots.sh\n",
      "tools/test/other.test.sh": "ops-backup.sh, my.restore.sh and backup.sh-old are other files\n",
    },
    vitest: {
      "apps/server/test/ops.test.ts": 'readFileSync(new URL("../../../scripts/solo.sh", import.meta.url))',
      "tools/check/thing.test.ts": 'run("scripts/lib/dbcopy.sh")',
      "packages/core/test/unrelated.test.ts": "nothing here",
    },
  };
  const scope = (files: string[]) => scopeOf(files, real, corpus);

  it("a script with one suite runs that suite and the repo rules, not all of vitest", () => {
    expect(scope(["scripts/backup.sh"])).toMatchObject({ full: false, tests: [RULES], lint: true, sh: true, suites: ["tools/test/backup.test.sh"], why: "" });
  });

  it("a library runs the suites of every script that sources it, and the tests that name it", () => {
    const s = scope(["scripts/lib/dbcopy.sh"]);
    // update.sh only has the library in a comment
    expect(s).toMatchObject({ full: false, lint: true, sh: true, suites: ["tools/test/backup.test.sh", "tools/test/restore.test.sh"] });
    expect(s.tests).toEqual(["tools/check/thing.test.ts", RULES]);
  });

  it("a script nothing names runs all of vitest and every suite", () => {
    expect(scope(["scripts/orphan.sh"])).toMatchObject({ full: true, tests: [], lint: true, sh: true, suites: null, why: "scripts/orphan.sh is named by no suite or test" });
  });

  it("one unnamed script among named ones still runs everything", () => {
    expect(scope(["scripts/backup.sh", "scripts/orphan.sh"])).toMatchObject({ full: true, suites: null });
  });

  it("a script that only a vitest file names runs that file and no suite", () => {
    expect(scope(["scripts/solo.sh"])).toMatchObject({ full: false, tests: ["apps/server/test/ops.test.ts", RULES], lint: true, sh: false, suites: [] });
  });

  it("a name inside another file name does not count", () => {
    expect(scope(["scripts/backup.sh"]).suites).not.toContain("tools/test/other.test.sh");
    expect(scope(["scripts/restore.sh"]).suites).toEqual(["tools/test/restore.test.sh"]);
  });

  it("a tools script runs its suite and no tools tests", () => {
    expect(scope(["tools/slots.sh"])).toMatchObject({ full: false, tests: [RULES], suites: ["tools/test/slots.test.sh"] });
  });

  it("a changed suite runs itself, and a helper that suites source runs them all", () => {
    expect(scope(["tools/test/slots.test.sh"]).suites).toEqual(["tools/test/slots.test.sh"]);
    expect(scope(["tools/test/fake-host.sh"]).suites).toEqual(["tools/test/doctor.test.sh", "tools/test/install.test.sh"]);
  });

  it("scripts next to package changes: vitest by package, the suites by name", () => {
    const s = scope(["scripts/backup.sh", "apps/web/src/main.tsx"]);
    expect(s).toMatchObject({ full: false, tests: ["apps/web", RULES, UI_STRINGS], suites: ["tools/test/backup.test.sh"] });
  });

  it("the compose file runs every suite whatever else changed", () => {
    expect(scope(["docker-compose.yml", "scripts/backup.sh"])).toMatchObject({ full: true, sh: true, suites: null });
  });

  it("a diff without a shell file runs no suite", () => {
    expect(scopeOf(["apps/server/src/app.ts"], real)).toMatchObject({ sh: false, suites: [] });
  });

  it("in this checkout a backup.sh edit runs the backup suite and not a suite that never names it", () => {
    const s = scopeOf(["scripts/backup.sh"], real);
    expect(s).toMatchObject({ full: false, lint: true, sh: true });
    expect(s.suites).toContain("tools/test/backup.test.sh");
    expect(s.suites).not.toContain("tools/test/wait.test.sh");
  });
});

describe("check --changed: the shell and test files of a checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "corpus-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });

  it("reads tracked and untracked shell and vitest files, and leaves out ignored, deleted and other ones", () => {
    git("init", "-q", "-b", "main");
    for (const d of ["tools/test", "apps/server/test", "apps/server/src", "docs"]) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "skip.sh\n");
    for (const [f, text] of Object.entries({
      "run.sh": "run\n",
      "gone.sh": "gone\n",
      "tools/test/run.test.sh": "bash run.sh\n",
      "apps/server/test/a.test.ts": "run.sh\n",
      "apps/server/src/a.ts": "run.sh in a source file\n",
      "docs/note.md": "run.sh\n",
    })) {
      writeFileSync(join(dir, f), text);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    rmSync(join(dir, "gone.sh"));
    writeFileSync(join(dir, "new.sh"), "new\n");
    writeFileSync(join(dir, "skip.sh"), "ignored\n");
    const c = loadCorpus(dir);
    expect(Object.keys(c.shell).sort()).toEqual(["new.sh", "run.sh", "tools/test/run.test.sh"]);
    expect(Object.keys(c.vitest)).toEqual(["apps/server/test/a.test.ts"]);
    expect(c.shell["new.sh"]).toBe("new\n");
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

describe("check --changed: tests that read a changed file as text", () => {
  const SHOTS = ["tools/shots-a.test.ts", "tools/shots-b.test.ts", "tools/shots-c.test.ts"];
  const corpus = {
    shell: {},
    vitest: {
      "tools/shots-a.test.ts": "run('overview')",
      "tools/shots-b.test.ts": "run('bills')",
      "tools/shots-c.test.ts": "run('loans')",
      "tools/css-lint.test.ts": 'readFileSync(join(ROOT, "apps/web/src/styles/tokens.css"))',
      "apps/server/test/changelog.test.ts": 'readFileSync("CHANGELOG.md")',
      "apps/server/test/by-name.test.ts": 'join(dir, "legacy.css")',
      "apps/server/test/index.test.ts": 'readFileSync("apps/server/src/index.ts")',
      "packages/core/test/unrelated.test.ts": "nothing here",
    },
    e2e: {
      "e2e/bills.spec.ts": 'import { go } from "./helpers";\nawait page.locator(".bill-row").click();\nawait expect(page.getByText("Tulevat maksut")).toBeVisible();',
      "e2e/settings.spec.ts": 'import { go } from "./helpers";\nawait page.getByRole("button", { name: "Tallenna" }).click();',
      "e2e/loans.spec.ts": 'await page.goto("/loans"); // a .bill-row-extra table is not the bill row',
    },
  };
  const scope = (files: string[], diffs: Record<string, string> = {}) => scopeOf(files, real, corpus, diffs);

  it("a changed stylesheet brings the pictures tests and the test that reads it by path", () => {
    const s = scope(["apps/web/src/styles/tokens.css"], { "apps/web/src/styles/tokens.css": ".other { gap: 1px; }\n" });
    expect(s.readers).toEqual(["tools/css-lint.test.ts", ...SHOTS]);
    expect(s.tests).toEqual(expect.arrayContaining(["apps/web", RULES, ...SHOTS, "tools/css-lint.test.ts"]));
    expect(s.e2e).toEqual([]);
  });

  it("a stylesheet named only by its file name is found, and a generic file name needs its whole path", () => {
    expect(scope(["apps/web/src/legacy.css"]).readers).toContain("apps/server/test/by-name.test.ts");
    expect(scope(["packages/core/src/index.ts"]).readers).toEqual([]);
    expect(scope(["apps/server/src/index.ts"]).readers).toEqual(["apps/server/test/index.test.ts"]);
    // the root note that a server test reads is no longer left out
    expect(scope(["CHANGELOG.md"]).readers).toEqual(["apps/server/test/changelog.test.ts"]);
  });

  it("a changed class name brings the spec that names it, whole word only", () => {
    const css = { "apps/web/src/styles/tokens.css": ".bill-row {\n  display: grid;\n}\n.bill-row:hover, .other-thing {\n" };
    expect(scope(["apps/web/src/styles/tokens.css"], css).e2e).toEqual(["e2e/bills.spec.ts"]);
    const tsx = { "apps/web/src/pages/Bills.tsx": '<li className={cx("bill-row", open && "is-open")}>' };
    expect(scope(["apps/web/src/pages/Bills.tsx"], tsx).e2e).toEqual(["e2e/bills.spec.ts"]);
  });

  it("a changed UI sentence brings the spec that reads it, the old text too, and the pictures tests", () => {
    const old = { "apps/web/src/pages/Bills.tsx": "<h2>Tulevat maksut</h2>\n<h2>Erapaivat</h2>" };
    const s = scope(["apps/web/src/pages/Bills.tsx"], old);
    expect(s.e2e).toEqual(["e2e/bills.spec.ts"]);
    expect(s.readers).toEqual(SHOTS);
    expect(scope(["packages/core/src/wording.ts"], { "packages/core/src/wording.ts": 'const a = "Tallenna";' }).e2e).toEqual(["e2e/settings.spec.ts"]);
  });

  it("an unrelated change brings neither the pictures tests nor a spec", () => {
    const s = scope(["packages/core/src/money.ts"], { "packages/core/src/money.ts": "export const cents = 2;\nconst key = 'abc-def';\n" });
    expect(s).toMatchObject({ readers: [], e2e: [], tests: ["apps/server", "apps/web", "packages/core", RULES, UI_STRINGS] });
    // a web source that changes logic and no sentence is no picture either
    expect(scope(["apps/web/src/lib/sum.ts"], { "apps/web/src/lib/sum.ts": "return a + b;" }).readers).toEqual([]);
  });

  it("a changed spec runs itself, and a changed helper the specs that import it", () => {
    expect(scope(["e2e/loans.spec.ts"]).e2e).toEqual(["e2e/loans.spec.ts"]);
    expect(scope(["e2e/helpers.ts"]).e2e).toEqual(["e2e/bills.spec.ts", "e2e/settings.spec.ts"]);
    expect(scope(["e2e/gone.spec.ts"]).e2e).toEqual([]);
  });

  it("without a corpus nothing is read as text", () => {
    expect(scopeOf(["apps/web/src/styles/tokens.css"], real)).toMatchObject({ readers: [], e2e: [], tests: ["apps/web", RULES, UI_STRINGS] });
  });

  it("reads class names and sentences from changed lines and leaves code, paths and ids out", () => {
    const tsx = [
      'import { Row } from "./Row";',
      "// Tallenna in a comment",
      '<div className="card wide" data-id="row-1">',
      "  <h2>Tulevat maksut</h2>",
      '  <button title="Poista" onClick={() => go("/bills/new")}>Lisää tilitys {name}</button>',
      "  Pelkkä teksti",
      "  const key = `${a}-b`; const id = 'user_id'; fetch('/api/x');",
    ].join("\n");
    expect(uiTokens("apps/web/src/pages/Bills.tsx", tsx)).toEqual({
      classes: ["card", "wide"],
      strings: ["Lisää tilitys", "Pelkkä teksti", "Poista", "Tulevat maksut"],
    });
    expect(uiTokens("apps/web/src/styles/a.css", ".bill-row > .cell,\n.x {\n  margin: 0.5rem;\n  background: url(a.png);\n}\n/* .comment */")).toEqual({ classes: ["bill-row", "cell"], strings: [] });
  });
});

describe("check --changed: the changed lines of source files", () => {
  const dir = mkdtempSync(join(tmpdir(), "diffs-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });

  it("holds the added and removed lines of a tracked file, a deleted one and a new one whole, and no other file", () => {
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "apps/web/src/pages"), { recursive: true });
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "apps/web/src/pages/A.tsx"), "<h1>Vanha</h1>\n<p>Sama</p>\n");
    writeFileSync(join(dir, "apps/web/src/pages/B.tsx"), "<h1>Poistettu</h1>\n");
    writeFileSync(join(dir, "docs/a.md"), "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "work");
    writeFileSync(join(dir, "apps/web/src/pages/A.tsx"), "<h1>Uusi</h1>\n<p>Sama</p>\n");
    rmSync(join(dir, "apps/web/src/pages/B.tsx"));
    writeFileSync(join(dir, "apps/web/src/pages/C.tsx"), "<h1>Kolmas</h1>\n");
    writeFileSync(join(dir, "docs/a.md"), "2\n");
    const files = changedFiles("main", dir);
    const d = diffTexts("main", files, dir);
    expect(Object.keys(d).sort()).toEqual(["apps/web/src/pages/A.tsx", "apps/web/src/pages/B.tsx", "apps/web/src/pages/C.tsx"]);
    expect(d["apps/web/src/pages/A.tsx"]!.split("\n").sort()).toEqual(["<h1>Uusi</h1>", "<h1>Vanha</h1>"]);
    expect(d["apps/web/src/pages/B.tsx"]).toBe("<h1>Poistettu</h1>");
    expect(d["apps/web/src/pages/C.tsx"]).toBe("<h1>Kolmas</h1>\n");
  });
});
