import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CategoryParts } from "../src/components/CategoryParts.tsx";
import { money } from "../src/format.ts";

const parts = [
  { id: "dairy", label: "Maito, juusto ja munat", cents: 4210, estimated: false },
  { id: "meat", label: "Liha", cents: 1890, estimated: true },
  { id: "unsplit", label: "Erittelemättä", cents: 900, estimated: false },
];

describe("a category's parts", () => {
  it("draws each part the server gives in its order, an estimated one with ≈", () => {
    const html = renderToStaticMarkup(createElement(CategoryParts, { parts, label: "Ruokakauppa tuoteryhmittäin" }));
    expect(html.indexOf("Maito")).toBeLessThan(html.indexOf("Liha"));
    expect(html.indexOf("Liha")).toBeLessThan(html.indexOf("Erittelemättä"));
    for (const p of parts) expect(html).toContain(money(p.cents, false));
    expect(html.match(/≈/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Ruokakauppa tuoteryhmittäin"');
  });

  it("draws nothing without parts, as in the shared build", () => {
    expect(renderToStaticMarkup(createElement(CategoryParts, { parts: undefined, label: "x" }))).toBe("");
    expect(renderToStaticMarkup(createElement(CategoryParts, { parts: [], label: "x" }))).toBe("");
  });
});
