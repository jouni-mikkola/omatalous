/**
 * Laskut: the opened row of a bill that did not come offers the mark that ends it (the answer Lopetettu of
 * Tarkistettavat) and still the removal of a series that was never a bill; the rows of Päättyneet head their date as
 * the last one.
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

describe("Laskut: Päättyneet", () => {
  it("heads the date of an ended row Viimeksi, which a phone shows as its label, and the live rows Seuraava", () => {
    stubApi({});
    const ended = { ...power, id: "out:acc-1:Vanhayhtiö", merchant: "Vanhayhtiö", contract: { ...contract, ended: true, endedOn: "2026-09-05" } };
    const live = { ...power, active: true, lastDate: "2026-10-05", nextDate: "2026-11-05" };
    const items = billItems({ series: [live, ended], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
    const { container } = render(createElement(BillsTable, { items, fixedCents: 0, controls, label: (id: string) => id, cards: new Set<string>(), today: TODAY, range: { from: "2026-10-01", to: TODAY }, scope: "own", onRemoved: () => {} }));
    const dateCell = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) })).getAllByRole("cell").find((c) => c.classList.contains("next-col"))!;
    expect(dateCell("Vanhayhtiö").getAttribute("data-label")).toBe("Viimeksi");
    expect(dateCell("Vanhayhtiö").textContent).toBe("5.8.");
    expect(dateCell("Sähköyhtiö").getAttribute("data-label")).toBe("Seuraava");
    const heads = [...container.querySelectorAll("details.sub-ended th")].map((th) => th.textContent?.trim());
    expect(heads).toContain("Viimeksi");
    expect(heads).not.toContain("Seuraava");
  });
});
