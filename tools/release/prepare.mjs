#!/usr/bin/env node
// @ts-check
/**
 * Prepares the release commit: tools/release/prepare.mjs X.Y.Z [--dry-run] [--check-docs] [--since REF]
 *
 * Bumps apps/server/src/version.ts and the three package.json files, builds the `## X.Y.Z` section of CHANGELOG.md
 * from changelog.d/*.md (README.md excepted) and removes the fragments. Nothing is committed. Run it in the private
 * repository on a clean tree, read the diff, then commit.
 *
 * A fragment starts with `section: <name>`. Its other lines are entries for that section, `upgrade: <line>` lines go
 * to the Upgrade list (changelog.d/README.md). The entries of `section: Internal` go last in the version, inside a
 * private block that the public CHANGELOG never gets. changelog.d/_highlights.md is not a fragment: its lines become
 * a short list right under the version heading, and a release of five or more fragments is refused without it.
 *
 * It refuses a version that is not above the newest v* tag and the current version, an Unreleased heading in
 * CHANGELOG.md, and a release that adds migration files since the last release without an `upgrade:` line. The last
 * release is the newest v* tag. The private repository has none, so then it is the newest commit in
 * the upgrade baselines file. --since REF names another one. The result is checked the way release.yml and
 * the publish step check a release before anything is written.
 *
 * A release with new migrations also needs contracts/X.Y.Z/ and the frozen database apps/server/test/fixtures/db/
 * X.Y.Z.sql (docs/RELEASING.md step 2). Where one is missing it is written before the version is bumped: the folder
 * from `tools/release/fixture.mjs X.Y.Z --facts` (README.md), a copy of the previous folder's ops-*.json files and
 * `UPDATE_CONTRACT=X.Y.Z pnpm test apps/server/test/contracts.test.ts` (schema.sql), then the fixture with
 * `tools/release/fixture.mjs X.Y.Z`. All or nothing: a step that fails removes what the run wrote. It stops, and
 * writes nothing, where a person must decide: the helper files (HELPER_FILES) changed since the last release, so the
 * ops-*.json files may need edits, or there is no earlier folder to copy them from. A new table needs its seed rows
 * first (fixture.mjs says where).
 *
 * --check-docs is the check the release command runs before it starts: every check above, those two stops
 * included. It writes nothing and prints one line. --dry-run also checks them and prints what it would write.
 *
 * `prepare.mjs --check-fragment FILE...` reads single files (paths from the repository root) with the same code and
 * prints the first sentence a bad one earns: the landing of a branch uses it.
 *
 * Imports Node built-ins only. Writing the contracts folder needs `pnpm install` (pnpm runs the contracts test) and
 * Node 22.18 or newer (fixture.mjs).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The order of the sections in CHANGELOG.md. */
const SECTIONS = ["Money and reports", "Fetching and importing", "Look", "Reliability", "Maintenance", "For developers"];
/** The section only the maintainers read. It comes last in the version, after the Upgrade list, in a private block. */
const INTERNAL = "Internal";
const PRIVATE_OPEN = "<!-- private -->";
const PRIVATE_CLOSE = "<!-- /private -->";
/** The lines of the highlights file become the short list under the version heading. It is no fragment. */
const HIGHLIGHTS = "_highlights.md";
/** A release of this many fragments or more needs the highlights file. */
const HIGHLIGHTS_FROM = 5;

const VERSION_FILE = "apps/server/src/version.ts";
const PACKAGES = ["apps/server/package.json", "apps/web/package.json", "packages/core/package.json"];
const MIGRATIONS = "apps/server/migrations";
const FRAGMENTS = "changelog.d";
const CHANGELOG = "CHANGELOG.md";
const UPGRADE_FROM = ".github/upgrade-from.txt";
const CONTRACTS = "contracts";
const FIXTURES = "apps/server/test/fixtures/db";
const FIXTURE_SCRIPT = "tools/release/fixture.mjs";
const OPS_FILES = ["ops-poll.json", "ops-report.json", "ops-state.json"];
// what the helper CLI's output (the ops-*.json files) comes from, as contracts/README.md lists it
const HELPER_FILES = ["apps/server/src/cli-ops.ts", "apps/server/src/services/ops.ts", "apps/server/src/services/ops-validate.ts", "scripts/ops-helper.sh"];
// the patterns release.yml and the publish step read the version with
const APP_VERSION_LINE = /^export const APP_VERSION = "(.*)";$/m;
const PACKAGE_VERSION_LINE = /^  "version": "(.*?)",?$/m;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class Fail extends Error {}

