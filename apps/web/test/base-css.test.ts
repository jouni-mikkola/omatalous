import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The selectors of base.css's top-level rules, in file order (a `@media` block counts as one rule, by its query). */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let head = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      if (depth === 0) out.push(head.trim().replace(/\s+/g, " "));
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) head = "";
    } else if (depth === 0) head += ch;
  }
  return out;
}

describe("base.css", () => {
  const selectors = topLevelSelectors(readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8"));

  it("has each rule once, so the cascade does not decide between two copies of it", () => {
    expect(selectors).toContain(".link-btn");
    expect(selectors).toContain(".empty-start");
    const twice = selectors.filter((sel, i) => !sel.startsWith("@") && selectors.indexOf(sel) !== i);
    expect(twice).toEqual([]);
  });
});
