/**
 * Rule 35 of the repo rules: a word the glossary of docs/UI_STYLE.md removed does not come back into the text the browser
 * shows. The texts are the ones `pnpm strings` lists, read through `collect()` of tools/ui-strings.mjs like rule 28. The
 * words are in glossary.ts and have their tests in glossary.test.ts. The tests of the words sit apart from this file so
 * that they do not register the rule a second time: repo-rules.test.ts is the one file that runs it.
 */
import { describe, expect, it } from "vitest";
import { collect } from "../ui-strings.mjs";
import { removedIn } from "./glossary.ts";
import { type Finding, ROOT, expectNoFindings } from "./lib.ts";
import { TAB_NAMES, wrongTabsIn } from "./ui-paths.ts";

/** The scan is read once for both tests. */
let scanned: ReturnType<typeof collect> | undefined;
const uiTexts = () => (scanned ??= collect(ROOT, { also: ["apps/web/src/components/ops"] }));

describe("repo rules: glossary", () => {
  it("rule 35: no text the browser shows uses a word the glossary removed (Optimoi, Yli jäi, Tileillä as a name, Linkitä)", () => {
    // the folders of `pnpm strings` and the maintenance page that the tool leaves out until its release, as in rule 28
    const rows = uiTexts();
    expect(rows.length, "the scan found the UI texts").toBeGreaterThan(1000);
    const found: Finding[] = [];
    for (const r of rows) {
      for (const w of removedIn(r.text, r.file)) found.push({ file: r.file, line: r.line, why: `${w.name} (${w.fix}): ${r.text.replace(/\s+/g, " ").slice(0, 80)}` });
    }
    expectNoFindings("removed glossary words", found, "write the term of the glossary in docs/UI_STYLE.md. A word is quoted only when it is another service's own (put it in double quotes).");
  }, 90_000);

  it("rule 35: a path to a setting starts with a tab as the tab row names it (Asetukset > Palvelin ja ylläpito)", () => {
    const rows = uiTexts();
    const found: Finding[] = [];
    for (const r of rows) for (const path of wrongTabsIn(r.text)) found.push({ file: r.file, line: r.line, why: path });
    expectNoFindings("paths that name no settings tab", found, `start the path with a tab: ${TAB_NAMES.join(", ")}`);
  }, 90_000);
});
