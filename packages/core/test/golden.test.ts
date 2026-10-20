/**
 * The golden files: every statement the product makes about the demo, the life-event kit's base and seeds 1 to 5 of
 * the plain and the settled histories, one file per source (tools/findings). A change in what the product says shows
 * here as a text diff: rewrite them with `pnpm findings --golden`, commit the diff with the code and explain each
 * changed statement in the hand-back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLDEN_DIR, goldenTexts } from "../../../tools/findings/golden.ts";
import { SOURCE_IDS } from "../../../tools/findings/statements.ts";

describe("the golden files of what the product says", () => {
  const texts = goldenTexts();

  it.each(SOURCE_IDS)("%s.txt is what the source says today (pnpm findings --golden rewrites it)", (source) => {
    const file = join(GOLDEN_DIR, `${source}.txt`);
    const stored = (() => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "(missing)";
      }
    })();
    expect(texts[source], `packages/core/test/golden/${source}.txt differs: run pnpm findings --golden and read the diff`).toBe(stored);
  });

  it("gives the same text on a second run", () => {
    expect(goldenTexts()).toEqual(texts);
  });
});
