/**
 * Laskut: the opened row of a bill that did not come offers the mark that ends it (the answer Lopetettu of
 * Tarkistettavat) and still the removal of a series that was never a bill; what has ended waits in a folded group whose
 * rows show their last day.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { marksBySubject } from "@banking/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Recurring } from "../src/types.ts";
import { bill, calendar, lateBill, month } from "./bill-calendar-fixture.ts";
import { stubApi } from "./dom-kit.ts";

const TODAY = "2026-10-11";
const contract = { startDate: "2025-09-05", firstPaymentCents: null, lastDate: "2026-08-05", ended: false, endedOn: null, monthlyCents: 6420, totalPaidCents: 77040, refund: null, costAfterRefundCents: 77040 };
// due 5.9. and not paid: 36 days late, no longer active, not ended yet
const power: Recurring = {
  id: "out:acc-1:Sähköyhtiö",
  merchant: "Sähköyhtiö",
  category: "utilities",
  kind: "bill",
  cadence: "monthly",
  intervalDays: 30,
  occurrences: 12,
  firstDate: "2025-09-05",
  lastDate: "2026-08-05",
  nextDate: "2026-09-05",
  typicalAmountCents: 6420,
  lastAmountCents: 6420,
  monthlyCents: 6420,
  yearlyCents: 77040,
  perMonth: 1,
  monthsActive: 12,
  active: false,
  overdue: false,
  review: false,
  confidence: 1,
  priceChange: null,
  contract,
};

describe("Laskut: a bill that did not come, opened", () => {
  it("offers Merkitse lopetetuksi and Poista lasku", () => {
    stubApi({ "GET /api/transactions": { items: [], total: 0 } });
    const items = billItems({ series: [power], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const cal = calendar([month("2026-10", [bill({ date: "2026-10-15", payee: "Sähköyhtiö", state: "estimate", seriesId: power.id })])]);
    render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    const row = screen.getByRole("row", { name: /Sähköyhtiö/ });
    fireEvent.click(within(row).getByRole("button", { name: /Tiedot: Sähköyhtiö/ }));
    expect(screen.getByRole("button", { name: /Merkitse lopetetuksi/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Poista lasku/ })).toBeTruthy();
  });
});

describe("Laskut: a bill that did not come, in the calendar core makes", () => {
  it("is a row marked Ei tullut that offers both actions, though the calendar has no row of it", () => {
    stubApi({ "GET /api/transactions": { items: [], total: 0 } });
    const { today, series, power: late, calendar: cal } = lateBill();
    expect(late.overdue).toBe(true);
    expect(cal.months.flatMap((m) => m.rows).filter((r) => r.seriesId === late.id)).toEqual([]);
    const items = billItems({ series, typed: [], cancelled: new Set(), marks: marksBySubject([]), today });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    const row = screen.getByRole("row", { name: /Esimerkki Energia/ });
    expect(within(row).getByText("Ei tullut")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /Tiedot: Esimerkki Energia/ }));
    expect(screen.getByRole("button", { name: /Merkitse lopetetuksi/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Poista lasku/ })).toBeTruthy();
  });
});

describe("Laskut: a later month opened", () => {
  it("lists the bills that come less often than monthly one by one and folds the monthly ones into one row with core's count and sum", () => {
    stubApi({});
    const monthly = (day: string, payee: string, cents: number) => bill({ date: day, payee, cents, monthly: true });
    const cal = calendar([
      month("2026-10", []),
      month("2026-11", []),
      month("2026-12", [monthly("2026-12-12", "Vesiyhtiö", 2000), monthly("2026-12-15", "Kaasuyhtiö", 3000), bill({ date: "2026-12-20", payee: "Vakuutus", cents: 40000 })], { monthlyBillsCount: 2, monthlyBillsCents: 5000 }),
    ]);
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const view = render(createElement(BillsTable, { calendar: cal, items: [], controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    expect(screen.queryByText("Vakuutus")).toBeNull();
    view.rerender(createElement(BillsTable, { calendar: cal, items: [], controls, label: (id: string) => id, scope: "own", month: "2026-12", onRemoved: () => {} }));
    expect(screen.getByText("Vakuutus")).toBeTruthy();
    const fold = screen.getByRole("row", { name: /Kuukausittaiset laskut, 2 laskua/ });
    expect((fold.textContent ?? "").replace(/[  ]/g, " ")).toContain("50,00 €");
    expect(screen.queryByText("Kaasuyhtiö")).toBeNull();
    fireEvent.click(within(fold).getByRole("button", { name: /Tiedot/ }));
    expect(screen.getByText("Kaasuyhtiö")).toBeTruthy();
  });
});

describe("Laskut: Päättyneet", () => {
  it("folds what has ended and shows the last day of each row once opened", () => {
    stubApi({});
    const ended = { ...power, id: "out:acc-1:Vanhayhtiö", merchant: "Vanhayhtiö", contract: { ...contract, ended: true, endedOn: "2026-09-05" } };
    const live = { ...power, active: true, lastDate: "2026-10-05", nextDate: "2026-11-05" };
    const items = billItems({ series: [live, ended], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const cal = calendar([month("2026-10", [bill({ date: "2026-11-05", payee: "Sähköyhtiö", seriesId: live.id })])]);
    render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
    expect(screen.queryByRole("row", { name: /Vanhayhtiö/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Päättyneet 1/ }));
    const row = screen.getByRole("row", { name: /Vanhayhtiö/ });
    expect(within(row).getByText(/^5\.8\./)).toBeTruthy();
    expect(within(row).getByText("Päättynyt")).toBeTruthy();
  });
});
