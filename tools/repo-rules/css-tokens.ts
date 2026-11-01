/**
 * Rule 40 of the repo rules: the look comes from tokens (docs/DESIGN.md, ADR 0022). A stylesheet or a script of the web
 * app may not set by hand what a token holds: a px value (other than 0 and a 1px hairline), a colour, a font-size that
 * is not a --fs-* token, a token set again outside tokens.css, a colour in a .ts file, a look value in an inline
 * style, or a custom property set from script. The files that still do are on css-tokens-baseline.txt with their
 * counts. The list only shrinks: a count over its line fails, a count under it fails too, so the line follows the file
 * down and nothing is added back. A new file has no line, so it may have none of these.
 *
 * The one named exception is the drawn face of a bank card in holdings.css (css-look.ts, NAMED_EXCEPTIONS).
 * Rule 41 holds the same line for `Card`: the files that import it are on a list that only shrinks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cssHits, counts, definedProperties, type Hit, type Metric, sharedClasses, tsHits } from "./css-look.ts";
import { type Finding, expectNoFindings, isTestFile, readText, repoFiles, ROOT } from "./lib.ts";

const BASELINE = "tools/repo-rules/css-tokens-baseline.txt";
const TOKENS_CSS = "apps/web/src/styles/tokens.css";
const GENERATED_TS = "apps/web/src/design/tokens.ts";
const CARD = "apps/web/src/components/ui/Card.tsx";

type Baseline = Record<string, Partial<Record<Metric, number>>>;

/** Files that import `Card` today. Only shrinks: a file leaves when its last use is gone, and new code does not use it. */
const CARD_USERS: string[] = JSON.parse(readFileSync(resolve(ROOT, "tools/repo-rules/card-users.json"), "utf8"));

/** One line per file, `path  metric=count metric=count`: a line format so the publish script can drop the private paths. */
export function parseBaseline(text: string): Baseline {
  const out: Baseline = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [file, ...pairs] = line.trim().split(/\s+/);
    out[file!] = Object.fromEntries(pairs.map((p) => [p.split("=")[0]!, Number(p.split("=")[1])]));
  }
  return out;
}

const lookFiles = () =>
  repoFiles().filter(
    (f) =>
      f.startsWith("apps/web/src/") && !isTestFile(f) && f !== TOKENS_CSS && f !== GENERATED_TS && (f.endsWith(".css") || (/\.tsx?$/.test(f) && !f.endsWith(".d.ts"))),
  );

/** What each file sets by hand, from its text. `read` is a seam for the test. */
export function measure(files: readonly string[], read: (f: string) => string, tokens: ReadonlySet<string>): Map<string, Hit[]> {
  const out = new Map<string, Hit[]>();
  for (const f of files) {
    // css.ts is the one door that sets a computed value through the CSSOM (rule 45 bans the style attribute, so this is the way)
    if (f === "apps/web/src/css.ts") continue;
    const hits = f.endsWith(".css") ? cssHits(f, read(f), tokens) : tsHits(read(f));
    if (hits.length) out.set(f, hits);
  }
  return out;
}

/** Findings of a measure against a baseline: a count over its line, a count under it, and a line for a file that is gone. */
export function compare(found: Map<string, Hit[]>, baseline: Baseline, files: readonly string[]): Finding[] {
  const out: Finding[] = [];
  for (const [file, hits] of found) {
    const have = counts(hits);
    const allowed = baseline[file] ?? {};
    for (const metric of Object.keys(have) as Metric[]) {
      const n = have[metric]!;
      const cap = allowed[metric] ?? 0;
      if (n > cap) {
        for (const h of hits.filter((x) => x.metric === metric).slice(cap)) {
          out.push({ file, line: h.line, why: `${metric}: ${h.text} (${n} here, ${cap} allowed). Read the token for it (apps/web/src/styles/tokens.css) or add one to apps/web/design/tokens.json` });
        }
      }
    }
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const have = counts(found.get(file) ?? []);
    if (!files.includes(file)) out.push({ file: BASELINE, line: 1, why: `${file} is on the baseline and is gone: delete its line` });
    else for (const metric of Object.keys(allowed) as Metric[]) if ((have[metric] ?? 0) < allowed[metric]!) out.push({ file: BASELINE, line: 1, why: `${file} has ${have[metric] ?? 0} ${metric}, the baseline says ${allowed[metric]}: lower it to ${have[metric] ?? 0}` });
  }
  return out;
}

describe("repo rules: the look comes from tokens", () => {
  it("rule 40: no new px value, colour, font-size literal, redefined token, colour in a script, inline look value or setProperty; the baseline only shrinks", () => {
    const files = lookFiles();
    expect(files.length, "the scan found the web app's files").toBeGreaterThan(150);
    const tokens = definedProperties(readText(TOKENS_CSS));
    expect(tokens.size, "tokens.css defines the tokens").toBeGreaterThan(50);
    const baseline = parseBaseline(readText(BASELINE));
    expectNoFindings(
      "tokens",
      compare(measure(files, readText, tokens), baseline, files),
      `write the value as a token (docs/DESIGN.md). ${BASELINE} only shrinks: never add a line or raise a number.`,
    );
  });

  it("rule 41: only the files on card-users.json import Card, and a file whose last use is gone leaves the list", () => {
    const users = repoFiles().filter((f) => /\.tsx$/.test(f) && f !== CARD && !isTestFile(f) && /from\s+["'][^"']*components\/ui\/Card(\.tsx)?["']|from\s+["']\.\/Card(\.tsx)?["']/.test(readText(f)));
    const found: Finding[] = [];
    for (const f of users) if (!CARD_USERS.includes(f)) found.push({ file: f, line: 1, why: "imports Card: new code writes a section as a heading and a hairline (docs/DESIGN.md)" });
    for (const f of CARD_USERS) if (!users.includes(f)) found.push({ file: "tools/repo-rules/card-users.json", line: 1, why: `${f} no longer imports Card: delete it from the list` });
    expectNoFindings("Card", found, "Card stays only for its current users and is removed with the last of them.");
  });

  it("rule 46: an own class selector (.name {) is styled in one stylesheet, base.css apart: a page's sheet stays loaded after the page is left", () => {
    const sheets = new Map(
      lookFiles()
        .filter((f) => f.endsWith(".css") && f !== "apps/web/src/styles/base.css")
        .map((f) => [f, readText(f)] as const),
    );
    const found: Finding[] = [...sharedClasses(sheets)].map(([name, files]) => ({ file: files[0]!, line: 1, why: `.${name} is styled in ${files.join(" and ")}` }));
    expectNoFindings("shared class", found, "give the second thing a class of its own, or move the rules to one stylesheet: a page's sheet stays loaded, so a class styled twice changes the other page.");
  });
});
