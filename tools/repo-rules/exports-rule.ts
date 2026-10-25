/** Rule 24's repository assertions. The detector's fixture tests do not register another repository-wide scan. */
import { describe, expect, it } from "vitest";
import { OWNERS, READERS, unreadExports } from "./exports.ts";
import { type Finding, expectNoFindings, lineIn, parse, readText, repoFiles, sourceFiles } from "./lib.ts";

const LIST = "tools/repo-rules/unread-exports.txt";
const LISTS = () => [LIST, ...repoFiles().filter((f) => f !== LIST && f.endsWith("/unread-exports.txt"))];
const listed = () => LISTS().flatMap((list) => readText(list).split("\n").filter(Boolean).map((key) => ({ list, key })));

describe("repo rules: unread exports (rule 24)", () => {
  // Both assertions inspect the same cached working tree; the second needs no second traversal of every AST.
  let unread: ReturnType<typeof unreadExports> | undefined;
  const live = () => (unread ??= unreadExports(sourceFiles(...READERS), parse));

  it("rule 24a: an export of core or the server is read by another source file, except the list", () => {
    expect(sourceFiles(...OWNERS).length, "the scan found the sources").toBeGreaterThan(100);
    const known = new Set(listed().map((l) => l.key));
    const found: Finding[] = live()
      .filter((u) => !known.has(u.key))
      .map((u) => ({ file: u.file, line: u.line, why: `export ${u.key.split("  ")[1]} is read by no other source file (a test does not count)` }));
    expectNoFindings("unread exports", found, `delete the export with its test, or drop \`export\` when only its own file uses it. Do not add it to ${LIST}.`);
  }, 30_000);

  it("rule 24b: every entry of the list is still an unread export, so the list shrinks when one is deleted or read", () => {
    const keys = new Set(live().map((u) => u.key));
    const found: Finding[] = listed()
      .filter((l) => !keys.has(l.key))
      .map((l) => ({ file: l.list, line: lineIn(l.list, l.key), why: `no longer an unread export, delete the line: ${l.key}` }));
    expectNoFindings("unread exports list", found, "remove the listed lines from their list. Good: the export is gone or read.");
  }, 30_000);
});
