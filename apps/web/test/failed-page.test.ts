import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorCard } from "../src/components/ErrorCard.tsx";
import { Loading } from "../src/components/Loading.tsx";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the page that did not come", () => {
  it("is one card with the sentence and the retry button", () => {
    const html = renderToStaticMarkup(createElement(ErrorCard, { message: "Palvelin ei vastaa.", onRetry: () => {} }));
    expect(html).toContain('class="card error"');
    expect(html).toContain("Palvelin ei vastaa.");
    expect(html).toContain("Yritä uudelleen");
    expect(html).not.toContain("btn-small");
  });

  it("loads as frames in one column, with no side-by-side pair", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html.match(/class="card skeleton/g)).toHaveLength(2);
    expect(html).not.toContain("grid two");
  });

  it("keeps the error card's sentence level with its edges", () => {
    expect(css("base.css")).toMatch(/\.card\.error > p \{[^}]*margin: 0 0 var\(--sp-12\)/);
  });

  it("draws no column register over a lone card, the loading frames or the table page", () => {
    const marks = css("marks.css");
    expect(marks).toMatch(/\.sheet:has\(\.card\.error, \.skeleton, \.tx-page\)::before/);
    expect(marks).toMatch(/\.sheet:has\(\.card\.error, \.skeleton, \.tx-page\)::after \{ content: none; \}/);
  });
});
