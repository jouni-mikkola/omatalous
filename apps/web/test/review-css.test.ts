import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = readFileSync(new URL("../src/styles/review.css", import.meta.url), "utf8");
const bodyOf = (selector: string) => rules(css).find((r) => r.selector === selector)?.body ?? "";

describe("the width of Tarkistettavat", () => {
  it("gives the card the page's width and caps what it says to a measure in ch, so a sum stays near its payee", () => {
    expect(bodyOf(".review")).not.toMatch(/max-width|max-inline-size/);
    const capped = rules(css).find((r) => /max-inline-size:\s*62ch/.test(r.body))?.selector.split(",").map((s) => s.trim()) ?? [];
    for (const part of [".review-line", ".review-row-list", ".review-q", ".review-choices", ".review-plan", ".review-note", ".review-later"]) {
      expect(capped, `${part} has a measure`).toContain(part);
    }
  });
});
