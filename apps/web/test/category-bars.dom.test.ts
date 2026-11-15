/** Raportit > Rahankäyttö: the category bars. Largest first, each row carries its comparison, a row keeps its table row alone. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { CategoryBars } from "../src/charts/forms/CategoryBars.tsx";
import { ChartWithTable } from "../src/components/table/selection.tsx";
import { Table } from "../src/components/table/Table.tsx";
import "./fixed-clock.ts";

afterEach(cleanup);

const BARS = [
  { key: "fuel", label: "Polttoaine", cents: 20000, diffCents: -1500 },
  { key: "groceries", label: "Ruokakauppa", cents: 60000, diffCents: 4000 },
  { key: "gym", label: "Kuntosali", cents: 20000, diffCents: 0 },
];
const plain = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ");
const props = { bars: BARS, diffLabel: "Ero keskiarvoon, lokakuu 2026", label: "Kategoriat" };

describe("Raportit: the category bars", () => {
  it("orders the rows by sum, the largest first, ties by name", () => {
    render(createElement(CategoryBars, props));
    const names = within(screen.getByRole("list", { name: "Kategoriat" })).getAllByRole("button").map((b) => b.querySelector(".cb-name")!.textContent);
    expect(names).toEqual(["Ruokakauppa", "Kuntosali", "Polttoaine"]);
  });

  it("draws each bar against the largest and puts the comparison on the same row", () => {
    const { container } = render(createElement(CategoryBars, props));
    const rows = [...container.querySelectorAll(".cb-row")];
    expect(plain(rows[0]!.querySelector(".cb-diff")!.textContent)).toMatch(/^\+40 €$/);
    expect(rows[0]!.querySelector(".cb-diff")!.getAttribute("data-dir")).toBe("up");
    expect(rows[1]!.querySelector(".cb-diff")!.getAttribute("data-dir")).toBe("flat");
    expect(rows[2]!.querySelector(".cb-diff")!.getAttribute("data-dir")).toBe("down");
    expect(container.querySelector(".cb-head")!.textContent).toBe("Ero keskiarvoon, lokakuu 2026");
  });

  it("has no comparison column without a usual month", () => {
    const { container } = render(createElement(CategoryBars, { ...props, bars: BARS.map((b) => ({ ...b, diffCents: null })) }));
    expect(container.querySelector(".cb-head")).toBeNull();
    expect(container.querySelector(".cb-diff")).toBeNull();
  });

  it("a click keeps that category's row in the table under it, and a second click shows every row", () => {
    const rows = BARS.map((b) => ({ key: b.key, name: b.label }));
    render(
      createElement(ChartWithTable, {
        chart: createElement(CategoryBars, props),
        table: createElement(Table<(typeof rows)[number]>, { caption: "Taulu", rows, rowKey: (r) => r.key, columns: [{ key: "name", label: "Nimi", kind: "text", rowHead: true, cell: (r) => r.name }], search: false, toolbar: false, csv: false }),
      }),
    );
    const table = () => screen.getByRole("table", { name: "Taulu" });
    expect(table().querySelectorAll("tbody tr")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^Kuntosali/ }));
    expect(table().querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table().textContent).toContain("Kuntosali");
    expect(screen.getByRole("button", { name: /^Kuntosali/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Kuntosali/ }));
    expect(table().querySelectorAll("tbody tr")).toHaveLength(3);
  });
});
