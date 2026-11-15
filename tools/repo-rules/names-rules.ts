/** Rule 50 (the detector is names.ts, its own tests names.test.ts). */
import { describe, it } from "vitest";
import { expectNoFindings, type Finding, parse, sourceFiles } from "./lib.ts";
import { unnamedControls } from "./names.ts";

describe("repo rules: names", () => {
  it("rule 50: every button, link, summary and field of the web app has an accessible name", () => {
    const found: Finding[] = [];
    for (const file of sourceFiles("apps/web/src/").filter((f) => f.endsWith(".tsx"))) {
      for (const { line, tag } of unnamedControls(parse(file))) found.push({ file, line, why: `<${tag}> has no text, label or aria-label` });
    }
    expectNoFindings("controls without a name", found, "give it a word a screen reader says: text in it, an aria-label, or a <label> around a field. A mark with no word is an IconButton (components/ui/IconButton.tsx) with its label.");
  });
});
