/**
 * The plan script of the release workflow (tools/ci/release-plan.sh), run in a stand-in repository: which version a run
 * releases or builds, if any, and that the tree agrees with it. The workflow's own shape is in release-workflow.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "../repo-rules/lib.ts";

// ── the plan script in a stand-in repository ─────────────────────────────────────────────────────────────────────
// tools/ci/release-plan.sh runs in a repository with a main (a version 1.1.0 with its tag) and a commit on top of it that
// brings 1.2.0; `gh` is a stand-in that answers 404 unless told a release exists.
const PLAN = resolve(ROOT, "tools/ci/release-plan.sh");
const GIT_ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

interface Plan {
  code: number;
  text: string;
  out: Record<string, string>;
}

describe("tools/ci/release-plan.sh", () => {
  const dirs: string[] = [];
  const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  function files(dir: string, version: string, changelog = version) {
    mkdirSync(join(dir, "apps/server/src"), { recursive: true });
    mkdirSync(join(dir, "apps/web"), { recursive: true });
    mkdirSync(join(dir, "packages/core"), { recursive: true });
    writeFileSync(join(dir, "apps/server/src/version.ts"), `export const APP_VERSION = "${version}";\n`);
    for (const p of ["apps/server", "apps/web", "packages/core"]) writeFileSync(join(dir, p, "package.json"), `{"name":"x","version":"${version}"}\n`);
    writeFileSync(join(dir, "CHANGELOG.md"), `# Changelog\n\n## ${changelog}\n\n- A line.\n\n## 1.1.0\n\n- Older.\n`);
  }

  /** A stand-in: main at M (1.1.0, tag v1.1.0, origin/main), the commit C on top of it (1.2.0) checked out on `branch`. */
  function standIn(branch: string, opts: { version?: string; changelog?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "release-plan-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    files(dir, "1.1.0");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "M");
    git(dir, "tag", "v1.1.0");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "checkout", "-q", "-B", branch);
    files(dir, opts.version ?? "1.2.0", opts.changelog);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "C");
    const bin = join(dir, ".bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), '#!/usr/bin/env bash\ncase ${GH_FAKE:-404} in exists) echo "{}"; exit 0 ;; other) echo "gh: HTTP 500"; exit 1 ;; *) echo "gh: Not Found (HTTP 404)"; exit 1 ;; esac\n');
    chmodSync(join(bin, "gh"), 0o755);
    return dir;
  }

  function plan(dir: string, env: Record<string, string>): Plan {
    const out = join(dir, ".out");
    writeFileSync(out, "");
    const base: Record<string, string> = { EVENT: "push", REF: "refs/heads/main", REF_NAME: "main", SIGNED_BY_HAND: "false", DRY_RUN: "false", GH_REPO: "o/r", GH_TOKEN: "x" };
    try {
      const text = execFileSync("bash", [PLAN], {
        cwd: dir,
        env: { PATH: `${join(dir, ".bin")}:${process.env.PATH}`, HOME: dir, ...GIT_ENV, ...base, ...env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, ".summary") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, text, out: parseOut(out) };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, text: `${err.stdout}${err.stderr}`, out: parseOut(out) };
    }
  }
  const parseOut = (f: string) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const onBranch = (branch: string) => ({ REF: `refs/heads/${branch}`, REF_NAME: branch });

  it("has no CI-only syntax and passes a syntax check", () => {
    execFileSync("bash", ["-n", PLAN]);
    expect(readFileSync(PLAN, "utf8")).not.toMatch(/\$\{\{/);
    // the step it came from ran without pipefail, and `sed | head -1` on the changelog would fail with it
    expect(readFileSync(PLAN, "utf8")).toMatch(/^set -eu$/m);
  });

  it("plans a release on main for a version with no tag, as the workflow step did", () => {
    const dir = standIn("main");
    expect(plan(dir, {})).toMatchObject({ code: 0, out: { release: "true", dry_run: "false", version: "1.2.0", tag: "v1.2.0", new_tag: "true" } });
    expect(plan(dir, {}).out.candidate).toBeUndefined();
  });

  it("does nothing on main for a version that has its tag, and refuses a run started by hand", () => {
    const dir = standIn("main");
    git(dir, "tag", "v1.2.0");
    const r = plan(dir, {});
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ release: "false" });
    expect(plan(dir, { EVENT: "workflow_dispatch", SIGNED_BY_HAND: "true" }).text).toMatch(/Tag v1.2.0 exists already/);
    expect(plan(dir, { EVENT: "workflow_dispatch" }).text).toMatch(/Installs before 0.5.1 refuse/);
  });

  it("plans the release of a tag push, and refuses a tag whose release exists or whose version differs", () => {
    const dir = standIn("main");
    git(dir, "tag", "v1.2.0");
    const tag = { REF: "refs/tags/v1.2.0", REF_NAME: "v1.2.0" };
    expect(plan(dir, tag)).toMatchObject({ code: 0, out: { release: "true", new_tag: "false", tag: "v1.2.0" } });
    expect(plan(dir, { ...tag, GH_FAKE: "exists" }).out).toEqual({ release: "false" });
    expect(plan(dir, { ...tag, GH_FAKE: "other" }).text).toMatch(/Could not ask GitHub/);
    expect(plan(standIn("main", { changelog: "1.1.5" }), { ...tag }).text).toMatch(/CHANGELOG top heading is 1\.1\.5, tag is 1\.2\.0/);
  });

  it("rehearses on main only", () => {
    const dir = standIn("main");
    expect(plan(dir, { EVENT: "workflow_dispatch", DRY_RUN: "true" })).toMatchObject({ code: 0, out: { release: "false", dry_run: "true", version: "1.2.0" } });
    expect(plan(dir, { EVENT: "workflow_dispatch", DRY_RUN: "true", ...onBranch("candidate/1.2.0-abc1234") }).text).toMatch(/Run it on main/);
  });

  it("plans a candidate: the version is the branch name's, no release, no signing", () => {
    const dir = standIn("candidate/1.2.0-abc1234");
    const r = plan(dir, onBranch("candidate/1.2.0-abc1234"));
    expect(r).toMatchObject({ code: 0, out: { release: "false", dry_run: "false", candidate: "true", version: "1.2.0", tag: "v1.2.0", new_tag: "false" } });
    expect(readFileSync(join(dir, ".summary"), "utf8")).toMatch(/Candidate 1\.2\.0/);
  });

  it("stops when git cannot list the tags, on main and on a candidate, instead of reading it as no tag", () => {
    const realGit = execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    /** A git that fails for `tag` and is the real one for everything else. */
    const breakTag = (dir: string) => {
      writeFileSync(join(dir, ".bin/git"), `#!/usr/bin/env bash\n[[ $1 == tag ]] && { echo "fatal: tag list broken" >&2; exit 128; }\nexec ${realGit} "$@"\n`);
      chmodSync(join(dir, ".bin/git"), 0o755);
    };
    // main: v9.9.9 is newer, which a working git refuses (the case below); a broken one used to let the release through
    const main = standIn("main");
    git(main, "tag", "v9.9.9");
    expect(plan(main, {})).toMatchObject({ code: 1 });
    expect(plan(main, {}).text).toMatch(/v1\.2\.0 is not above the newest release v9\.9\.9/);
    breakTag(main);
    const broken = plan(main, {});
    expect(broken.code).toBe(1);
    expect(broken.text).toMatch(/git tag failed/);
    expect(broken.out).toEqual({});
    // a candidate whose tag exists
    const cand = standIn("candidate/1.2.0-abc1234");
    git(cand, "tag", "v1.2.0");
    expect(plan(cand, onBranch("candidate/1.2.0-abc1234")).text).toMatch(/Tag v1\.2\.0 exists already, so there is no candidate of it/);
    breakTag(cand);
    const brokenCand = plan(cand, onBranch("candidate/1.2.0-abc1234"));
    expect(brokenCand.code).toBe(1);
    expect(brokenCand.text).toMatch(/git tag failed/);
    expect(brokenCand.out).toEqual({});
  });

  it("refuses a candidate whose branch name has another version than the tree, or is no candidate name", () => {
    const wrong = plan(standIn("candidate/1.3.0-abc1234"), onBranch("candidate/1.3.0-abc1234"));
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/Tag v1\.3\.0 but APP_VERSION is 1\.2\.0/);
    expect(wrong.out).toEqual({});
    for (const name of ["candidate/oops", "candidate/1.2.0", "candidate/1.2.0-XYZ", "candidate/1.2-abc1234", "candidate/1.2.0-abc1234/x"]) {
      const r = plan(standIn(name), onBranch(name));
      expect(r.code, name).toBe(1);
      expect(r.text, name).toMatch(/is not candidate\/X\.Y\.Z-<commit>/);
    }
  });

  it("refuses a candidate whose parent is not origin/main, or that is a merge", () => {
    const dir = standIn("candidate/1.2.0-abc1234");
    const c = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-B", "side", "origin/main");
    writeFileSync(join(dir, "other.txt"), "x\n");
    git(dir, "add", "other.txt");
    git(dir, "commit", "-q", "-m", "S");
    const s = git(dir, "rev-parse", "HEAD");
    // main moved on after the candidate was made
    git(dir, "update-ref", "refs/remotes/origin/main", s);
    git(dir, "checkout", "-q", "-B", "candidate/1.2.0-abc1234", c);
    const moved = plan(dir, onBranch("candidate/1.2.0-abc1234"));
    expect(moved.code).toBe(1);
    expect(moved.text).toMatch(/The parent of the candidate is .*, not origin\/main/);
    // no origin/main at all
    git(dir, "update-ref", "-d", "refs/remotes/origin/main");
    expect(plan(dir, onBranch("candidate/1.2.0-abc1234")).text).toMatch(/not origin\/main \(missing\)/);
    // a merge whose first parent is main
    const m = git(dir, "rev-parse", "main");
    git(dir, "update-ref", "refs/remotes/origin/main", m);
    const merge = git(dir, "commit-tree", `${c}^{tree}`, "-p", m, "-p", s, "-m", "merge");
    git(dir, "checkout", "-q", "-B", "candidate/1.2.0-abc1234", merge);
    expect(plan(dir, onBranch("candidate/1.2.0-abc1234")).text).toMatch(/The candidate commit is a merge/);
    // near miss: the plain commit on main passes
    git(dir, "checkout", "-q", "-B", "candidate/1.2.0-abc1234", c);
    expect(plan(dir, onBranch("candidate/1.2.0-abc1234")).code).toBe(0);
  });

  it("refuses a candidate of a version that has a tag or a release, or is not above the newest", () => {
    const name = "candidate/1.2.0-abc1234";
    const dir = standIn(name);
    expect(plan(dir, { ...onBranch(name), GH_FAKE: "exists" })).toMatchObject({ code: 1, out: {} });
    expect(plan(dir, { ...onBranch(name), GH_FAKE: "exists" }).text).toMatch(/Release v1\.2\.0 exists already/);
    expect(plan(dir, { ...onBranch(name), GH_FAKE: "other" }).text).toMatch(/Could not ask GitHub/);
    git(dir, "tag", "v1.3.0");
    expect(plan(dir, onBranch(name)).text).toMatch(/v1\.2\.0 is not above the newest release v1\.3\.0/);
    git(dir, "tag", "-d", "v1.3.0");
    git(dir, "tag", "v1.2.0");
    const tagged = plan(dir, onBranch(name));
    expect(tagged.code).toBe(1);
    expect(tagged.text).toMatch(/Tag v1\.2\.0 exists already, so there is no candidate of it/);
    expect(tagged.out).toEqual({});
  });

  it("refuses a candidate whose files disagree with the version, and one started by hand", () => {
    const name = "candidate/1.2.0-abc1234";
    expect(plan(standIn(name, { changelog: "1.1.9" }), onBranch(name)).text).toMatch(/CHANGELOG top heading is 1\.1\.9, tag is 1\.2\.0/);
    const dir = standIn(name);
    expect(plan(dir, { ...onBranch(name), EVENT: "workflow_dispatch", SIGNED_BY_HAND: "true" }).text).toMatch(/A candidate is built by a push/);
    writeFileSync(join(dir, "apps/web/package.json"), '{"version":"1.1.0"}\n');
    expect(plan(dir, onBranch(name)).text).toMatch(/apps\/web\/package.json is 1\.1\.0, tag is 1\.2\.0/);
  });

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
});