/** @param {string} v @returns {number[]} */
const parts = (v) => v.split(".").map(Number);
/** @param {string} a @param {string} b */
function compare(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return /** @type {number} */ (x[i]) - /** @type {number} */ (y[i]);
  return 0;
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const err = /** @type {{ stderr?: string, message: string }} */ (e);
    throw new Fail(`git ${args.join(" ")} failed: ${(err.stderr || err.message).trim()}`);
  }
}

/**
 * Adds one line to a list of entries: an indented line continues the entry before it, a leading "- " is dropped.
 * @param {string[]} entries @param {string} line
 */
function addEntry(entries, line) {
  if (/^\s/.test(line) && entries.length) entries[entries.length - 1] += ` ${line.trim()}`;
  else entries.push(line.replace(/^[-*]\s+/, "").trim());
}

/**
 * One fragment: the section, the entries and the upgrade lines.
 * @param {string} name
 * @param {string} text
 */
function parseFragment(name, text) {
  /** @type {string | undefined} */
  let section;
  /** @type {string[]} */
  const entries = [];
  /** @type {string[]} */
  const upgrade = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const sec = /^section:\s*(.*)$/.exec(line);
    const up = /^upgrade:\s*(.*)$/.exec(line);
    if (sec) {
      if (section !== undefined) throw new Fail(`${name}: two section lines`);
      section = sec[1]?.trim();
    } else if (up) {
      if (!up[1]?.trim()) throw new Fail(`${name}: an upgrade: line has no text`);
      upgrade.push(up[1].trim());
    } else if (section === undefined) {
      throw new Fail(`${name}: "${line}" comes before the section line`);
    } else {
      addEntry(entries, line);
    }
  }
  const known = [...SECTIONS, INTERNAL];
  if (!section) throw new Fail(`${name}: no "section: <name>" line. Sections: ${known.join(", ")}`);
  if (!known.includes(section)) throw new Fail(`${name}: unknown section "${section}". Sections: ${known.join(", ")}`);
  if (!entries.length && !upgrade.length) throw new Fail(`${name}: no text under the section line`);
  return { name, section, entries, upgrade };
}

/**
 * The highlights file: one line per highlight, in the format of the entries of a fragment, with no section line.
 * @param {string} name
 * @param {string} text
 */
function parseHighlights(name, text) {
  /** @type {string[]} */
  const entries = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^(section|upgrade):/.test(line)) throw new Fail(`${name}: "${line}" does not belong here. The highlights are plain lines, with no section: or upgrade: line.`);
    addEntry(entries, line);
  }
  if (!entries.length) throw new Fail(`${name} has no lines. Write 2 to 5 lines that say what is new for a household, or remove the file.`);
  return entries;
}

/**
 * The text of the new CHANGELOG section: the highlights, the sections, the Upgrade list and last the Internal section
 * in a private block.
 * @param {string} version
 * @param {ReturnType<typeof parseFragment>[]} fragments
 * @param {string[]} highlights
 */
function buildSection(version, fragments, highlights) {
  let out = `## ${version}\n\n`;
  if (highlights.length) out += `${highlights.map((e) => `- ${e}`).join("\n")}\n\n`;
  for (const section of SECTIONS) {
    const entries = fragments.filter((f) => f.section === section).flatMap((f) => f.entries);
    if (entries.length) out += `${section}\n\n${entries.map((e) => `- ${e}`).join("\n")}\n\n`;
  }
  const upgrade = fragments.flatMap((f) => f.upgrade);
  if (upgrade.length) out += `Upgrade\n\n${upgrade.map((e) => `- ${e}`).join("\n")}\n\n`;
  const internal = fragments.filter((f) => f.section === INTERNAL).flatMap((f) => f.entries);
  if (internal.length) out += `${PRIVATE_OPEN}\n${INTERNAL}\n\n${internal.map((e) => `- ${e}`).join("\n")}\n${PRIVATE_CLOSE}\n\n`;
  return out;
}

