/**
 * Laskut: the picked month by day (BillDays) and the month the chart picks opening in the table (BillsTable `focus`).
 * The day's sums are core's `billDays`; the bar heights are shares of the dearest day.
 */
import { marksBySubject } from "@banking/core";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BillDays } from "../src/components/bills/BillDays.tsx";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";

afterEach(cleanup);

const december = month(
  "2026-12",
  [bill({ date: "2026-12-01", payee: "Vuokra", cents: 80000 }), bill({ date: "2026-12-10", payee: "Vakuutusyhtiö", cents: 20000 }), bill({ date: "2026-12-15", payee: "Esimerkki Oy", cents: 300000, kind: "income" })],
  { billsCents: 100000, billDays: [{ date: "2026-12-01", cents: 80000 }, { date: "2026-12-10", cents: 20000 }] },
);

describe("Laskut: the days of the picked month", () => {
  it("draws a bar for every day of the month, as high as the day's share of the dearest day", () => {
    const { container } = render(createElement(BillDays, { month: december }));
    expect(screen.getByRole("img", { name: "Laskut päivittäin, joulukuu 2026" })).toBeTruthy();
    const bars = [...container.querySelectorAll<HTMLElement>(".bill-day > i")];
    expect(bars).toHaveLength(31);
    expect(bars[0]!.style.blockSize).toBe("100%");
    expect(bars[9]!.style.blockSize).toBe("25%");
    expect(bars[1]!.style.blockSize).toBe("0%");
  });

  it("marks the day of a pay and numbers the first day and every fifth", () => {
    const { container } = render(createElement(BillDays, { month: december }));
    const pay = container.querySelectorAll(".bill-day-pay");
    expect(pay).toHaveLength(1);
    expect(pay[0]!.textContent).toBe("palkka15");
    const numbers = [...container.querySelectorAll(".bill-day > span")].map((s) => s.textContent).filter(Boolean);
    expect(numbers).toEqual(["1", "5", "10", "15", "20", "25", "30"]);
  });

  it("draws no height in a month with no bill left", () => {
    const { container } = render(createElement(BillDays, { month: month("2026-12", []) }));
    expect([...container.querySelectorAll<HTMLElement>(".bill-day > i")].every((bar) => bar.style.blockSize === "0%")).toBe(true);
  });
});

describe("Laskut: the month picked on the chart", () => {
  const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const cal = calendar([month("2026-10", []), month("2026-11", []), month("2026-12", [bill({ date: "2026-12-10", payee: "Vakuutusyhtiö" })], { billsCents: 6420 })]);
  const show = (focus: string | null) => render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", focus, onRemoved: () => {} }));

  it("keeps a later month closed while nothing is picked", () => {
    show(null);
    expect(screen.queryAllByText("Vakuutusyhtiö")).toHaveLength(0);
  });

  it("opens the picked month", () => {
    show("2026-12");
    expect(screen.getAllByText("Vakuutusyhtiö")).toHaveLength(1);
  });
});
