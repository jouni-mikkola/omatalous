/**
 * Rules 25 to 27 of the repo rules: three habits of the shell scripts that a review did not keep.
 *
 * Rule 25: nothing pipes into `grep -q` (any flag group with `q`, `--quiet`, `--silent`). Under `pipefail` grep leaves
 * at the first match, the writer dies of the closed pipe, and a match reads as a miss: it cost the 0.8.7 release a
 * round. The fix is `grep ... >/dev/null`. A `grep -q` on a file is fine: no pipe is closed.
 * Rule 26: a function defined in a file under scripts/ is named a second time somewhere under scripts/. A definition
 * alone is dead code that a later reader has to work out is dead.
 * Rule 27: .gitignore keeps the files that hold a secret out of the repository.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Finding, ROOT, expectNoFindings, readText, repoFiles } from "./lib.ts";

/** A shell file: `.sh`, `.bash`, or a file without an extension whose first line is a shell shebang. */
function isShellFile(rel: string): boolean {
  if (/\.(sh|bash)$/.test(rel)) return true;
  if (!/^(scripts|tools|deploy)\//.test(rel) || /(^|\/)[^/]*\.[^/]*$/.test(rel)) return false;
  return /^#!.*\b(ba)?sh\b/.test(readFileSync(resolve(ROOT, rel), "utf8").slice(0, 80).split("\n")[0] ?? "");
}

/** Text of a shell line without a trailing comment (a `#` that starts a word, outside quotes). */
function code(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"') i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

/** The words of a command after its name, up to the operator that ends it. `quoted` words are never options. */
function words(rest: string, closer: string): { text: string; quoted: boolean; file: boolean }[] {
  const out: { text: string; quoted: boolean; file: boolean }[] = [];
  let cur = "";
  let quoted = false;
  let quote = "";
  let any = false;
  const end = () => {
    if (any) out.push({ text: cur, quoted, file: false });
    cur = "";
    quoted = false;
    any = false;
  };
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (!quote && c === closer) break;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"') cur += rest[++i] ?? "";
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
      any = true;
    } else if (c === "\\") {
      cur += rest[++i] ?? "";
      any = true;
    } else if (/\s/.test(c)) end();
    else if (";&|)}".includes(c)) break;
    else if (c === "<" || c === ">") {
      // a redirect: `< file` gives grep a file to read, `> file` and `2>&1` only move the output
      end();
      if (c === "<") out.push({ text: "<", quoted: false, file: true });
      while (rest[i + 1] === "&" || rest[i + 1] === ">" || rest[i + 1] === "<") i++;
    } else {
      cur += c;
      any = true;
    }
  }
  end();
  return out;
}

/** Options of grep that take a value as the next word (when they stand alone). */
const TAKES_VALUE = new Set(["-e", "-f", "-m", "-A", "-B", "-C", "--regexp", "--file", "--max-count", "--after-context", "--before-context", "--context", "--include", "--exclude", "--exclude-dir", "--label"]);

/** True when the words after `grep` ask for no output (`-q`, `-qF`, `-Eq`, `--quiet`, `--silent`) and name no file to read. */
export function quietOnPipe(rest: string, closer = ""): boolean {
  const ws = words(rest, closer);
  let quiet = false;
  let pattern = false;
  let operands = 0;
  let file = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (w.file) {
      file = true;
      continue;
    }
    if (!w.quoted && w.text === "--") {
      operands += ws.length - i - 1;
      break;
    }
    if (!w.quoted && /^--(quiet|silent)$/.test(w.text)) quiet = true;
    else if (!w.quoted && /^--[a-z-]+=/.test(w.text)) pattern ||= /^--(regexp|file)=/.test(w.text);
    else if (!w.quoted && w.text.startsWith("--")) {
      if (TAKES_VALUE.has(w.text)) {
        pattern ||= w.text === "--regexp" || w.text === "--file";
        i++;
      }
    } else if (!w.quoted && /^-[A-Za-z0-9]/.test(w.text)) {
      // a letter that takes a value ends the group: `-eq` is the pattern "q"
      for (let k = 1; k < w.text.length; k++) {
        const letter = w.text[k]!;
        if (letter === "q") quiet = true;
        if ("efmABC".includes(letter)) {
          if (k === w.text.length - 1) i++;
          pattern ||= letter === "e" || letter === "f";
          break;
        }
      }
    } else operands++;
  }
  return quiet && !file && operands - (pattern ? 0 : 1) < 1;
}