/** @param {string[]} xs */
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const code = (/** @type {string} */ s) => `\`${s}\``;
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => (n === 1 ? one : many);

/** A paragraph wrapped at 120 columns. @param {string} text */
function wrap(text) {
  /** @type {string[]} */
  const lines = [];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 120) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines.join("\n");
}

/** @typedef {{ name: string, compat: string | null, tables: string[], columns: string[], indexes: string[] }} MigrationFacts */

/**
 * contracts/X.Y.Z/README.md, written from what `fixture.mjs X.Y.Z --facts` says the new migrations add and the floors
 * they carry. The format of the earlier folders' README.md files.
 * @param {string} version
 * @param {{ previous: string, migrations: MigrationFacts[] }} facts
 * @param {string} opsFrom the folder the ops-*.json files are copies of
 * @param {string} since the release the helper files did not change after
 */
function contractReadme(version, facts, opsFrom, since) {
  const { previous, migrations } = facts;
  const number = (/** @type {MigrationFacts} */ m) => /^\d+/.exec(m.name)?.[0] ?? m.name;
  const things = (/** @type {MigrationFacts} */ m) =>
    [
      m.tables.length ? `the ${plural(m.tables.length, "table", "tables")} ${list(m.tables.map(code))}` : "",
      m.columns.length ? `the ${plural(m.columns.length, "column", "columns")} ${list(m.columns.map(code))}` : "",
      m.indexes.length ? `the ${plural(m.indexes.length, "index", "indexes")} ${list(m.indexes.map(code))}` : "",
    ].filter(Boolean);
  const adds = migrations.filter((m) => things(m).length);
  const plain = migrations.filter((m) => !things(m).length);
  /** @type {string[]} */
  const sentences = [];
  if (adds.length) sentences.push(`Over ${previous} the schema adds ${list(adds.map((m) => `${list(things(m))} (${number(m)})`))}.`);
  if (plain.length) {
    const [names, n] = [list(plain.map(number)), plain.length];
    sentences.push(`${plural(n, "Migration", "Migrations")} ${names} ${plural(n, "adds", "add")} no table, column or index. \`schema.sql\` shows what else ${plural(n, "it", "they")} change${plural(n, "s", "")}.`);
  }
  if (!migrations.length) sentences.push(`The schema is the schema of ${previous}.`);
  const floors = [...new Set(migrations.map((m) => m.compat))];
  if (migrations.length && floors.length === 1 && floors[0]) {
    const n = migrations.length;
    const who = n === 1 ? "The migration carries" : n === 2 ? "Both migrations carry" : `All ${n} migrations carry`;
    sentences.push(`${who} the compat floor ${floors[0]}, so ${floors[0]} opens a database that has ${plural(n, "it", "them")} and a rollback keeps what ${plural(n, "it adds", "they add")}.`);
  } else if (migrations.length) {
    sentences.push(`${list(migrations.map((m) => `${number(m)} carries ${m.compat ? `the compat floor ${m.compat}` : "no compat floor"}`))}.`);
    if (migrations.some((m) => !m.compat)) sentences.push("A migration without a floor makes every build that lacks its file refuse the database.");
  }
  sentences.push(`The three \`ops-*.json\` files are copies of ${opsFrom}'s. The helper CLI (${["cli-ops.ts", "services/ops.ts", "services/ops-validate.ts", "scripts/ops-helper.sh"].map(code).join(", ")}) did not change since ${since}.`);
  return (
    `# Contracts of ${version}\n\n` +
    wrap(
      `Frozen when ${version} ships. Until then a later task may update these files (see \`../README.md\`). While ${version} is unreleased the test also demands that \`schema.sql\` equals the schema of a fresh database exactly, so a schema change cannot pass without its dump.`,
    ) +
    "\n\n" +
    wrap(sentences.join(" ")) +
    "\n"
  );
}

