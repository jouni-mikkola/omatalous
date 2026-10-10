#!/usr/bin/env node
// @ts-check
/**
 * Prepares the release commit: tools/release/prepare.mjs X.Y.Z [--dry-run] [--since REF]
 *
 * Bumps apps/server/src/version.ts and the three package.json files, builds the `## X.Y.Z` section of CHANGELOG.md
 * from changelog.d/*.md (README.md excepted) and removes the fragments. Nothing is committed. Run it in the private
 * repository on a clean tree, read the diff, then commit.
 *
 * A fragment starts with `section: <name>`. Its other lines are entries for that section, `upgrade: <line>` lines go
 * to the Upgrade list (changelog.d/README.md).
 *
 * It refuses a version that is not above the newest v* tag and the current version, an Unreleased heading in
 * CHANGELOG.md, and a release that adds migration files since the last release without an `upgrade:` line. The last
 * release is the newest v* tag. The private repository has none, so then it is the newest commit in
 * .github/upgrade-from.txt. --since REF names another one. The result is checked the way release.yml and
 * publish-public.sh check a release before anything is written.
 *
 * Node built-ins only, so it runs before `pnpm install`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The order of the sections in CHANGELOG.md. */
const SECTIONS = ["Money and reports", "Fetching and importing", "Look", "Reliability", "Maintenance", "For developers"];

const VERSION_FILE = "apps/server/src/version.ts";
const PACKAGES = ["apps/server/package.json", "apps/web/package.json", "packages/core/package.json"];
const MIGRATIONS = "apps/server/migrations";
const FRAGMENTS = "changelog.d";
const CHANGELOG = "CHANGELOG.md";
const UPGRADE_FROM = ".github/upgrade-from.txt";
// the patterns release.yml and publish-public.sh read the version with
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
    } else if (/^\s/.test(line) && entries.length) {
      // an indented line continues the entry before it
      entries[entries.length - 1] += ` ${line.trim()}`;
    } else {
      entries.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }
  if (!section) throw new Fail(`${name}: no "section: <name>" line. Sections: ${SECTIONS.join(", ")}`);
  if (!SECTIONS.includes(section)) throw new Fail(`${name}: unknown section "${section}". Sections: ${SECTIONS.join(", ")}`);
  if (!entries.length && !upgrade.length) throw new Fail(`${name}: no text under the section line`);
  return { name, section, entries, upgrade };
}

/**
 * The text of the new CHANGELOG section.
 * @param {string} version
 * @param {ReturnType<typeof parseFragment>[]} fragments
 */
function buildSection(version, fragments) {
  let out = `## ${version}\n\n`;
  for (const section of SECTIONS) {
    const entries = fragments.filter((f) => f.section === section).flatMap((f) => f.entries);
    if (entries.length) out += `${section}\n\n${entries.map((e) => `- ${e}`).join("\n")}\n\n`;
  }
  const upgrade = fragments.flatMap((f) => f.upgrade);
  if (upgrade.length) out += `Upgrade\n\n${upgrade.map((e) => `- ${e}`).join("\n")}\n\n`;
  return out;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ version?: string, dryRun: boolean, since?: string }} */
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i]);
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--since") {
      opts.since = argv[++i];
      if (!opts.since) throw new Fail("--since needs a commit or tag");
    } else if (a.startsWith("-")) throw new Fail(`Unknown option ${a}. Usage: prepare.mjs X.Y.Z [--dry-run] [--since REF]`);
    else if (opts.version) throw new Fail("Give one version.");
    else opts.version = a;
  }
  if (!opts.version) throw new Fail("Usage: prepare.mjs X.Y.Z [--dry-run] [--since REF]");
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

  const fileNames = existsSync(join(root, FRAGMENTS)) ? readdirSync(join(root, FRAGMENTS)).filter((f) => f.endsWith(".md") && f !== "README.md").sort() : [];
  if (!fileNames.length) throw new Fail(`No fragments in ${FRAGMENTS}/. A release needs at least one.`);
  const fragments = fileNames.map((f) => parseFragment(`${FRAGMENTS}/${f}`, read(`${FRAGMENTS}/${f}`)));

  // new migrations since the last release need a line for the installer
  let base = opts.since ?? newest;
  if (!base && existsSync(join(root, UPGRADE_FROM))) {
    base = read(UPGRADE_FROM).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).pop();
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

  // the new files, in memory first
  const changelog = read(CHANGELOG);
  const lines = changelog.split("\n");
  const first = lines.findIndex((l) => l.startsWith("## "));
  if (first >= 0 && /^## unreleased\b/i.test(lines[first] ?? "")) throw new Fail(`${CHANGELOG} has an Unreleased section. Move its lines into fragments first.`);
  if (lines.some((l) => l.split(" ")[0] === "##" && l.split(" ")[1] === version)) throw new Fail(`${CHANGELOG} has a ${version} section already.`);
  const section = buildSection(version, fragments);
  const preamble = lines.slice(0, first < 0 ? lines.length : first).join("\n").replace(/\n*$/, "");
  const newChangelog = `${preamble ? `${preamble}\n\n` : ""}${first < 0 ? `${section.trimEnd()}\n` : `${section}${lines.slice(first).join("\n")}`}`;
  /** @type {Record<string, string>} */
  const files = { [CHANGELOG]: newChangelog };
  files[VERSION_FILE] = read(VERSION_FILE).replace(APP_VERSION_LINE, `export const APP_VERSION = "${version}";`);
  for (const p of PACKAGES) files[p] = read(p).replace(PACKAGE_VERSION_LINE, (line) => line.replace(/"version": "[^"]*"/, `"version": "${version}"`));

  // what release.yml and publish-public.sh will read from the result
  const problems = [];
  if (APP_VERSION_LINE.exec(files[VERSION_FILE] ?? "")?.[1] !== version) problems.push(VERSION_FILE);
  for (const p of PACKAGES) if (PACKAGE_VERSION_LINE.exec(files[p] ?? "")?.[1] !== version) problems.push(p);
  const top = /^## ([^ \n]*).*/m.exec(newChangelog)?.[1];
  if (top !== version) problems.push(`${CHANGELOG} top heading is ${top}`);
  const notes = newChangelog.split("\n");
  const at = notes.findIndex((l) => l.startsWith("## ") && l.split(" ")[1] === version);
  const end = notes.findIndex((l, i) => i > at && l.startsWith("## "));
  if (!notes.slice(at + 1, end < 0 ? undefined : end).join("").trim()) problems.push(`${CHANGELOG} has no text for ${version}`);
  if (problems.length) throw new Fail(`The result would fail the release checks: ${problems.join(", ")}.`);

  if (opts.dryRun) {
    console.log(section.trimEnd());
    console.log(`\nDry run: ${current} -> ${version}, ${fileNames.length} fragments, nothing written.`);
    return;
  }
  for (const [p, text] of Object.entries(files)) writeFileSync(join(root, p), text);
  for (const f of fileNames) unlinkSync(join(root, FRAGMENTS, f));
  console.log(`${current} -> ${version}: ${[VERSION_FILE, ...PACKAGES, CHANGELOG].join(", ")}; ${fileNames.length} fragments merged and removed.`);
  if (added.length) console.log(`New migrations: ${added.map((f) => f.split("/").pop()).join(", ")}. A schema change also needs apps/server/test/fixtures/db/${version}.sql (docs/RELEASING.md).`);
  console.log(`Next: read the diff and CHANGELOG.md, then git add -A && git commit -m "Release ${version}".`);
}

try {
  prepare(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof Fail)) throw e;
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