/** The lines of a shell text where a pipe ends in a quiet grep that reads it. A pipe at the end of a line counts for the next line. */
export function quietGrepPipes(text: string): { line: number; why: string }[] {
  const found: { line: number; why: string }[] = [];
  let carried = false;
  text.split("\n").forEach((raw, i) => {
    const src = code(raw);
    // a pipe inside a string is read too: `bash -c "cmd | grep -q x"` runs it. The quote that holds the pipe ends the command.
    const starts: { at: number; closer: string }[] = carried ? [{ at: 0, closer: "" }] : [];
    let quote = "";
    for (let k = 0; k < src.length; k++) {
      const c = src[k]!;
      if (c === "\\") {
        k++;
        continue;
      }
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === "'" || c === '"') quote = c;
      if (c !== "|") continue;
      if (src[k + 1] === "|") k++;
      else if (src[k - 1] !== ">") starts.push({ at: k + 1, closer: quote });
    }
    carried = /(^|[^|])\|\s*$/.test(src);
    for (const { at, closer } of starts) {
      const m = /^\s*(?:\w+=\S*\s+)*(?:command\s+|\\)?(?:grep|egrep|fgrep)(?=\s|$)(.*)$/.exec(src.slice(at));
      if (m && quietOnPipe(m[1] ?? "", closer)) found.push({ line: i + 1, why: `pipes into a quiet grep: ${src.trim().slice(0, 90)}` });
    }
  });
  return found;
}

/** `name() {` and `function name {` at the start of a line. */
const HEAD = /^\s*(?:function\s+([A-Za-z_]\w*)\b|([A-Za-z_]\w*)\s*\(\s*\))/;

/** The functions a shell text defines, with the line of each. */
export function definitions(text: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  text.split("\n").forEach((raw, i) => {
    const m = HEAD.exec(code(raw));
    if (m) out.push({ name: (m[1] ?? m[2])!, line: i + 1 });
  });
  return out;
}

/** True when `name` occurs in the code of `text` (comments left out) other than as the head of its own definition. */
export function namedElsewhere(text: string, name: string): boolean {
  const word = new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
  return text.split("\n").some((raw) => {
    const src = code(raw);
    const m = HEAD.exec(src);
    return word.test(m && (m[1] ?? m[2]) === name ? src.slice(m[0].length) : src);
  });
}

/** Files that keep a secret out of the repository, as git sees them. A line of .gitignore that stops matching one fails. */
export const SECRET_PATHS = [".env.new", "ops/env.prev", ".env.bak.1"];

/** The paths among `paths` that git does not ignore in the repository at `root`. */
export function notIgnored(root: string, paths: readonly string[]): string[] {
  return paths.filter((p) => {
    try {
      execFileSync("git", ["check-ignore", "-q", "--", p], { cwd: root, stdio: "ignore" });
      return false;
    } catch (err) {
      if ((err as { status?: number }).status === 1) return true;
      throw err;
    }
  });
}

describe("repo rules: shell scripts", () => {
  it("rule 25: no shell file and no workflow pipes into grep -q (under pipefail a match reads as a miss)", () => {
    const files = repoFiles().filter((f) => isShellFile(f) || /^\.github\/.+\.ya?ml$/.test(f));
    expect(files.length, "the scan found the shell files").toBeGreaterThan(30);
    const found: Finding[] = [];
    for (const file of files) for (const { line, why } of quietGrepPipes(readText(file))) found.push({ file, line, why });
    expectNoFindings("grep -q behind a pipe", found, "write `... | grep PATTERN >/dev/null` (and keep the options but q). grep -q on a file is fine.");
  });

  it("rule 26: a function defined in a file under scripts/ is named a second time under scripts/", () => {
    const files = repoFiles().filter((f) => f.startsWith("scripts/") && isShellFile(f));
    expect(files.length, "the scan found the scripts").toBeGreaterThan(10);
    const all = files.map((f) => readText(f)).join("\n");
    const found: Finding[] = [];
    for (const file of files) {
      for (const { name, line } of definitions(readText(file))) {
        if (!namedElsewhere(all, name)) found.push({ file, line, why: `${name} is defined and never named again under scripts/` });
      }
    }
    expectNoFindings("function nothing calls", found, "delete the function (and its test, if one reads it), or call it. A name used only in tools/test does not count.");
  });

  it("rule 27: .gitignore keeps the files that hold a secret out of the repository", () => {
    expect(existsSync(resolve(ROOT, ".git")), "the rule needs git").toBe(true);
    const open = notIgnored(ROOT, SECRET_PATHS);
    expectNoFindings(
      "secret files not ignored",
      open.map((p) => ({ file: ".gitignore", line: 1, why: `git does not ignore ${p}` })),
      "a line of .gitignore no longer matches it: put the line back, or the next `git add -A` commits a secret.",
    );
  });
});
