/** A chart and its table are one part: no switch between them, the table stands under the chart and a pick filters it (ADR 0018). */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartWithTable } from "../src/components/table/selection.tsx";
import { Table } from "../src/components/table/Table.tsx";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("chart and table together", () => {
  it("the panel and the question frame hold no view switch", () => {
    const parts = read("../src/charts/forms/parts.tsx");
    expect(parts).not.toContain("TableToggle");
    expect(parts).toContain("<ChartWithTable");
  });
  it("Menojen muutos keeps the one panel frame", () => {
    expect(read("../src/pages/reports/sections/SpendingChange.tsx")).toContain("<ReportPanel ");
  });
  it("draws the chart first and the table under it, both in sight", () => {
    const rows = [{ k: "a", n: "Ensimmäinen" }, { k: "b", n: "Toinen" }];
    const table = createElement(Table<(typeof rows)[number]>, { caption: "Rivit", rows, rowKey: (r) => r.k, columns: [{ key: "n", label: "Nimi", kind: "text", rowHead: true, cell: (r) => r.n }] });
    const out = renderToStaticMarkup(createElement(ChartWithTable, { chart: createElement("svg", { id: "kaavio" }), table }));
    expect(out.indexOf('id="kaavio"')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("<table")).toBeGreaterThan(out.indexOf('id="kaavio"'));
    expect(out).toContain("Ensimmäinen");
    expect(out).toContain("Toinen");
    expect(out).not.toContain("rt-filter");
  });
});
