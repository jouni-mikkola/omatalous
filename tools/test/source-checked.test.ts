/**
 * A source install that waits for GitHub's checks (TALOUS_SOURCE_CHECKED, scripts/lib/release.sh) asks for the runs of two
 * workflow files and holds a copy of the paths for which `check` starts no run. An install cannot read the workflows of
 * the commit it is about to take, so the copies live in the script. This test holds them to the workflow files: a path
 * added to paths-ignore, a workflow renamed or one that no longer runs for every push to main fails here.
 * The behaviour itself is in source-checked.test.sh.
 */
import { describe, expect, it } from "vitest";
import { readText } from "../repo-rules/lib.ts";

const lib = readText("scripts/lib/release.sh");

/** The value of NAME=... in the script: a plain word, or the words of a (list). */
function shell(name: string): string[] {
  const m = new RegExp(`^${name}=(?:\\(([^)]*)\\)|(\\S+))$`, "m").exec(lib);
  if (!m) throw new Error(`${name} is not set in scripts/lib/release.sh`);
  return (m[1] ?? m[2] ?? "").split(/\s+/).filter(Boolean).map((w) => w.replace(/^'(.*)'$/, "$1"));
}

/** The lines under a chain of keys of a workflow, by indentation; undefined when the chain is not there. */
function under(text: string, keys: string[]): string[] | undefined {
  let lines = text.split("\n");
  for (const key of keys) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*(#.*)?$`).test(l) || new RegExp(`^\\s*${key}:\\s`).test(l));
    if (at < 0) return undefined;
    const indent = lines[at]!.search(/\S/);
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("#") && l.search(/\S/) <= indent);
    lines = [lines[at]!, ...(end < 0 ? rest : rest.slice(0, end))];
  }
  return lines;
}
const items = (lines: string[] | undefined): string[] =>
  (lines ?? []).map((l) => /^\s*-\s+(.*?)\s*$/.exec(l)?.[1]).filter((v): v is string => v !== undefined).map((v) => v.replace(/^["'](.*)["']$/, "$1"));

/** What is wrong between the script's copies and a text of ci.yml and one of privacy.yml. */
function faults(ci: string, privacy: string): string[] {
  const out: string[] = [];
  const skips = shell("CHECK_SKIPS");
  const ignored = items(under(ci, ["on", "push", "paths-ignore"]));
  if (JSON.stringify(ignored) !== JSON.stringify(skips)) out.push(`CHECK_SKIPS (${skips.join(" ")}) is not the paths-ignore of a push in ci.yml (${ignored.join(" ")})`);
  // the script reads three shapes of a path: **<end>, <folder>/** and a file of the root
  for (const p of ignored) if (!/^(\*\*[^*/]+|[^*]+\/\*\*|[^*/]+)$/.test(p)) out.push(`skips_check does not read the pattern ${p}`);
  if (under(ci, ["on", "push", "paths"])) out.push("ci.yml names paths for a push, which the script does not read");
  if (!/^name: check$/m.test(ci)) out.push("ci.yml is not the workflow named check");
  if (!/^name: privacy$/m.test(privacy)) out.push("privacy.yml is not the workflow named privacy");
  for (const [file, text] of [["ci.yml", ci], ["privacy.yml", privacy]] as const) {
    const push = under(text, ["on", "push"]);
    if (!push || !push.some((l) => /^\s*branches:\s*\[main\]\s*$/.test(l))) out.push(`${file} does not run for a push to main`);
  }
  const privacyPush = under(privacy, ["on", "push"]) ?? [];
  if (privacyPush.some((l) => /^\s*paths(-ignore)?:/.test(l))) out.push("privacy.yml skips some pushes, and the script asks it of every commit");
  return out;
}

const ci = readText(".github/workflows/ci.yml");
const privacy = readText(".github/workflows/privacy.yml");

describe("the checks a source install waits for", () => {
  it("names the two workflow files", () => {
    expect(shell("CHECK_WORKFLOW")).toEqual([".github/workflows/ci.yml"]);
    expect(shell("PRIVACY_WORKFLOW")).toEqual([".github/workflows/privacy.yml"]);
  });

  it("holds the same paths as ci.yml skips, and both workflows run for every other push to main", () => {
    expect(faults(ci, privacy)).toEqual([]);
  });

  it("names each fault put into the workflows", () => {
    expect(faults(ci.replace('      - LICENSE\n  pull_request:', '      - LICENSE\n      - tools/**\n  pull_request:'), privacy).join()).toContain("CHECK_SKIPS");
    expect(faults(ci.replace('      - "**.md"\n      - docs/**\n      - relay/**\n      - LICENSE\n  pull_request:', '      - "**.md"\n      - docs/*.txt\n      - relay/**\n      - LICENSE\n  pull_request:'), privacy).join()).toContain("does not read the pattern docs/*.txt");
    expect(faults(ci.replace(/^name: check$/m, "name: ci"), privacy).join()).toContain("not the workflow named check");
    expect(faults(ci, privacy.replace(/^name: privacy$/m, "name: scan")).join()).toContain("not the workflow named privacy");
    expect(faults(ci.replace("    branches: [main]\n    paths-ignore:", "    branches: [release]\n    paths-ignore:"), privacy).join()).toContain("ci.yml does not run for a push to main");
    expect(faults(ci, privacy.replace("  push:\n    branches: [main]\n", "  push:\n    branches: [main]\n    paths-ignore:\n      - docs/**\n")).join()).toContain("privacy.yml skips some pushes");
    expect(faults(ci, privacy.replace("  push:\n    branches: [main]\n", "")).join()).toContain("privacy.yml does not run for a push to main");
  });
});
