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

  it("draws the loading frames as the panels at their final size with bars and no runner, and shows the frames, not the word alone, before the meta is known", () => {
    expect(css("base.css")).toMatch(/\.sk-bar \{[^}]*background: var\(--surface-2\)/);
    expect(css("base.css")).not.toMatch(/@keyframes load-run/);
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/<div className="empty" role="status">Ladataan…<\/div>/);
    expect(app.match(/<Loading \/>/g)).toHaveLength(2);
  });

  it("shows the wizard's failed step as the error card every page uses", () => {
    const wizard = readFileSync(new URL("../src/pages/Wizard.tsx", import.meta.url), "utf8");
    expect(wizard).toMatch(/<div className="card error" role="alert">\s*<p>\{loaded\.error\}<\/p>\s*<button className="btn" type="button" onClick=\{loaded\.reload\}>/);
  });

  it("keeps the error card's sentence level with its edges", () => {
    expect(css("base.css")).toMatch(/\.card\.error > p \{[^}]*margin: 0 0 var\(--sp-12\)/);
  });

  it("draws no column register: the tick row under the band went with the corner marks (VD0)", () => {
    expect(css("marks.css")).not.toMatch(/\.sheet::before/);
  });

  it("numbers no row of money in, and keeps the sub line under the name", () => {
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked \{ counter-increment: none; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked > :first-child::before \{ content: ""; \}/);
    expect(css("categories.css")).toMatch(/\.merchant-table\.ranked \.m-name \.sub \{ padding-left: 32px; \}/);
  });

  it("lets the category select, the search of Kauppiaat and the rule field read whole", () => {
    expect(css("transactions.css")).toMatch(/\.tx-chip \{[^}]*max-width: 15rem;/);
    expect(css("transactions.css")).toMatch(/\.filters:not\(:has\(\.filter-toggle\)\) form \{ flex: 1 1 100%; \}/);
    expect(css("categories.css")).toMatch(/\.rule-form input\[type="text"\] \{ flex: 1 1 18rem; max-width: 24rem; min-width: 0; \}/);
  });

  it("gives a calculation without a chart a measure, its heads flush, and the merchant's cells four to a row", () => {
    expect(css("optimise.css")).toMatch(/\.evidence-part:not\(:has\(\.chart\)\) \{ max-width: 36rem; \}/);
    expect(css("optimise.css")).toMatch(/\.evidence-rows th \{ padding-left: 0; \}/);
    expect(css("transactions.css")).toMatch(/\.kv:has\(> :nth-child\(7\)\) \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
    expect(css("categories.css")).toMatch(/\.rule-form \{ display: grid; grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(css("transactions.css")).toMatch(/\.filters \.badge \{ max-width: 100%; white-space: normal; overflow-wrap: anywhere;/);
  });
});
