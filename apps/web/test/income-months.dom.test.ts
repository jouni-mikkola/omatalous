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
  types: [{ type: "salary", label: "Palkka", totalCents: 700000, monthlyCents: 300000, payers: [] }],
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

  it("reads a month's total from the report", () => {
    render(createElement(section.Component, { ctx }));
    fireEvent.focus(screen.getByRole("group", { name: /Tulot kuukausittain/ }));
    fireEvent.keyDown(screen.getByRole("group", { name: /Tulot kuukausittain/ }), { key: "Home" });
    expect(plain(document.querySelector(".readout-line")!.textContent)).toContain("Yhteensä 3 200 €");
  });
});
