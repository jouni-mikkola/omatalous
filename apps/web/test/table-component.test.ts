/** Table (components/table): caption and scopes, the kind of a column, the sort, the foot of the server's figures, the phone classes. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartTable } from "../src/components/table/ChartTable.tsx";
import { type Column, Table, type TableProps } from "../src/components/table/Table.tsx";

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
    sort: (r) => r.name,
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
    phone: "hide",
    cell: (r) => String(r.n),
  },
];
const render = (extra: Partial<TableProps<Row>> = {}): string =>
  renderToStaticMarkup(
    createElement(Table<Row>, {
      caption: "Esimerkki",
      rows,
      rowKey: (r) => r.id,
      columns,
      ...extra,
    }),
  );

describe("Table", () => {
  it("always has a caption, scoped heads and a row head", () => {
    const html = render();
    expect(html).toContain('<caption class="sr-only">Esimerkki</caption>');
    expect(html).toContain('<th scope="row" class="rt-rowhead">Öljy</th>');
    expect(html.match(/scope="col"/g)).toHaveLength(3);
    expect(render({ captionVisible: true })).toContain("<caption>Esimerkki</caption>");
  });

  it("aligns figures, sorts only the column that asks and keeps the given order until a press", () => {
    const html = render();
    expect(html).toContain('aria-sort="none"');
    expect(html.match(/aria-sort/g)).toHaveLength(1);
    expect(html).toContain('class="num"');
    // the given order until a press
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

  it("draws the bracket from the sums and marks a column left out on a phone", () => {
    const html = render({
      sums: ["sum"],
      total: { label: "Yhteensä", cells: { sum: "x" } },
    });
    expect(html).toContain('<tbody class="adds-up">');
    expect(html).toContain("part-first");
    expect(html).toContain("part-last");
    expect(html).toContain('class="num sum"');
    expect(html).toContain('class="num sum-pad"');
    expect(html).toContain("hide-phone");
  });

  it("names each cell for the block a narrow row becomes, and leaves the main figure to the first line", () => {
    const html = render();
    expect(html).toContain('data-rt="main"');
    expect(html).toContain('data-label="Kertaa"');
    expect(html).not.toContain('data-label="Summa"');
  });

  it("has a live region for the sort", () => {
    expect(render()).toContain('role="status"');
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
  it("takes a table class, a row class, row attributes and a bar column", () => {
    const html = render({
      className: "merchant-table",
      rowClassName: (r) => (r.n > 1 ? "muted" : undefined),
      rowProps: (r) => ({ "data-row": r.id }),
      columns: [...columns, { key: "bar", label: "Osuus", kind: "share", bar: { value: (r) => r.cents, max: 10000 } }],
    });
    expect(html).toContain("merchant-table");
    expect(html).toContain('data-row="a"');
    expect(html).toMatch(/<tr[^>]*class="muted"/);
    expect(html).toContain("width:50.0%");
  });

  it("keeps its head and reads a hidden one", () => {
    expect(render()).toContain("<thead");
    const html = render({ columns: [columns[0]!, { ...columns[1]!, headHidden: true }] });
    expect(html).toContain('<span class="sr-only">Summa</span>');
  });
});

describe("handlers and a node label", () => {
  it("passes handlers to a row and names a node head by its text", () => {
    const html = render({
      rowProps: () => ({ onPointerEnter: () => undefined, onFocus: () => undefined, "data-row": "x" }),
      columns: [{ ...columns[0]!, label: createElement("span", null, "Nimi ", createElement("small", null, "huomio")), text: "Nimi" }, columns[1]!],
    });
    expect(html).toContain("<small>huomio</small>");
    expect(html).toContain('data-row="x"');
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
    expect(html).toContain('scope="rowgroup">Huomenna</th>');
    expect(html).toContain('<th colSpan="3" scope="rowgroup">Viikon päästä</th>');
    expect(html).toContain("79,90 €");
    expect(html).toContain('class="adds-up"');
  });

  it("leaves the rows a page writes under a row to the page, and names a head class", () => {
    const html = render({
      rowsAfter: (r) => (r.id === "a" ? createElement("tr", { className: "edit-row" }, createElement("td", { colSpan: 3 }, "Lomake")) : null),
      columns: columns.map((c) => (c.key === "n" ? { ...c, headClass: "acc-n" } : c)),
    });
    expect(html.match(/class="edit-row"/g)).toHaveLength(1);
    expect(html.indexOf("Öljy")).toBeLessThan(html.indexOf("Lomake"));
    expect(html.indexOf("Lomake")).toBeLessThan(html.indexOf("Auto"));
    expect(html).toContain('<th scope="col" class="num hide-phone acc-n">Kertaa</th>');
  });

  it("folds the months of a row under a button", () => {
    const html = render({ columns: [columns[0]!, { key: "m1", label: "Tammi", kind: "money", series: true, cents: (r) => r.cents }], seriesLabel: "Kuukaudet" });
    expect(html).toContain("rt-series");
    expect(html).toContain('class="rt-fold"');
    expect(html).toContain("Kuukaudet");
  });

  it("gives a total its own button for the months, so a folded table keeps its sums within reach", () => {
    const html = render({
      columns: [columns[0]!, { key: "m1", label: "Tammi", kind: "money", series: true, cents: (r) => r.cents }],
      total: { label: "Yhteensä", cells: { m1: "30 €" } },
    });
    const foot = html.slice(html.indexOf("<tfoot>"));
    expect(foot).toContain('class="rt-fold"');
    expect(foot).toContain("rt-series");
  });

  it("cuts a long table at its page and says how many wait, and leaves a short one whole", () => {
    const many: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, name: `Rivi ${i}`, cents: i, n: i }));
    const html = render({ rows: many, page: 3 });
    expect(html.match(/scope="row"/g)).toHaveLength(3);
    expect(html).toContain("3 / 7");
    expect(html).toContain("Näytä lisää (3)");
    expect(html).not.toContain("Näytä vähemmän");
    const whole = render({ rows: many, page: 7 });
    expect(whole.match(/scope="row"/g)).toHaveLength(7);
    expect(whole).not.toContain("Näytä lisää");
  });
});
