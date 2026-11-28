/**
 * Laskut: the totals that end the open month, one for each figure of core's the rows add up to: Maksettu, the saving charged,
 * Maksamatta and the saving still to come. A total with nothing behind it is not shown.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { marksBySubject } from "@banking/core";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import type { CalMonth } from "../src/components/bills/calendar-rows.ts";
import { billItems } from "../src/components/bills/items.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";

afterEach(cleanup);

function totalsOf(open: CalMonth): string[] {
  const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const { container } = render(createElement(BillsTable, { calendar: calendar([open, month("2026-11", [bill()])]), items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
  return [...container.querySelectorAll("tr.bill-total")].map((tr) => `${tr.querySelector(".bill-total-name")!.firstChild!.textContent} ${tr.querySelector("td.bill-total-sum")!.textContent}`);
}

describe("Laskut: the month picked on the chart", () => {
  const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const cal = calendar([month("2026-10", []), month("2026-11", []), month("2026-12", [bill({ date: "2026-12-10", payee: "Vakuutusyhtiö" })], { billsCents: 6420 })]);
  const show = (month: string | null) => render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", month, onRemoved: () => {} }));

  it("shows no later month while nothing is picked", () => {
    show(null);
    expect(screen.queryAllByText("Vakuutusyhtiö")).toHaveLength(0);
  });

  it("shows the picked month", () => {
    show("2026-12");
    expect(screen.getAllByText("Vakuutusyhtiö")).toHaveLength(1);
  });
});

describe("Laskut: the totals that end the open month", () => {
  it("has a total for the bills paid, the saving charged, the bills to come, the saving to come and the sum left, in that order", () => {
    const rows = [
      bill({ date: "2026-10-01", payee: "Vesiyhtiö", state: "paid" }),
      bill({ date: "2026-10-02", payee: "Rahasto", kind: "saving", cents: 20_000, state: "paid" }),
      bill({ date: "2026-10-20", payee: "Sähköyhtiö" }),
      bill({ date: "2026-10-25", payee: "Rahasto", kind: "saving", cents: 15_000, state: "known" }),
    ];
    const totals = totalsOf(month("2026-10", rows, { knownCents: 6420, billsCents: 6420, paidCents: 6420, paidCount: 1, savingPaidCents: 20_000, savingCents: 15_000 }));
    expect(totals).toEqual([
      expect.stringMatching(/^Maksettu 64,20/),
      expect.stringMatching(/^Säästöön 200,00/),
      expect.stringMatching(/^Maksamatta 64,20/),
      expect.stringMatching(/^Säästöön 150,00/),
      expect.stringMatching(/^Laskujen jälkeen /),
    ]);
  });

  it("colours a total by its figure: the saving charged like Maksettu, the saving to come like Maksamatta", () => {
    const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const open = month("2026-10", [bill({ date: "2026-10-20", payee: "Sähköyhtiö" })], { knownCents: 6420, billsCents: 6420, paidCents: 6420, paidCount: 1, savingPaidCents: 20_000, savingCents: 15_000 });
    const { container } = render(createElement(BillsTable, { calendar: calendar([open, month("2026-11", [bill()])]), items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    const classes = [...container.querySelectorAll("tr.bill-total td.bill-total-sum")].map((td) => `${td.parentElement!.querySelector(".bill-total-name")!.firstChild!.textContent}: ${td.classList.contains("bill-total-estimate") ? "estimate" : "plain"}`);
    expect(classes).toEqual(["Maksettu: plain", "Säästöön: plain", "Maksamatta: estimate", "Säästöön: estimate", "Laskujen jälkeen: estimate"]);
  });

  it("names a total in its row header and gives it no button for details", () => {
    const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const open = month("2026-10", [bill({ date: "2026-10-20", payee: "Sähköyhtiö" })], { knownCents: 6420, billsCents: 6420, savingCents: 15_000 });
    const { container } = render(createElement(BillsTable, { calendar: calendar([open, month("2026-11", [bill()])]), items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    const rows = [...container.querySelectorAll("tr.bill-total")];
    expect(rows).toHaveLength(3);
    for (const tr of rows) {
      expect(tr.querySelector("th[scope=row] .bill-total-name"), "the name stands in the row header").not.toBeNull();
      expect(tr.querySelector(".rt-drill"), "no button for details").toBeNull();
    }
    expect(container.querySelectorAll("tr:not(.bill-total) .rt-drill").length, "the other rows keep theirs").toBeGreaterThan(0);
  });

  it("opens the parts of the bills to come by kind in the panel of the sum, once two kinds have money", () => {
    const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-10-11" });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const open = month("2026-10", [bill({ date: "2026-10-20", payee: "Sähköyhtiö" })], { knownCents: 1000, billsCents: 1000, essentialCents: 600, optionalCents: 400 });
    const { container } = render(createElement(BillsTable, { calendar: calendar([open, month("2026-11", [bill()])]), items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    expect(screen.queryByText("Valinnaiset")).toBeNull();
    fireEvent.click(container.querySelector("tr.bill-total .fig-open")!);
    expect(screen.getByRole("dialog", { name: "Maksamatta" }).textContent).toMatch(/Asuminen ja välttämättömät.*6,00.*Valinnaiset.*4,00/);
  });

  it("leaves out the totals nothing is behind", () => {
    const totals = totalsOf(month("2026-10", [bill({ date: "2026-10-20", payee: "Sähköyhtiö" })], { knownCents: 6420, billsCents: 6420 }));
    expect(totals).toEqual([expect.stringMatching(/^Maksamatta 64,20/), expect.stringMatching(/^Laskujen jälkeen /)]);
  });
});
