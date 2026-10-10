/**
 * tools/release/prepare.mjs against throwaway git repositories: the files it writes, the checks release.yml and
 * publish-public.sh run on the result, and each refusal. The real CHANGELOG.md and version files are never touched.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./prepare.mjs", import.meta.url));
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env: ENV, encoding: "utf8" }).trim();

function put(dir: string, path: string, text: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}
const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

/** A repository that looks like the app at `version`: version files, a CHANGELOG, the README of changelog.d and one migration. */
function repo(version = "0.5.1", tag?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prepare-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  put(dir, "apps/server/src/version.ts", `/** The release version. */\nexport const APP_VERSION = "${version}";\n`);
  for (const p of ["apps/server", "apps/web", "packages/core"]) {
    put(dir, `${p}/package.json`, `{\n  "name": "@banking/${p.split("/")[1]}",\n  "version": "${version}",\n  "private": true\n}\n`);
  }
  put(dir, "CHANGELOG.md", `# Changes\n\nUpdate with the script.\n\n## ${version}\n\n- An old entry.\n`);
  put(dir, "changelog.d/README.md", "How fragments work.\n");
  put(dir, "apps/server/migrations/0001_init.sql", "CREATE TABLE a (x INTEGER);\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  if (tag) git(dir, "tag", tag);
  return dir;
}

function fragment(dir: string, name: string, text: string) {
  put(dir, `changelog.d/${name}.md`, text);
}
function commitAll(dir: string, msg = "work") {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}
function run(dir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const bash = (dir: string, script: string) => execFileSync("bash", ["-c", script], { cwd: dir, encoding: "utf8" });

describe("tools/release/prepare.mjs", () => {
  it("bumps the four version files, groups the fragments by section and removes them", () => {
    const dir = repo();
    fragment(dir, "B1", "section: For developers\nRepo tools are faster.\nupgrade: Nothing to do by hand.\n");
    fragment(dir, "A1", "section: Look\n- The page is calmer.\n  It has one theme.\n- Second entry.\n");
    fragment(dir, "A2", "section: Money and reports\nA refund cancels its payment.\nupgrade: Run the update once.\n");
    commitAll(dir);

    const r = run(dir, "0.6.0");
    expect(r.code).toBe(0);

    const log = read(dir, "CHANGELOG.md");
    const expected = [
      "# Changes\n\nUpdate with the script.\n\n## 0.6.0\n\n",
      "Money and reports\n\n- A refund cancels its payment.\n\n",
      "Look\n\n- The page is calmer. It has one theme.\n- Second entry.\n\n",
      "For developers\n\n- Repo tools are faster.\n\n",
      // fragments in file name order
      "Upgrade\n\n- Run the update once.\n- Nothing to do by hand.\n\n",
      "## 0.5.1\n\n- An old entry.\n",
    ].join("");
    expect(log).toBe(expected);
    expect(read(dir, "apps/server/src/version.ts")).toContain('export const APP_VERSION = "0.6.0";');
    for (const p of ["apps/server/package.json", "apps/web/package.json", "packages/core/package.json"]) {
      expect(JSON.parse(read(dir, p)).version).toBe("0.6.0");
      expect(read(dir, p)).toBe(`{\n  "name": "@banking/${p.split("/")[1]}",\n  "version": "0.6.0",\n  "private": true\n}\n`);
    }
    expect(existsSync(join(dir, "changelog.d/A1.md"))).toBe(false);
    expect(existsSync(join(dir, "changelog.d/README.md"))).toBe(true);

    // the commands release.yml (plan, release notes) and publish-public.sh run on the result
    expect(bash(dir, `sed -n 's/^## \\([^ ]*\\).*/\\1/p' CHANGELOG.md | head -1`).trim()).toBe("0.6.0");
    expect(bash(dir, `sed -n 's/^export const APP_VERSION = "\\(.*\\)";$/\\1/p' apps/server/src/version.ts`).trim()).toBe("0.6.0");
    expect(bash(dir, `sed -n 's/^  "version": "\\(.*\\)",\\{0,1\\}$/\\1/p' apps/server/package.json | head -1`).trim()).toBe("0.6.0");
    const notes = bash(dir, `awk -v v=0.6.0 '/^## /{p = ($2 == v); next} p' CHANGELOG.md`);
    expect(notes).toContain("- A refund cancels its payment.");
    expect(notes).not.toContain("An old entry");
  });

  it("--dry-run prints the section and writes nothing", () => {
    const dir = repo();
    fragment(dir, "A1", "section: Maintenance\n- One line.\n");
    commitAll(dir);
    const r = run(dir, "0.5.2", "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("## 0.5.2\n\nMaintenance\n\n- One line.");
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("refuses a version that is not above the newest release tag or the current version", () => {
    const dir = repo("0.5.1", "v0.5.1");
    fragment(dir, "A1", "section: Look\n- x\n");
    commitAll(dir);
    for (const v of ["0.5.1", "0.5.0", "0.4.9"]) {
      const r = run(dir, v);
      expect(r.code, v).toBe(1);
      expect(r.err).toContain("is not above");
    }
    // a newer tag than the tree's version counts as well
    git(dir, "tag", "v0.9.0");
    const r = run(dir, "0.6.0");
    expect(r.code).toBe(1);
    expect(r.err).toContain("newest release v0.9.0");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(read(dir, "apps/server/src/version.ts")).toContain('"0.5.1"');
    // numbers, not text: 0.10.0 is above 0.9.0
    expect(run(dir, "0.10.0", "--dry-run").code).toBe(0);
  });

  it("refuses what is not a version", () => {
    const dir = repo();
    for (const v of ["0.6", "v0.6.0", "0.6.0-rc1", "06.0.0"]) expect(run(dir, v).code, v).toBe(1);
    expect(run(dir).code).toBe(1);
  });

  it("needs an upgrade line when a migration was added since the last release tag", () => {
    const dir = repo("0.5.1", "v0.5.1");
    put(dir, "apps/server/migrations/0002_more.sql", "CREATE TABLE b (y INTEGER);\n");
    fragment(dir, "A1", "section: Reliability\n- A new table.\n");
    commitAll(dir);

    const refused = run(dir, "0.6.0");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("0002_more.sql");
    expect(refused.err).toContain("upgrade:");
    expect(read(dir, "CHANGELOG.md")).not.toContain("0.6.0");
    expect(existsSync(join(dir, "changelog.d/A1.md"))).toBe(true);

    fragment(dir, "A1", "section: Reliability\n- A new table.\nupgrade: Migration 0002 runs on the first start.\n");
    commitAll(dir);
    const ok = run(dir, "0.6.0");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("0002_more.sql");
    expect(read(dir, "CHANGELOG.md")).toContain("Upgrade\n\n- Migration 0002 runs on the first start.\n");
  });

  it("an edited migration is not a new one, and a migration before the tag is not new", () => {
    const dir = repo();
    put(dir, "apps/server/migrations/0002_old.sql", "CREATE TABLE c (z INTEGER);\n");
    commitAll(dir);
    git(dir, "tag", "v0.5.1");
    put(dir, "apps/server/migrations/0001_init.sql", "CREATE TABLE a (x INTEGER, w INTEGER);\n");
    fragment(dir, "A1", "section: Look\n- x\n");
    commitAll(dir);
    expect(run(dir, "0.6.0").code).toBe(0);
  });

  it("without release tags the newest commit in upgrade-from.txt is the base, and --since replaces it", () => {
    const dir = repo();
    const base = git(dir, "rev-parse", "--short", "HEAD");
    put(dir, ".github/upgrade-from.txt", `# baselines\n${base}\n`);
    put(dir, "apps/server/migrations/0002_more.sql", "CREATE TABLE b (y INTEGER);\n");
    fragment(dir, "A1", "section: Look\n- x\n");
    commitAll(dir);

    expect(run(dir, "0.6.0").err).toContain("0002_more.sql");
    // the migration is in HEAD, so from HEAD there is nothing new
    const r = run(dir, "0.6.0", "--since", "HEAD");
    expect(r.code).toBe(0);
  });

  it("refuses a missing, late, unknown or doubled section line, an empty fragment and no fragments at all", () => {
    const dir = repo();
    expect(run(dir, "0.6.0").err).toContain("No fragments");
    const bad: [string, string, string][] = [
      ["a", "Just text.\nsection: Look\n", "comes before the section line"],
      ["f", "upgrade: Run it twice.\n", "no \"section: <name>\" line"],
      ["b", "section: Fun\n- x\n", 'unknown section "Fun"'],
      ["c", "section: Look\nsection: Look\n- x\n", "two section lines"],
      ["d", "section: Look\n", "no text"],
      ["e", "section: Look\n- x\nupgrade:\n", "has no text"],
    ];
    for (const [name, text, why] of bad) {
      fragment(dir, name, text);
      commitAll(dir);
      const r = run(dir, "0.6.0");
      expect(r.code, name).toBe(1);
      expect(r.err, name).toContain(why);
      git(dir, "rm", "-q", `changelog.d/${name}.md`);
      commitAll(dir);
    }
  });

  it("refuses an Unreleased section, uncommitted fragments and disagreeing versions", () => {
    const dir = repo();
    fragment(dir, "A1", "section: Look\n- x\n");
    // untracked: it would be deleted without a trace
    expect(run(dir, "0.6.0").err).toContain("Uncommitted changes");
    commitAll(dir);

    put(dir, "CHANGELOG.md", "# Changes\n\n## Unreleased\n\n- Pending.\n\n## 0.5.1\n\n- Old.\n");
    commitAll(dir);
    expect(run(dir, "0.6.0").err).toContain("Unreleased");
    git(dir, "reset", "-q", "--hard", "HEAD~1");

    put(dir, "apps/web/package.json", '{\n  "version": "0.5.0"\n}\n');
    commitAll(dir);
    expect(run(dir, "0.6.0").err).toContain("apps/web/package.json is 0.5.0");
  });
});
