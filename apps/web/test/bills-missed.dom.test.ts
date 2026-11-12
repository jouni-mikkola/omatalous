/**
 * Laskut: the opened row of a bill that did not come offers the mark that ends it (the answer Lopetettu of
 * Tarkistettavat) and still the removal of a series that was never a bill.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { marksBySubject } from "@banking/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Recurring } from "../src/types.ts";
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
    render(createElement(BillsTable, { items, fixedCents: 0, controls, label: (id: string) => id, cards: new Set<string>(), today: TODAY, range: { from: "2026-10-01", to: TODAY }, scope: "own", onRemoved: () => {} }));
    const row = screen.getByRole("row", { name: /Sähköyhtiö/ });
    expect(within(row).getByText("Ei tullut 5.9.")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /Tiedot: Sähköyhtiö/ }));
    expect(screen.getByRole("button", { name: /Merkitse lopetetuksi/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Poista lasku/ })).toBeTruthy();
  });
});
