/** Raportit > Tulot: the section opens with the chart of the months, its columns and totals the report's own. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { section } from "../src/pages/reports/sections/Income.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

const plain = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ");
const months = [
  { month: "2026-08", complete: true, totalCents: 320000 },
  { month: "2026-09", complete: true, totalCents: 300000 },
  { month: "2026-10", complete: false, totalCents: 100000 },
];
const income = {
  totalCents: 720000,
  monthlyCents: 310000,
  completeMonths: 2,
  months,
  kinds: [
    { id: "earned", label: "Ansiotulot", months: [300000, 300000, 100000] },
    { id: "other", label: "Muut tulot", months: [20000, 0, 0] },
  ],
  types: [
    { type: "salary", label: "Palkka", totalCents: 700000, shareOfAll: 700000 / 720000, monthlyCents: 300000, payers: [] },
    { type: "tax_refund", label: "Veronpalautus", totalCents: 20000, shareOfAll: 20000 / 720000, monthlyCents: 0, payers: [] },
  ],
};
const ctx = { data: { income }, meta: { today: "2026-10-09", accounts: [], sharedAccounts: [] }, running: "2026-10", label: (id: string) => id } as unknown as ReportContext;

describe("Raportit: Tulot", () => {
  it("draws the chart of the months, stacked by kind, with the usual level", () => {
    const { container } = render(createElement(section.Component, { ctx }));
    expect(screen.getByRole("img", { name: "Tulot kuukausittain" })).toBeTruthy();
    expect(container.querySelectorAll("g.ms-month")).toHaveLength(3);
    expect(container.querySelectorAll("rect.ms-s0")).toHaveLength(3);
    expect(container.querySelectorAll("rect.ms-s1")).toHaveLength(1);
    expect(container.querySelectorAll("line.ms-usual")).toHaveLength(1);
  });

  it("prints each kind's share of all the money in as the report gives it, and 100 % in the total", () => {
    const { container } = render(createElement(section.Component, { ctx }));
    const rows = [...container.querySelectorAll(".in-types tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => plain(td.textContent).trim()));
    expect(rows.map((cells) => cells.filter((c) => /%$/.test(c)))).toEqual([["97 %"], ["3 %"]]);
    // the bar of each row is on the same share, in the column that takes its width from the stylesheet
    expect([...container.querySelectorAll(".in-types td.in-share-bar .rt-bar-track > span")].map((bar) => (bar as HTMLElement).style.width)).toEqual(["97.2%", "2.8%"]);
    expect(plain(container.querySelector(".in-types tfoot")!.textContent)).toContain("100 %");
  });

  it("reads a month's total from the report", () => {
    render(createElement(section.Component, { ctx }));
    fireEvent.focus(screen.getByRole("group", { name: /Tulot kuukausittain/ }));
    fireEvent.keyDown(screen.getByRole("group", { name: /Tulot kuukausittain/ }), { key: "Home" });
    expect(plain(document.querySelector(".readout-line")!.textContent)).toContain("Yhteensä 3 200 €");
  });
});