/**
 * Where the ops-*.json files of contracts/X.Y.Z are copied from, or a stop: a person writes them when there is nothing
 * to copy or when the helper files changed since the release the migrations are counted from.
 * @param {string} root @param {string} version @param {string} base @param {string} since
 */
function opsSource(root, version, base, since) {
  const dir = join(root, CONTRACTS);
  const below = (existsSync(dir) ? readdirSync(dir) : []).filter((d) => SEMVER.test(d) && compare(d, version) < 0).sort(compare);
  const previous = below[below.length - 1];
  const folder = `contracts/${version}`;
  const lead = `Migrations were added since ${since}, so ${folder}/schema.sql must exist before the release.`;
  if (!previous || !OPS_FILES.every((f) => existsSync(join(dir, previous, f)))) {
    throw new Fail(`${lead} There is no earlier contracts folder with ${OPS_FILES.join(", ")} to copy from, so write it by hand (contracts/README.md).`);
  }
  const changed = git(root, ["diff", "--name-only", base, "--", ...HELPER_FILES]).split("\n").filter(Boolean);
  if (changed.length) {
    throw new Fail(
      `${lead} The helper files changed since then (${changed.join(", ")}), so a person checks whether the output of ops poll, report and state changed: ` +
        `copy the ops-*.json files of contracts/${previous}, edit them where it did, write ${folder}/README.md and schema.sql ` +
        `(UPDATE_CONTRACT=${version} pnpm test apps/server/test/contracts.test.ts, see contracts/README.md), then run this again. It writes the frozen database.`,
    );
  }
  return previous;
}

/**
 * Runs a command in the repository. A failure stops the release with the end of what the command said.
 * @param {string} root @param {string} cmd @param {string[]} args @param {Record<string, string>} [env]
 */
function sh(root, cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
  const what = `${cmd === process.execPath ? "node" : cmd} ${args.join(" ")}`;
  if (r.error) throw new Fail(`${what} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Fail(`${what} failed (exit ${r.status}):\n${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-25).join("\n")}`);
  return r.stdout;
}

/**
 * Writes contracts/X.Y.Z and the frozen database where they are missing. All or nothing: a step that fails removes what
 * this run wrote. Returns the lines to report.
 * @param {string} root @param {string} version @param {{ contract: boolean, fixture: boolean }} make
 * @param {{ opsFrom: string, since: string } | undefined} source
 */
function writeContract(root, version, make, source) {
  const dir = join(root, CONTRACTS, version);
  const created = make.contract && !existsSync(dir);
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const written = [];
  /** Writes a file of the folder unless it is there; a person's earlier file stays. */
  const put = (/** @type {string} */ name, /** @type {() => void} */ write) => {
    if (existsSync(join(dir, name))) return;
    written.push(join(dir, name));
    write();
  };
  try {
    if (make.contract && source) {
      const { opsFrom, since } = source;
      const out = sh(root, process.execPath, [FIXTURE_SCRIPT, version, "--facts"]).trim().split("\n");
      /** @type {{ previous: string, migrations: MigrationFacts[] }} */
      let facts;
      try {
        facts = JSON.parse(out[out.length - 1] ?? "");
      } catch {
        throw new Fail(`${FIXTURE_SCRIPT} ${version} --facts did not print its JSON line: ${out.slice(-3).join(" | ")}`);
      }
      mkdirSync(dir, { recursive: true });
      for (const f of OPS_FILES) put(f, () => copyFileSync(join(root, CONTRACTS, opsFrom, f), join(dir, f)));
      put("README.md", () => writeFileSync(join(dir, "README.md"), contractReadme(version, facts, opsFrom, since)));
      // the test writes schema.sql of the unreleased version, then checks the code against every folder
      written.push(join(dir, "schema.sql"));
      sh(root, "pnpm", ["test", "apps/server/test/contracts.test.ts"], { UPDATE_CONTRACT: version });
      if (!existsSync(join(dir, "schema.sql"))) throw new Fail(`The contracts test ran but wrote no ${CONTRACTS}/${version}/schema.sql.`);
      notes.push(`Wrote ${CONTRACTS}/${version}: schema.sql, ${OPS_FILES.join(", ")} (copies of ${opsFrom}'s), README.md. Read the README.`);
    }
    if (make.fixture) {
      const out = sh(root, process.execPath, [FIXTURE_SCRIPT, version]).trim().split("\n");
      notes.push(...out.filter((l) => l.startsWith("fixture: wrote ") || l.startsWith("  --")).map((l) => l.replace(`${root}/`, "")));
    }
  } catch (e) {
    if (created) rmSync(dir, { recursive: true, force: true });
    else for (const f of written) rmSync(f, { force: true });
    throw e;
  }
  return notes;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ version?: string, dryRun: boolean, checkDocs: boolean, since?: string }} */
  const opts = { dryRun: false, checkDocs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i]);
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--check-docs") opts.checkDocs = true;
    else if (a === "--since") {
      opts.since = argv[++i];
      if (!opts.since) throw new Fail("--since needs a commit or tag");
    } else if (a.startsWith("-")) throw new Fail(`Unknown option ${a}. Usage: prepare.mjs X.Y.Z [--dry-run] [--check-docs] [--since REF]`);
    else if (opts.version) throw new Fail("Give one version.");
    else opts.version = a;
  }
  if (!opts.version) throw new Fail("Usage: prepare.mjs X.Y.Z [--dry-run] [--check-docs] [--since REF]");
  if (!SEMVER.test(opts.version)) throw new Fail(`"${opts.version}" is not a version like 0.6.0.`);
  return opts;
}

