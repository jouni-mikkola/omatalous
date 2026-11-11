import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorCard } from "../src/components/ErrorCard.tsx";
import { Loading } from "../src/components/Loading.tsx";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the page that did not come", () => {
  it("is one error notice with the sentence and the retry button", () => {
    const html = renderToStaticMarkup(createElement(ErrorCard, { message: "Palvelin ei vastaa.", onRetry: () => {} }));
    expect(html).toContain('data-tone="error"');
    expect(html).toContain("Palvelin ei vastaa.");
    expect(html).toContain("Yritä uudelleen");
  });

  it("loads as frames in one column, with no side-by-side pair", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html.match(/class="card skeleton/g)).toHaveLength(2);
    expect(html).not.toContain("grid two");
  });

  it("draws the loading frames as the panels at their final size with bars and no runner, and shows the frames, not the word alone, before the meta is known", () => {
    expect(css("base.css")).toMatch(/\.sk-bar \{[^}]*background: var\(--surface-2\)/);
    expect(css("base.css")).not.toMatch(/@keyframes load-run/);
    // the gate (App.tsx) and the shell (Shell.tsx) each show them once
    const app = ["App.tsx", "Shell.tsx"].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
    expect(app).not.toMatch(/<div className="empty" role="status">Ladataan…<\/div>/);
    expect(app.match(/<Loading \/>/g)).toHaveLength(2);
  });

  it("shows the wizard's failed step as the error notice every page uses", () => {
    const wizard = readFileSync(new URL("../src/pages/Wizard.tsx", import.meta.url), "utf8");
    expect(wizard).toContain("<ErrorCard message={loaded.error} onRetry={loaded.reload} />");
  });

  it("is an error notice: its sentence and the retry button side by side, no card", () => {
    expect(css("base.css")).toMatch(/\.notice\[data-tone="error"\] \{/);
    expect(css("base.css")).toMatch(/\.notice > \.notice-action \{/);
  });

  it("draws no column register: the tick row under the band went with the corner marks (VD0)", () => {
    expect(css("marks.css")).not.toMatch(/\.sheet::before/);
  });

  it("numbers no row of money in, and puts the number in the line of the chevron and the name", () => {
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked \{ counter-increment: none; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked > :first-child::before \{ content: ""; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.rt-detail \{ counter-increment: none; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.rt-detail > :first-child::before \{ content: ""; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr > :first-child:has\(> \.rt-lead\)::before \{ content: none; \}/);
    expect(css("marks.css")).toMatch(/\.ranked tbody tr\.unranked > :first-child > \.rt-lead::before \{ content: ""; \}/);
    expect(css("categories.css")).not.toMatch(/\.m-name \.sub \{ padding-left/);
  });

  it("lets the category select and the rule field read whole", () => {
    expect(css("transactions.css")).toMatch(/\.tx-chip \{[^}]*max-width: 15rem;/);
    expect(css("categories.css")).toMatch(/\.rule-form \.rule-pattern \{ flex: 1 1 18rem; max-width: 24rem; min-width: 0; \}/);
  });

  it("gives its heads flush, and the merchant's cells four to a row", () => {
    expect(css("transactions.css")).toMatch(/\.kv:has\(> :nth-child\(7\)\) \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
    expect(css("categories.css")).toMatch(/\.rule-form \{ display: grid; grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});
