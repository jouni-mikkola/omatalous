/** DataTable (components/table): caption and scopes, the kind of a column, the sort, the foot of the server's figures, the phone classes. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartTable } from "../src/components/table/ChartTable.tsx";
import { type Column, DataTable, type DataTableProps } from "../src/components/table/DataTable.tsx";

type Row = { id: string; name: string; cents: number; n: number };
const rows: Row[] = [
  { id: "a", name: "Öljy", cents: 2990, n: 1 },
  { id: "b", name: "Auto", cents: 5000, n: 2 },
];
const columns: Column<Row>[] = [
  {
    key: "name",
    label: "Nimi",
    kind: "text",
    rowHead: true,
    sortValue: (r) => r.name,
    cell: (r) => r.name,
  },
  {
    key: "sum",
    label: "Summa",
    kind: "money",
    main: true,
    precision: "cents",
    cents: (r) => r.cents,
  },
  {
    key: "n",
    label: "Kertaa",
    kind: "count",
    optional: true,
    phone: "hide",
    cell: (r) => String(r.n),
  },
];
const render = (extra: Partial<DataTableProps<Row>> = {}): string =>
  renderToStaticMarkup(
    createElement(DataTable<Row>, {
      id: "t",
      caption: "Esimerkki",
      rows,
      rowKey: (r) => r.id,
      columns,
      ...extra,
    }),
  );

describe("DataTable", () => {
  it("always has a caption, scoped heads and a row head", () => {
    const html = render();
    expect(html).toContain('<caption class="sr-only">Esimerkki</caption>');
    expect(html).toContain('<th scope="row" class="rt-rowhead">Öljy</th>');
    expect(html.match(/scope="col"/g)).toHaveLength(3);
    expect(render({ captionVisible: true })).toContain("<caption>Esimerkki</caption>");
  });

  it("aligns figures, sorts them largest first and says it sorts before a press", () => {
    const html = render();
    expect(html).toContain('class="num" aria-sort="none"');
    // the server's order until a press
    expect(html.indexOf("Öljy")).toBeLessThan(html.indexOf("Auto"));
  });

  it("prints a money column to its own precision", () => {
    expect(render()).toContain("29,90");
    const euros = render({
      columns: columns.map((c) => (c.key === "sum" ? { ...c, precision: "euros" as const } : c)),
    });
    expect(euros).not.toContain("29,90");
    expect(euros).toContain("30");
  });

  it("shows the passed nodes in the foot and nothing of its own", () => {
    const total: ReactNode = createElement("b", null, "77,77 €");
    const html = render({
      total: { label: "Yhteensä", cells: { sum: total } },
    });
    expect(html).toContain('<tfoot><tr class="rt-total"><th scope="row">Yhteensä</th>');
    expect(html).toContain("<b>77,77 €</b>");
    expect(html).not.toContain("79,90");
    expect(render()).not.toContain("<tfoot");
  });

  it("draws the bracket from the sums, the phone layout from `phone` and hides a phone column", () => {
    const html = render({
      sums: ["sum"],
      total: { label: "Yhteensä", cells: { sum: "x" } },
    });
    expect(html).toContain('<tbody class="adds-up">');
    expect(html).toContain("part-first");
    expect(html).toContain("part-last");
    expect(html).toContain('class="num sum"');
    expect(html).toContain('class="num sum-pad"');
    expect(html).toContain("rt-cards");
    expect(html).toContain("hide-phone");
    expect(render({ phone: "scroll" })).toContain("rt-scroll");
    expect(render({ phone: "scroll" })).not.toContain("rt-cards");
  });

  it("offers the column choice for an optional column and a live region for the sort", () => {
    const html = render();
    expect(html).toContain("<summary>Sarakkeet</summary>");
    expect(html).toContain('role="status"');
  });

  it("keeps a detail row closed until its chevron is pressed", () => {
    const html = render({
      drill: (r) => `rivi ${r.id}`,
      drillLabel: (r) => `Avaa ${r.name}`,
    });
    expect(html).toContain('aria-label="Avaa Öljy"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("rt-detail");
  });
});

describe("ChartTable", () => {
  it("names the chart in its caption, puts the unit in the head and prints the series' own rows", () => {
    const html = renderToStaticMarkup(
      createElement(ChartTable, {
        id: "c",
        xLabel: "Kuukausi",
        series: [{ key: "v", label: "Menot" }],
        rows: [
          { key: "2025-01", label: "tammikuu", values: [12300] },
          { key: "2025-02", label: "helmikuu", values: [null] },
        ],
      }),
    );
    expect(html).toContain("Menot (€)");
    expect(html).toMatch(/123\s€/);
    expect(html).toContain("–");
    expect(html).toContain('<th scope="row" class="rt-rowhead">tammikuu</th>');
  });
});

describe("a table of key and value", () => {
  it("takes a table class, a row class, row attributes, a bar column and no head", () => {
    const html = render({
      className: "merchant-table",
      rowClassName: (r) => (r.n > 1 ? "muted" : undefined),
      rowProps: (r) => ({ "data-row": r.id }),
      headless: true,
      columns: [...columns, { key: "bar", label: "Osuus", kind: "share", bar: { value: (r) => r.cents, max: 10000 } }],
    });
    expect(html).toContain("merchant-table");
    expect(html).not.toContain("<thead");
    expect(html).toContain('data-row="a"');
    expect(html).toMatch(/<tr[^>]*class="muted"/);
    expect(html).toContain("width:50.0%");
  });

  it("keeps its head by default", () => {
    expect(render()).toContain("<thead");
  });
});

describe("handlers, colgroup and a node label", () => {
  it("passes handlers to a row, writes a colgroup and an empty row, and names a node head by its text", () => {
    const html = render({
      phone: "none",
      colgroup: ["day", "", "sum"],
      rowProps: () => ({ onPointerEnter: () => undefined, onFocus: () => undefined, "data-row": "x" }),
      columns: [{ ...columns[0]!, label: createElement("span", null, "Nimi ", createElement("small", null, "huomio")), text: "Nimi" }, columns[1]!],
    });
    expect(html).toContain('<col class="day"/><col/><col class="sum"/>');
    expect(html).toContain("<small>huomio</small>");
    expect(html).not.toContain("rt-cards");
    expect(render({ rows: [], empty: "Ei rivejä." })).toContain("Ei rivejä.");
  });

  it("keeps a sub-row always open under its row", () => {
    const html = render({ subRow: (r) => (r.id === "a" ? "Alarivi" : null) });
    expect(html.match(/class="rt-subrow"/g)).toHaveLength(1);
    expect(html).toContain('<td colSpan="3">Alarivi</td>');
  });

  it("opens a drill from the page and leaves the chevron to it", () => {
    const base = { drill: (r: Row) => `Tiedot ${r.id}`, drillButton: false };
    const html = render({ ...base, open: "b", onOpen: () => {} });
    expect(html).toContain("Tiedot b");
    expect(html).not.toContain("Tiedot a");
    expect(html).not.toContain("rt-drill");
    expect(render({ ...base, open: null })).not.toContain("Tiedot");
  });

  it("styles a cell by its row", () => {
    const html = render({ columns: columns.map((c) => (c.key === "n" ? { ...c, style: (r: Row) => ({ ["--part" as string]: r.n }) } : c)) });
    expect(html).toContain('style="--part:1"');
    expect(html).toContain('style="--part:2"');
  });

  it("writes a two-row head with spans and leaves the covered columns out of the second row", () => {
    const html = render({
      headTop: {
        covered: ["name"],
        cells: [
          { key: "name", label: "Nimi", rowSpan: 2 },
          { key: "g", label: "Ryhmä", colSpan: 2 },
        ],
      },
    });
    expect(html).toContain('<th rowSpan="2" scope="col">Nimi</th>');
    expect(html).toContain('colSpan="2" scope="colgroup"');
    expect(html.match(/<tr>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html.match(/scope="col"/g)).toHaveLength(3);
  });

  it("writes grouped bodies with the group's figure above its rows", () => {
    const html = render({
      groups: [
        { key: "x", title: "Huomenna", figure: "79,90 €", rows: [rows[0]!], adds: true },
        { key: "y", title: "Viikon päästä", rows: [rows[1]!] },
      ],
    });
    expect(html.match(/<tbody/g)).toHaveLength(2);
    expect(html).toContain('<th colSpan="2" scope="rowgroup">Huomenna</th>');
    expect(html).toContain('<th colSpan="3" scope="rowgroup">Viikon päästä</th>');
    expect(html).toContain("79,90 €");
    expect(html).toContain('class="adds-up"');
  });

  it("leaves the rows a page writes under a row to the page, and names a head class and an empty head cell", () => {
    const html = render({
      rowsAfter: (r) => (r.id === "a" ? createElement("tr", { className: "edit-row" }, createElement("td", { colSpan: 3 }, "Lomake")) : null),
      columns: columns.map((c) => (c.key === "n" ? { ...c, headClass: "acc-n" } : c.key === "sum" ? { ...c, emptyHead: true } : c)),
      headTop: { cells: [{ key: "e", label: "", empty: true, rowSpan: 2 }] },
    });
    expect(html.match(/class="edit-row"/g)).toHaveLength(1);
    expect(html.indexOf("Öljy")).toBeLessThan(html.indexOf("Lomake"));
    expect(html.indexOf("Lomake")).toBeLessThan(html.indexOf("Auto"));
    expect(html).toContain('<th scope="col" class="num hide-phone acc-n">Kertaa</th>');
    expect(html).toContain('<td rowSpan="2"></td>');
    expect(html).toContain('<td class="num"></td>');
  });
});
