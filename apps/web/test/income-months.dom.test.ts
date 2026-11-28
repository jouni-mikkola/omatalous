/** Raportit > Tulot: the table of the income types, its shares and totals the report's own. */
import { cleanup, render, screen } from "@testing-library/react";
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
  completeMonths: 2,
  months,
  types: [
    { type: "salary", label: "Palkka", totalCents: 620000, shareOfAll: 620000 / 720000, payers: [] },
    { type: "tax_refund", label: "Veronpalautus", totalCents: 100000, shareOfAll: 100000 / 720000, payers: [] },
  ],
};
const ctx = { data: { income }, meta: { today: "2026-10-09", accounts: [], sharedAccounts: [] }, running: "2026-10", label: (id: string) => id } as unknown as ReportContext;

describe("Raportit: Tulot", () => {
  it("prints each kind's share of all the money in as the report gives it, and 100 % in the total", () => {
    const { container } = render(createElement(section.Component, { ctx }));
    const rows = [...container.querySelectorAll(".in-types tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => plain(td.textContent).trim()));
    expect(rows.map((cells) => cells.filter((c) => /%$/.test(c)))).toEqual([["86 %"], ["14 %"]]);
    // the bar of each row is on the same share, in the column that takes its width from the stylesheet
    expect([...container.querySelectorAll(".in-types td.in-share-bar .rt-bar-track > span")].map((bar) => (bar as HTMLElement).style.width)).toEqual(["86.1%", "13.9%"]);
    expect(plain(container.querySelector(".in-types tfoot")!.textContent)).toContain("100 %");
  });

  // twelve columns of one colour answer nothing: the table of the types says it
  it("draws no chart while no second type reaches a tenth of the income, and prints a share that rounds to nothing as under 1 %", () => {
    const types = [
      { ...income.types[0]!, totalCents: 718000, shareOfAll: 718000 / 720000 },
      { ...income.types[1]!, totalCents: 2000, shareOfAll: 2000 / 720000 },
    ];
    const { container } = render(createElement(section.Component, { ctx: { ...ctx, data: { income: { ...income, types } } } as unknown as ReportContext }));
    expect(screen.queryByRole("img", { name: "Tulot kuukausittain" })).toBeNull();
    expect(container.querySelector("details.chart-fold")).toBeNull();
    expect([...container.querySelectorAll(".in-types tbody td")].map((td) => plain(td.textContent).trim()).filter((c) => /%$/.test(c))).toEqual(["100 %", "alle 1 %"]);
  });
});