/** @param {string[]} argv */
function prepare(argv, cwd = process.cwd()) {
  const opts = parseArgs(argv);
  const version = /** @type {string} */ (opts.version);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const read = (/** @type {string} */ p) => readFileSync(join(root, p), "utf8");
  if (!existsSync(join(root, VERSION_FILE))) throw new Fail(`${VERSION_FILE} is missing: run it in the repository.`);

  // the tree must agree with itself before it is bumped
  const current = APP_VERSION_LINE.exec(read(VERSION_FILE))?.[1];
  if (!current) throw new Fail(`APP_VERSION is missing from ${VERSION_FILE}.`);
  for (const p of PACKAGES) {
    const v = PACKAGE_VERSION_LINE.exec(read(p))?.[1];
    if (v !== current) throw new Fail(`${p} is ${v}, APP_VERSION is ${current}. Make them agree first.`);
  }

  const touched = [VERSION_FILE, ...PACKAGES, CHANGELOG, FRAGMENTS];
  const dirty = git(root, ["status", "--porcelain", "--", ...touched]);
  if (dirty) throw new Fail(`Uncommitted changes in files this changes. Commit or discard them first:\n${dirty}`);

  const tags = git(root, ["tag", "--list", "v*"])
    .split("\n")
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => compare(b.slice(1), a.slice(1)));
  const newest = tags[0];
  if (newest && compare(version, newest.slice(1)) <= 0) throw new Fail(`${version} is not above the newest release ${newest}.`);
  if (compare(version, current) <= 0) throw new Fail(`${version} is not above the current version ${current}.`);

  const fileNames = existsSync(join(root, FRAGMENTS)) ? readdirSync(join(root, FRAGMENTS)).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== HIGHLIGHTS).sort() : [];
  if (!fileNames.length) throw new Fail(`No fragments in ${FRAGMENTS}/. A release needs at least one.`);
  const fragments = fileNames.map((f) => parseFragment(`${FRAGMENTS}/${f}`, read(`${FRAGMENTS}/${f}`)));

  // what is new for a household, in the words of whoever releases: needed from HIGHLIGHTS_FROM fragments
  const highlightsFile = `${FRAGMENTS}/${HIGHLIGHTS}`;
  const hasHighlights = existsSync(join(root, highlightsFile));
  if (!hasHighlights && fileNames.length >= HIGHLIGHTS_FROM) {
    throw new Fail(
      `${fileNames.length} fragments and no ${highlightsFile}. A release of ${HIGHLIGHTS_FROM} or more fragments needs it: write 2 to 5 lines in plain English ` +
        `that say what is new for a household, one per line (a leading "- " is optional), commit the file and run this again (${FRAGMENTS}/README.md).`,
    );
  }
  const highlights = hasHighlights ? parseHighlights(highlightsFile, read(highlightsFile)) : [];

  // new migrations since the last release need a line for the installer
  let base = opts.since ?? newest;
  // how the release is called in the README of a contracts folder: its version, else what --since says
  let since = opts.since ?? newest?.slice(1);
  if (!base && existsSync(join(root, UPGRADE_FROM))) {
    // a baseline's comment line comes before its commit
    const lines = read(UPGRADE_FROM).split("\n").map((l) => l.trim()).filter(Boolean);
    const at = lines.findLastIndex((l) => !l.startsWith("#"));
    base = lines[at];
    since = /^#\s*(\d+\.\d+\.\d+)/.exec(lines[at - 1] ?? "")?.[1];
  }
  /** @type {string[]} */
  let added = [];
  if (base) {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    } catch {
      throw new Fail(`Cannot find ${base} in this clone. Run git fetch --unshallow --tags, or name another commit with --since.`);
    }
    added = git(root, ["diff", "--name-only", "--no-renames", "--diff-filter=A", base, "HEAD", "--", MIGRATIONS]).split("\n").filter((f) => f.endsWith(".sql"));
  } else {
    console.error("Note: no release tag, no baseline and no --since, so new migrations are not checked for.");
  }
  if (added.length && !fragments.some((f) => f.upgrade.length)) {
    throw new Fail(`Migrations were added since ${base}: ${added.map((f) => f.split("/").pop()).join(", ")}. Add an "upgrade: <line>" line to a fragment that tells an installer what happens.`);
  }

  // contracts/X.Y.Z and the frozen database of a release with new migrations: written below where they are missing,
  // unless a person has to write the folder
  const contractFiles = `${CONTRACTS}/${version}`;
  const fixtureFile = `${FIXTURES}/${version}.sql`;
  // without fixture.mjs (a stripped copy of the repository) there is nothing to write the database with
  const canWrite = existsSync(join(root, FIXTURE_SCRIPT));
  const make = {
    contract: added.length > 0 && !existsSync(join(root, contractFiles, "schema.sql")),
    fixture: added.length > 0 && canWrite && !existsSync(join(root, fixtureFile)),
  };
  /** @type {{ opsFrom: string, since: string } | undefined} */
  let source;
  if (make.contract) {
    const label = since ?? /** @type {string} */ (base);
    source = { opsFrom: opsSource(root, version, /** @type {string} */ (base), label), since: label };
    if (!canWrite) throw new Fail(`${FIXTURE_SCRIPT} is missing, so ${contractFiles}/ cannot be written.`);
  }
  const missing = [make.contract ? `${contractFiles}/` : "", make.fixture ? fixtureFile : ""].filter(Boolean);

  // the new files, in memory first
  const changelog = read(CHANGELOG);
  const lines = changelog.split("\n");
  const first = lines.findIndex((l) => l.startsWith("## "));
  if (first >= 0 && /^## unreleased\b/i.test(lines[first] ?? "")) throw new Fail(`${CHANGELOG} has an Unreleased section. Move its lines into fragments first.`);
  if (lines.some((l) => l.split(" ")[0] === "##" && l.split(" ")[1] === version)) throw new Fail(`${CHANGELOG} has a ${version} section already.`);
  const section = buildSection(version, fragments, highlights);
  const preamble = lines.slice(0, first < 0 ? lines.length : first).join("\n").replace(/\n*$/, "");
  const newChangelog = `${preamble ? `${preamble}\n\n` : ""}${first < 0 ? `${section.trimEnd()}\n` : `${section}${lines.slice(first).join("\n")}`}`;
  /** @type {Record<string, string>} */
  const files = { [CHANGELOG]: newChangelog };
  files[VERSION_FILE] = read(VERSION_FILE).replace(APP_VERSION_LINE, `export const APP_VERSION = "${version}";`);
  for (const p of PACKAGES) files[p] = read(p).replace(PACKAGE_VERSION_LINE, (line) => line.replace(/"version": "[^"]*"/, `"version": "${version}"`));

  // what release.yml and the publish step will read from the result
  const problems = [];
  if (APP_VERSION_LINE.exec(files[VERSION_FILE] ?? "")?.[1] !== version) problems.push(VERSION_FILE);
  for (const p of PACKAGES) if (PACKAGE_VERSION_LINE.exec(files[p] ?? "")?.[1] !== version) problems.push(p);
  const top = /^## ([^ \n]*).*/m.exec(newChangelog)?.[1];
  if (top !== version) problems.push(`${CHANGELOG} top heading is ${top}`);
  const notes = newChangelog.split("\n");
  const at = notes.findIndex((l) => l.startsWith("## ") && l.split(" ")[1] === version);
  const end = notes.findIndex((l, i) => i > at && l.startsWith("## "));
  // the public CHANGELOG has no private block, and its section must still say something
  const shown = notes.slice(at + 1, end < 0 ? undefined : end).join("\n").replace(new RegExp(`^${PRIVATE_OPEN}\\n[\\s\\S]*?^${PRIVATE_CLOSE}\\n`, "gm"), "");
  if (!shown.trim()) problems.push(`the public ${CHANGELOG} would have no text for ${version} (every entry is Internal: write ${highlightsFile} or add an entry of another section)`);
  if (problems.length) throw new Fail(`The result would fail the release checks: ${problems.join(", ")}.`);

  if (opts.checkDocs && !opts.dryRun) {
    console.log(
      `Checks pass for ${current} -> ${version}: ${fileNames.length} fragments${added.length ? `, ${added.length} new migrations, ${missing.length ? `${list(missing)} will be written` : `${CONTRACTS}/${version} present`}` : ""}. Nothing written.`,
    );
    return;
  }
  if (opts.dryRun) {
    console.log(section.trimEnd());
    if (missing.length) console.log(`\nWould write ${list(missing)}${source ? ` (the ops-*.json files copied from ${CONTRACTS}/${source.opsFrom})` : ""}.`);
    console.log(`\nDry run: ${current} -> ${version}, ${fileNames.length} fragments, nothing written.`);
    return;
  }
  // before the version files change: the contracts test refuses a version that is already the current one
  const wrote = missing.length ? writeContract(root, version, make, source) : [];
  for (const [p, text] of Object.entries(files)) writeFileSync(join(root, p), text);
  for (const f of fileNames) unlinkSync(join(root, FRAGMENTS, f));
  if (hasHighlights) unlinkSync(join(root, highlightsFile));
  console.log(`${current} -> ${version}: ${[VERSION_FILE, ...PACKAGES, CHANGELOG].join(", ")}; ${fileNames.length} fragments${hasHighlights ? " and the highlights" : ""} merged and removed.`);
  if (added.length) console.log(`New migrations: ${added.map((f) => f.split("/").pop()).join(", ")}.${missing.length ? "" : ` ${CONTRACTS}/${version} and ${fixtureFile} are in place.`}`);
  for (const n of wrote) console.log(n);
  console.log(`Next: read the diff and CHANGELOG.md, then git add -A && git commit -m "Release ${version}".`);
}

/**
 * `--check-fragment FILE...`: the check of --check-docs for single files, so a landing can refuse a bad one at once.
 * The highlights file is read as highlights, any other file as a fragment; the first bad file stops it with its sentence.
 * @param {string[]} files
 */
function checkFragments(files, cwd = process.cwd()) {
  if (!files.length) throw new Fail("Usage: prepare.mjs --check-fragment FILE...");
  for (const f of files) {
    const text = readFileSync(join(cwd, f), "utf8");
    if (f.split("/").pop() === HIGHLIGHTS) parseHighlights(f, text);
    else parseFragment(f, text);
  }
  console.log(`${files.length} fragment file(s) pass.`);
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--check-fragment") checkFragments(args.slice(1));
  else prepare(args);
} catch (e) {
  if (!(e instanceof Fail)) throw e;
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
