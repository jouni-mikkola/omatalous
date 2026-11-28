/** Rule 54: every message key of the Finnish tables is written out somewhere in the code, or its prefix is built at run time. */
import { describe, it } from "vitest";
import { expectNoFindings, type Finding, lineIn, readText, repoFiles } from "./lib.ts";

const BASELINE = "tools/repo-rules/message-keys-baseline.txt";

/**
 * Prefixes the code adds an id to (`t(\`category.${id}\`)`), so a key under them has no literal reference. A prefix
 * that no longer matches a key is a finding: delete it.
 */
const BUILT_PREFIXES = [
  "figure.", "bills.form.barcode_", "bills.total_", "holdings.", "inc.new_", "inc.tax_", "rep.bucket_", "theme.", "carline.", "income.type_",
  "income.group_", "rpt.ln_ref_", "pw.level_", "chart.what_", "chart.vs_", "tx.unit_", "category.", "cgroup.", "ckind.",
];

const KEY_LINE = /^\s*"([a-z0-9_]+\.[A-Za-z0-9_.-]+)":/;
const KEY_LITERAL = /["'`]([a-z0-9_]+\.[A-Za-z0-9_.-]+)["'`]/g;
const PLURAL_SUFFIX = /_(one|many|other|zero)$/;

/** The keys of the Finnish tables with the file and line they are written on. */
function definedKeys(files: readonly string[], read: (file: string) => string): { key: string; file: string; line: number }[] {
  return files.flatMap((file) =>
    read(file).split("\n").flatMap((text, i) => {
      const key = KEY_LINE.exec(text)?.[1];
      return key ? [{ key, file, line: i + 1 }] : [];
    }),
  );
}

/** The keys written as a whole string literal in the code files given. */
function literalKeys(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(KEY_LITERAL)) out.add(m[1] ?? "");
  return out;
}

/** Keys with no literal reference (their plural base counts) and no built prefix. */
function unreferencedKeys(keys: readonly string[], literals: ReadonlySet<string>, prefixes: readonly string[]): string[] {
  return keys.filter((k) => !literals.has(k) && !literals.has(k.replace(PLURAL_SUFFIX, "")) && !prefixes.some((p) => k.startsWith(p)));
}

describe("repo rules: message keys", () => {
  it("rule 54: every message key is written out in the code or built from a listed prefix (the baseline only shrinks)", () => {
    const all = repoFiles();
    const tables = all.filter((f) => /^packages\/core\/src\/messages-[a-z0-9-]+\.ts$/.test(f));
    const code = all.filter((f) => /^(apps|packages|e2e|tools)\/.*\.(tsx?|mjs)$/.test(f) && !/^packages\/core\/src\/(messages|english\/)/.test(f) && !/golden|fixtures/.test(f));
    const defined = definedKeys(tables, readText);
    const literals = literalKeys(code.map(readText));
    const baseline = new Set(readText(BASELINE).split("\n").filter(Boolean));
    const dead = new Set(unreferencedKeys(defined.map((d) => d.key), literals, BUILT_PREFIXES));
    const found: Finding[] = [];
    for (const d of defined) if (dead.has(d.key) && !baseline.has(d.key)) found.push({ file: d.file, line: d.line, why: `${d.key} is not written out anywhere: use it or delete it from the Finnish and English tables` });
    for (const key of baseline) if (!dead.has(key)) found.push({ file: BASELINE, line: lineIn(BASELINE, key), why: `${key} is used or gone: delete the line` });
    for (const p of BUILT_PREFIXES) if (!defined.some((d) => d.key.startsWith(p))) found.push({ file: "tools/repo-rules/message-keys.ts", line: lineIn("tools/repo-rules/message-keys.ts", `"${p}"`), why: `no key starts with ${p}: delete it from BUILT_PREFIXES` });
    expectNoFindings("message keys", found, "delete the key from its Finnish table and the English table beside it. Do not add it to the baseline.");
  });
});
