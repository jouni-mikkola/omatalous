/** The toolbar's parts that need no page: the view in the address, the search words, the rows of the CSV, the column readings. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Column, chipsOf, csvValueOf, figureOf, searchFns, searchOf, setMarkup, textFromNode } from "../src/components/table/columns.ts";
import { csvLines, csvName, tableCsv } from "../src/components/table/csv.ts";
import { matchesQuery, searchWords } from "../src/components/table/model.ts";
import { Table } from "../src/components/table/Table.tsx";
import { EMPTY_VIEW, LONG_LIST_ROWS, viewFromParams, viewToParams } from "../src/components/table/view.ts";
import { PageAddressContext } from "../src/page-address.ts";

type Row = { id: string; name: string; cents: number; up: boolean };
const rows: Row[] = [
  { id: "a", name: "Ruoka; kauppa", cents: 105000, up: true },
  { id: "b", name: "Auto", cents: -250, up: false },
  { id: "c", name: "Vuokra", cents: 12600, up: true },
];
const columns: Column<Row>[] = [
  { key: "name", label: "Kategoria", kind: "text", rowHead: true, sort: (r) => r.name, search: true, chips: [{ key: "up", label: "Kasvanut", test: (r) => r.up }] },
  { key: "sum", label: "Yhteensä", kind: "money", cents: (r) => r.cents, sort: true, group: (r) => (r.up ? "Ylös" : "Alas") },
  { key: "open", label: "Avaa", kind: "text", headHidden: true, cell: () => "x" },
];

describe("the view in the address", () => {
  const known = { sort: ["name", "sum"], chips: ["up"], groups: ["sum"] };

  it("writes only what differs from the empty view", () => {
    expect(viewToParams(EMPTY_VIEW)).toEqual({});
    expect(viewToParams({ query: "ruok", chip: "up", group: "sum", sort: { key: "sum", dir: "descending" } })).toEqual({ q: "ruok", chip: "up", group: "sum", sort: "sum:desc" });
    expect(viewToParams({ ...EMPTY_VIEW, sort: { key: "name", dir: "ascending" } }, "menot")).toEqual({ "menot.sort": "name:asc" });
  });

  it("reads it back, and drops a key the table does not have", () => {
    const view = { query: "ruok", chip: "up", group: "sum", sort: { key: "sum", dir: "descending" } } as const;
    expect(viewFromParams(viewToParams(view), known)).toEqual(view);
    expect(viewFromParams({ chip: "gone", group: "gone", sort: "gone:asc" }, known)).toEqual(EMPTY_VIEW);
  });
});

describe("the search", () => {
  it("wants every word, in any case, anywhere in the searched texts", () => {
    expect(searchWords("  RUOKA  kauppa ")).toEqual(["ruoka", "kauppa"]);
    expect(matchesQuery(["Ruokakauppa", "x"], searchWords("ruoka KAUPPA"))).toBe(true);
    expect(matchesQuery(["Ruokakauppa"], searchWords("ruoka auto"))).toBe(false);
    expect(matchesQuery(["Ruokakauppa"], [])).toBe(true);
  });

  it("reads the sort value of a text column, and nothing of one that does not search", () => {
    expect(searchOf(columns[0]!)?.(rows[0]!)).toBe("Ruoka; kauppa");
    expect(searchOf(columns[1]!)).toBeUndefined();
    expect(chipsOf(columns).map((c) => c.chip.key)).toEqual(["up"]);
  });
});

describe("a cell made of components", () => {
  it("reads as empty until the renderer has arrived, then as it shows", () => {
    const Cell = () => createElement("b", null, "Auto");
    setMarkup(null);
    expect(textFromNode(createElement(Cell))).toBe("");
    expect(textFromNode(createElement("b", null, "Auto"))).toBe("Auto");
    setMarkup(renderToStaticMarkup);
    expect(textFromNode(createElement(Cell)).trim()).toBe("Auto");
  });
});

describe("the CSV", () => {
  it("holds a sum as a number in euros, leaves out a column with no name and keeps the order it is given", () => {
    const lines = csvLines(columns, [rows[1]!, rows[0]!], null);
    expect(lines).toEqual([
      ["Kategoria", "Yhteensä"],
      ["Auto", -2.5],
      ["Ruoka; kauppa", 1050],
    ]);
    expect(csvValueOf(columns[1]!, rows[2]!)).toBe(126);
  });

  it("names the group in the first column of a grouped table", () => {
    const lines = csvLines(columns, [rows[0]!, rows[2]!, rows[1]!], [
      { key: "Ylös", title: "Ylös", rows: [rows[0]!, rows[2]!] },
      { key: "Alas", title: "Alas", rows: [rows[1]!] },
    ]);
    expect(lines[0]).toEqual(["Ryhmä", "Kategoria", "Yhteensä"]);
    expect(lines[3]).toEqual(["Alas", "Auto", -2.5]);
  });

  it("is the server's format: a BOM, semicolons, a decimal comma, quotes where needed", () => {
    const text = tableCsv(columns, [rows[0]!, rows[1]!], null);
    expect(text.startsWith("﻿Kategoria;Yhteensä\r\n")).toBe(true);
    expect(text).toContain('"Ruoka; kauppa";1050\r\n');
    expect(text).toContain("Auto;-2,5\r\n");
  });

  it("names the file after the table", () => {
    expect(csvName("Kaikki kategoriat")).toBe("kaikki-kategoriat.csv");
    expect(csvName("???")).toBe("taulukko.csv");
  });
});

describe("the toolbar in a table", () => {
  const render = (extra = {}) =>
    renderToStaticMarkup(createElement(Table<Row>, { caption: "Kaikki kategoriat", rows, rowKey: (r) => r.id, columns, ...extra }));

  it("shows the chips with their counts and the search box, and the rows as given", () => {
    const html = render();
    expect(html).toContain("Taulukon rajaus: Kaikki kategoriat");
    expect(html).toMatch(/Kaikki <b>3<\/b>/);
    expect(html).toMatch(/Kasvanut <b>2<\/b>/);
    expect(html).toContain("Ryhmittely");
    // the file is a link under a long table, never a button of the bar
    expect(html).not.toContain("Lataa CSV");
  });

  it("applies the view the page hands over: the chip leaves two rows, and the note says so", () => {
    const html = render({ view: { ...EMPTY_VIEW, chip: "up" }, onView: () => {} });
    expect(html).not.toContain("Auto");
    expect(html).toContain("Näkyvissä 2 / 3 riviä.");
  });

  it("has no bar and no CSV link for a short table when no column asks for chips or grouping", () => {
    const plain = columns.map(({ search: _s, chips: _c, group: _g, ...c }) => c);
    const out = render({ columns: plain });
    expect(out).not.toContain("Taulukon rajaus");
    expect(out).not.toContain("Lataa CSV");
  });
});

describe("the search and the CSV of a long table", () => {
  const long = Array.from({ length: LONG_LIST_ROWS + 1 }, (_, i) => ({ id: String(i), name: `Kauppa ${i}`, cents: i * 100, up: false }));
  const bare: Column<Row>[] = [
    { key: "name", label: "Nimi", kind: "text", cell: (r) => createElement("a", { href: "#" }, r.name) },
    { key: "sum", label: "Summa", kind: "money", cell: (r) => `${(r.cents / 100).toString().replace(".", ",")} €` },
  ];
  const render = (rowsIn: Row[], extra = {}) => renderToStaticMarkup(createElement(Table<Row>, { caption: "Rivit", rows: rowsIn, rowKey: (r) => r.id, columns: bare, ...extra }));

  it("gives a table of more than ten rows a search box and a CSV link under it, and a short one neither", () => {
    expect(render(long)).toContain("Hae: Rivit");
    expect(render(long)).toContain("rt-csv");
    expect(render(long)).toContain("Lataa CSV");
    expect(render(long.slice(0, LONG_LIST_ROWS))).not.toContain("Taulukon rajaus");
    expect(render(long.slice(0, LONG_LIST_ROWS))).not.toContain("Lataa CSV");
    expect(render(long.slice(0, 1), { csv: true })).toContain("Lataa CSV");
    expect(render(long.slice(0, 1), { toolbar: true })).not.toContain("Hae: Rivit");
    expect(render(long, { toolbar: false })).not.toContain("Taulukon rajaus");
    expect(render(long, { toolbar: false })).not.toContain("Lataa CSV");
  });

  it("reads a cell with no value of its own: the words of the cell, the printed sum as a number", () => {
    const lines = csvLines(bare, [long[3]!], null);
    expect(lines[1]).toEqual(["Kauppa 3", 3]);
  });

  it("reads a printed figure back as a number", () => {
    expect(figureOf("12 600 €")).toBe(12600);
    expect(figureOf("−44,89 €")).toBe(-44.89);
    expect(figureOf("32 %")).toBe(32);
    expect(figureOf("Helen")).toBeNull();
    expect(figureOf("–")).toBeNull();
  });
});

describe("a cell made of components", () => {
  // Its words come from the component's props, not from its children, as in the list of Tapahtumat.
  const Who = ({ name, note }: { name: string; note: string }) => createElement("span", null, createElement("b", null, name), createElement("span", { "aria-hidden": "true" }, "›"), createElement("i", null, note));
  const Amount = ({ cents }: { cents: number }) => createElement("span", null, `${(cents / 100).toString().replace(".", ",")} €`);
  const Broken = (): never => {
    throw new Error("needs its page");
  };
  type Tx = { name: string; note: string; cents: number };
  const columns: Column<Tx>[] = [
    { key: "who", label: "Saaja", kind: "text", rowHead: true, cell: (t) => createElement(Who, { name: t.name, note: t.note }) },
    { key: "sum", label: "Summa", kind: "money", cell: (t) => createElement(Amount, { cents: t.cents }) },
  ];
  const row: Tx = { name: "Veikkaus", note: "VEIKKAUS OY", cents: -1250 };

  it("reads a component's words, leaves out what is hidden and reads a component that cannot be drawn as empty", () => {
    expect(textFromNode(createElement(Who, { name: "Veikkaus", note: "OY" })).replace(/\s+/g, " ").trim()).toBe("Veikkaus OY");
    expect(textFromNode(createElement(Broken))).toBe("");
  });

  it("is searched and exported by its words and figure, with no column asking", () => {
    const find = searchFns(columns).map((f) => f(row)).join(" ");
    expect(find).toContain("Veikkaus");
    expect(find).toContain("VEIKKAUS OY");
    expect(csvValueOf(columns[0]!, row)).toBe("Veikkaus VEIKKAUS OY");
    expect(csvValueOf(columns[1]!, row)).toBe(-12.5);
  });
});

describe("the order of a table in the address of the page", () => {
  const rows = [{ name: "Beta", cents: 100 }, { name: "Alfa", cents: 300 }, { name: "Gamma", cents: 200 }];
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Nimi", kind: "text", rowHead: true, sort: (r) => r.name, cell: (r) => r.name },
    { key: "cents", label: "Summa", kind: "money", cents: (r) => r.cents, sort: true },
  ];
  const names = (html: string) => [...html.matchAll(/class="rt-rowhead">([^<]*)</g)].map((m) => m[1]);
  const at = (sort: string | undefined) =>
    renderToStaticMarkup(createElement(PageAddressContext.Provider, { value: { search: sort ? { sort } : {}, change: () => {} } }, createElement(Table<(typeof rows)[number]>, { caption: "Rivit", rows, rowKey: (r) => r.name, columns: cols })));

  it("sorts by what the address says, drops a column that does not exist, and keeps the server's order without one", () => {
    expect(names(at("rivit:desc.cents"))).toEqual(["Alfa", "Gamma", "Beta"]);
    expect(names(at("rivit:asc.name"))).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(names(at("rivit:desc.gone"))).toEqual(["Beta", "Alfa", "Gamma"]);
    expect(names(at(undefined))).toEqual(["Beta", "Alfa", "Gamma"]);
  });
});
