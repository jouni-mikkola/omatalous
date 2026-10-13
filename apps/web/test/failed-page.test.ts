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

  it("draws the column register only on a page grid, never over a lone card or the loading frames", () => {
    const marks = css("marks.css");
    expect(marks).toMatch(/\.sheet:not\(:has\(\.page-grid\)\)::before, \.sheet:not\(:has\(\.page-grid\)\)::after,/);
    expect(marks).toMatch(/\.sheet:has\(\.card\.error, \.skeleton\)::before, \.sheet:has\(\.card\.error, \.skeleton\)::after \{ content: none; \}/);
    expect(marks).not.toContain("tx-page");
  });

  it("numbers no row of money in, and keeps the sub line under the name", () => {
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked \{ counter-increment: none; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked > :first-child::before \{ content: ""; \}/);
    expect(css("categories.css")).toMatch(/\.merchant-table\.ranked \.m-name \.sub \{ padding-left: 32px; \}/);
  });

  it("lets the category select, the search of Kauppiaat and the rule field read whole", () => {
    expect(css("transactions.css")).toMatch(/min-width: 1000px\) \{ \.tx-table td select, \.tx-table td \.select-lite \{ max-width: 15rem; \}/);
    expect(css("transactions.css")).toMatch(/\.filters:not\(:has\(\.filter-toggle\)\) form \{ flex: 1 1 100%; \}/);
    expect(css("categories.css")).toMatch(/\.rule-form input\[type="text"\] \{ flex: 1 1 18rem; min-width: 0; \}/);
  });
});
