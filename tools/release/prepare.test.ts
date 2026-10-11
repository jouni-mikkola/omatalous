/**
 * tools/release/prepare.mjs against throwaway git repositories: the files it writes, the checks release.yml and
 * the publish step run on the result, and each refusal. The real CHANGELOG.md and version files are never touched.
 * The contracts folder and the frozen database are written by a stand-in `pnpm` and a stand-in tools/release/fixture.mjs
 * (the real ones are tested in apps/server/test/contracts.test.ts and fixture.test.ts): these tests check what prepare
 * does around them, in what order, and what it does when they fail.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // the folder of the release before, the files the helper's output comes from and the stand-in for fixture.mjs
  for (const f of OPS) put(dir, `contracts/${version}/${f}`, `{ "cases": ["${f}"] }\n`);
  put(dir, `contracts/${version}/schema.sql`, "-- old schema\n");
  put(dir, `contracts/${version}/README.md`, "# old\n");
  for (const f of HELPER) put(dir, f, "the helper\n");
  put(dir, "tools/release/fixture.mjs", FIXTURE_STUB);
  put(dir, "tools/release/facts.json", JSON.stringify(FACTS));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  if (tag) git(dir, "tag", tag);
  return dir;
}

const OPS = ["ops-poll.json", "ops-report.json", "ops-state.json"];
const HELPER = ["apps/server/src/cli-ops.ts", "apps/server/src/services/ops.ts", "apps/server/src/services/ops-validate.ts", "scripts/ops-helper.sh"];
const FACTS = [{ name: "0002_more.sql", compat: "0.5.1", tables: ["b"], columns: ["a.y"], indexes: ["idx_b_y"] }];
const FRAGMENT = "section: Reliability\n- A new table.\nupgrade: Migration 0002 runs on the first start.\n";
const NEW_FILES = ["contracts/0.6.0", "apps/server/test/fixtures/db/0.6.0.sql"];

/** What fixture.mjs prints and writes, in miniature. facts.json holds its --facts answer, FIXTURE_REFUSES makes it refuse. */
const FIXTURE_STUB = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [version, flag] = process.argv.slice(2);
if (flag === "--facts") {
  if (process.env.FACTS_GARBAGE) {
    console.log("not json");
    process.exit(0);
  }
  console.log(JSON.stringify({ version, previous: "0.5.1", migrations: JSON.parse(readFileSync("tools/release/facts.json", "utf8")) }));
  process.exit(0);
}
if (process.env.FIXTURE_REFUSES) {
  console.error("fixture: refused: the new table b has no rows.");
  process.exit(1);
}
if (!existsSync("contracts/" + version + "/schema.sql")) {
  console.error("fixture: refused: the contract is missing.");
  process.exit(1);
}
mkdirSync("apps/server/test/fixtures/db", { recursive: true });
writeFileSync("apps/server/test/fixtures/db/" + version + ".sql", "-- fixture\\n");
console.log("fixture: wrote " + process.cwd() + "/apps/server/test/fixtures/db/" + version + ".sql from 0.5.1.sql (3 tables, 9 rows, 1 migrations applied, 1 new tables).");
console.log("Say what the seed rows cover in the header (see 0.8.0.sql) before you commit it:");
console.log("  -- Rows of b: two notes");
`;

/** A pnpm that does what `pnpm test apps/server/test/contracts.test.ts` does under UPDATE_CONTRACT, and logs the version it saw. */
const PNPM_STUB = `#!/usr/bin/env bash
echo "$* | UPDATE_CONTRACT=\${UPDATE_CONTRACT:-} | $(grep -o 'APP_VERSION = "[^"]*"' apps/server/src/version.ts)" >> "$PNPM_LOG"
if [[ -n \${PNPM_FAILS:-} ]]; then echo "FAIL apps/server/test/contracts.test.ts: index idx_b_y of b is gone"; exit 1; fi
mkdir -p "contracts/$UPDATE_CONTRACT"
printf -- '-- new schema\\n' > "contracts/$UPDATE_CONTRACT/schema.sql"
`;
const bin = mkdtempSync(join(tmpdir(), "prepare-bin-"));
dirs.push(bin);
writeFileSync(join(bin, "pnpm"), PNPM_STUB);
chmodSync(join(bin, "pnpm"), 0o755);

/** A release that adds a migration (and says so in a fragment) since the repository's tag or baseline. */
function addMigration(dir: string) {
  put(dir, "apps/server/migrations/0002_more.sql", "CREATE TABLE b (y INTEGER);\n");
  fragment(dir, "A1", FRAGMENT);
  commitAll(dir, "migration");
}
/** prepare.mjs with the stand-in pnpm first on the PATH. `calls` are the lines it logged, in the repository's .git folder. */
function gen(dir: string, args: string[], env: Record<string, string> = {}) {
  const log = join(dir, ".git/pnpm.log");
  const r = runEnv(dir, { PATH: `${bin}:${process.env.PATH}`, PNPM_LOG: log, ...env }, args);
  return { ...r, calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [] };
}
/** The README as one line per paragraph. */
const flat = (s: string) => s.replace(/(?<!\n)\n(?!\n)/g, " ");

function fragment(dir: string, name: string, text: string) {
  put(dir, `changelog.d/${name}.md`, text);
}
function commitAll(dir: string, msg = "work") {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}
function runEnv(dir: string, env: Record<string, string>, args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const run = (dir: string, ...args: string[]) => runEnv(dir, {}, args);
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

    // the commands release.yml (plan, release notes) and the publish step run on the result
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
    // the contract and the frozen database are there already, so nothing is written for them
    put(dir, "contracts/0.6.0/schema.sql", "-- new\n");
    put(dir, "apps/server/test/fixtures/db/0.6.0.sql", "-- fixture\n");
    commitAll(dir);
    const ok = run(dir, "0.6.0");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("0002_more.sql");
    expect(ok.out).toContain("contracts/0.6.0 and apps/server/test/fixtures/db/0.6.0.sql are in place");
    expect(read(dir, "CHANGELOG.md")).toContain("Upgrade\n\n- Migration 0002 runs on the first start.\n");
  });

  it("--check-docs and --dry-run say what will be written for a release with new migrations, and write nothing", () => {
    const dir = repo("0.5.1", "v0.5.1");
    addMigration(dir);

    const check = gen(dir, ["0.6.0", "--check-docs"]);
    expect(check.code).toBe(0);
    expect(check.out).toContain("Checks pass for 0.5.1 -> 0.6.0");
    expect(check.out).toContain("contracts/0.6.0/ and apps/server/test/fixtures/db/0.6.0.sql will be written");
    expect(check.out).not.toContain("## 0.6.0");
    const dry = gen(dir, ["0.6.0", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("Would write contracts/0.6.0/ and apps/server/test/fixtures/db/0.6.0.sql (the ops-*.json files copied from contracts/0.5.1)");
    expect(dry.out).toContain("## 0.6.0");
    for (const r of [check, dry]) expect(r.calls).toEqual([]);
    expect(git(dir, "status", "--porcelain")).toBe("");
    for (const f of NEW_FILES) expect(existsSync(join(dir, f))).toBe(false);
    expect(read(dir, "CHANGELOG.md")).not.toContain("0.6.0");
    expect(existsSync(join(dir, "changelog.d/A1.md"))).toBe(true);

    // with the folder and the database in the repository there is nothing to write
    put(dir, "contracts/0.6.0/schema.sql", "-- new\n");
    put(dir, "apps/server/test/fixtures/db/0.6.0.sql", "-- fixture\n");
    commitAll(dir, "contract");
    expect(gen(dir, ["0.6.0", "--check-docs"]).out).toContain("1 new migrations, contracts/0.6.0 present");
  });

  it("writes contracts/X.Y.Z and the frozen database before it bumps the version", () => {
    const dir = repo("0.5.1", "v0.5.1");
    addMigration(dir);
    const r = gen(dir, ["0.6.0"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    // the schema comes from the contracts test, run while the version is still the old one (it refuses the current version)
    expect(r.calls).toEqual(['test apps/server/test/contracts.test.ts | UPDATE_CONTRACT=0.6.0 | APP_VERSION = "0.5.1"']);
    expect(read(dir, "apps/server/src/version.ts")).toContain('"0.6.0"');
    expect(read(dir, "contracts/0.6.0/schema.sql")).toBe("-- new schema\n");
    for (const f of OPS) expect(read(dir, `contracts/0.6.0/${f}`)).toBe(read(dir, `contracts/0.5.1/${f}`));
    expect(read(dir, "apps/server/test/fixtures/db/0.6.0.sql")).toBe("-- fixture\n");
    expect(r.out.split("\n")[0]).toContain("0.5.1 -> 0.6.0");
    expect(r.out).toContain("Wrote contracts/0.6.0: schema.sql, ops-poll.json, ops-report.json, ops-state.json (copies of 0.5.1's), README.md");
    // the fixture's own words, without the absolute path
    expect(r.out).toContain("fixture: wrote apps/server/test/fixtures/db/0.6.0.sql from 0.5.1.sql");
    expect(r.out).toContain("  -- Rows of b: two notes");
    expect(r.out).not.toContain(dir);

    const readme = read(dir, "contracts/0.6.0/README.md");
    expect(readme.startsWith("# Contracts of 0.6.0\n\nFrozen when 0.6.0 ships. Until then a later task may update these files (see `../README.md`).")).toBe(true);
    expect(readme.split("\n").every((l) => l.length <= 120)).toBe(true);
    expect(flat(readme)).toContain(
      "Over 0.5.1 the schema adds the table `b`, the column `a.y` and the index `idx_b_y` (0002). " +
        "The migration carries the compat floor 0.5.1, so 0.5.1 opens a database that has it and a rollback keeps what it adds. " +
        "The three `ops-*.json` files are copies of 0.5.1's. The helper CLI (`cli-ops.ts`, `services/ops.ts`, `services/ops-validate.ts`, `scripts/ops-helper.sh`) did not change since 0.5.1.",
    );
  });

  it("words the README from what each migration adds and which floor it carries", () => {
    const dir = repo("0.5.1", "v0.5.1");
    addMigration(dir);
    const facts = [
      { name: "0002_a.sql", compat: "0.5.0", tables: ["b"], columns: [], indexes: [] },
      { name: "0003_b.sql", compat: null, tables: [], columns: ["b.z", "b.w"], indexes: [] },
      { name: "0004_c.sql", compat: "0.5.0", tables: [], columns: [], indexes: [] },
    ];
    put(dir, "tools/release/facts.json", JSON.stringify(facts));
    commitAll(dir, "facts");
    expect(gen(dir, ["0.6.0"]).code).toBe(0);
    expect(flat(read(dir, "contracts/0.6.0/README.md"))).toContain(
      "Over 0.5.1 the schema adds the table `b` (0002) and the columns `b.z` and `b.w` (0003). " +
        "Migration 0004 adds no table, column or index. `schema.sql` shows what else it changes. " +
        "0002 carries the compat floor 0.5.0, 0003 carries no compat floor and 0004 carries the compat floor 0.5.0. " +
        "A migration without a floor makes every build that lacks its file refuse the database. The three",
    );

    const two = repo("0.5.1", "v0.5.1");
    addMigration(two);
    put(two, "tools/release/facts.json", JSON.stringify([facts[0], { ...facts[2], tables: ["c"] }]));
    commitAll(two, "facts");
    expect(gen(two, ["0.6.0"]).code).toBe(0);
    expect(flat(read(two, "contracts/0.6.0/README.md"))).toContain(
      "Over 0.5.1 the schema adds the table `b` (0002) and the table `c` (0004). Both migrations carry the compat floor 0.5.0, so 0.5.0 opens a database that has them and a rollback keeps what they add.",
    );
  });

  it("names the release the helper files did not change since: the version of a tag, of a baseline line, or the --since ref", () => {
    const dir = repo("0.5.1");
    const start = git(dir, "rev-parse", "HEAD");
    put(dir, ".github/upgrade-from.txt", `# One ref per line.\n# 0.5.0 (the private commit it was published from)\n${start}\n`);
    addMigration(dir);
    expect(gen(dir, ["0.6.0"]).code).toBe(0);
    expect(flat(read(dir, "contracts/0.6.0/README.md"))).toContain("did not change since 0.5.0.");

    const named = repo("0.5.1");
    addMigration(named);
    const ref = git(named, "rev-parse", "HEAD~1");
    expect(gen(named, ["0.6.0", "--since", ref]).code).toBe(0);
    expect(flat(read(named, "contracts/0.6.0/README.md"))).toContain(`did not change since ${ref}.`);
  });

  it("stops where a person must write the folder: helper files changed since the release, or no earlier folder to copy from", () => {
    const dir = repo("0.5.1", "v0.5.1");
    put(dir, "scripts/ops-helper.sh", "a changed helper\n");
    addMigration(dir);
    for (const args of [["0.6.0", "--check-docs"], ["0.6.0", "--dry-run"], ["0.6.0"]]) {
      const r = gen(dir, args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.err).toContain("Migrations were added since 0.5.1, so contracts/0.6.0/schema.sql must exist before the release.");
      expect(r.err).toContain("The helper files changed since then (scripts/ops-helper.sh)");
      expect(r.err).toContain("copy the ops-*.json files of contracts/0.5.1, edit them where it did");
      expect(r.calls).toEqual([]);
    }
    expect(git(dir, "status", "--porcelain")).toBe("");
    for (const f of NEW_FILES) expect(existsSync(join(dir, f))).toBe(false);
    expect(read(dir, "apps/server/src/version.ts")).toContain('"0.5.1"');

    // a helper change before the release does not count, and neither does one in another file
    const older = repo("0.5.1");
    put(older, "scripts/ops-helper.sh", "a changed helper\n");
    commitAll(older, "helper");
    git(older, "tag", "v0.5.1");
    put(older, "scripts/doctor.sh", "other\n");
    addMigration(older);
    expect(gen(older, ["0.6.0", "--check-docs"]).code).toBe(0);

    // a person writes the folder; the frozen database is still written
    put(dir, "contracts/0.6.0/schema.sql", "-- by hand\n");
    commitAll(dir, "by hand");
    const done = gen(dir, ["0.6.0"]);
    expect(done.code).toBe(0);
    expect(done.calls).toEqual([]);
    expect(read(dir, "contracts/0.6.0/schema.sql")).toBe("-- by hand\n");
    expect(existsSync(join(dir, "contracts/0.6.0/ops-poll.json"))).toBe(false);
    expect(existsSync(join(dir, "apps/server/test/fixtures/db/0.6.0.sql"))).toBe(true);
    expect(done.out).not.toContain("Wrote contracts/0.6.0");

    const none = repo("0.5.1", "v0.5.1");
    git(none, "rm", "-rq", "contracts");
    addMigration(none);
    const refused = gen(none, ["0.6.0", "--check-docs"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("There is no earlier contracts folder with ops-poll.json, ops-report.json, ops-state.json to copy from");
  });

  it("in a copy without tools/release/fixture.mjs it cannot write the folder, and asks for the database no more", () => {
    const dir = repo("0.5.1", "v0.5.1");
    git(dir, "rm", "-q", "tools/release/fixture.mjs");
    addMigration(dir);
    const refused = gen(dir, ["0.6.0", "--check-docs"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("tools/release/fixture.mjs is missing, so contracts/0.6.0/ cannot be written.");
    put(dir, "contracts/0.6.0/schema.sql", "-- by hand\n");
    commitAll(dir, "by hand");
    expect(gen(dir, ["0.6.0", "--check-docs"]).out).toContain("1 new migrations, contracts/0.6.0 present");
  });

  it("removes what it wrote when the contracts test or the fixture fails, and bumps nothing", () => {
    const dir = repo("0.5.1", "v0.5.1");
    addMigration(dir);
    const broken = gen(dir, ["0.6.0"], { PNPM_FAILS: "1" });
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("pnpm test apps/server/test/contracts.test.ts failed (exit 1)");
    expect(broken.err).toContain("index idx_b_y of b is gone");
    expect(existsSync(join(dir, "contracts/0.6.0"))).toBe(false);

    const garbled = gen(dir, ["0.6.0"], { FACTS_GARBAGE: "1" });
    expect(garbled.code).toBe(1);
    expect(garbled.err).toContain("did not print its JSON line: not json");
    expect(existsSync(join(dir, "contracts/0.6.0"))).toBe(false);

    const refused = gen(dir, ["0.6.0"], { FIXTURE_REFUSES: "1" });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("fixture: refused: the new table b has no rows.");
    expect(refused.calls).toHaveLength(2);
    for (const f of NEW_FILES) expect(existsSync(join(dir, f))).toBe(false);
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(read(dir, "apps/server/src/version.ts")).toContain('"0.5.1"');
    expect(read(dir, "CHANGELOG.md")).not.toContain("0.6.0");
    expect(existsSync(join(dir, "changelog.d/A1.md"))).toBe(true);

    // a folder a person started keeps its files; only what this run wrote goes
    put(dir, "contracts/0.6.0/README.md", "# mine\n");
    expect(gen(dir, ["0.6.0"], { PNPM_FAILS: "1" }).code).toBe(1);
    expect(read(dir, "contracts/0.6.0/README.md")).toBe("# mine\n");
    expect(existsSync(join(dir, "contracts/0.6.0/ops-poll.json"))).toBe(false);
    // and a person's folder is completed, not replaced
    expect(gen(dir, ["0.6.0"]).code).toBe(0);
    expect(read(dir, "contracts/0.6.0/README.md")).toBe("# mine\n");
    expect(existsSync(join(dir, "contracts/0.6.0/ops-state.json"))).toBe(true);
  });

  it("--check-docs needs no contracts folder without a new migration, and still runs the other checks", () => {
    const dir = repo("0.5.1", "v0.5.1");
    expect(run(dir, "0.6.0", "--check-docs").err).toContain("No fragments");
    fragment(dir, "A1", "section: Look\n- x\n");
    commitAll(dir);
    expect(run(dir, "0.6.0", "--check-docs").code).toBe(0);
    expect(run(dir, "0.5.1", "--check-docs").err).toContain("is not above");
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
