/**
 * Laskut: the payment of a saved loan is the loan's, which Varat ja velat keeps, so its opened row offers no Poista
 * lasku. Core marks it: a row of kind "loan", or a credit line's series a saved loan names (`loanSeries`).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { marksBySubject } from "@banking/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Recurring } from "../src/types.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";
import { stubApi } from "./dom-kit.ts";

const TODAY = "2026-10-11";
const credit: Recurring = {
  id: "out:acc-1:Esimerkki Rahoitus",
  merchant: "Esimerkki Rahoitus",
  category: "loans",
  kind: "bill",
  cadence: "monthly",
  intervalDays: 30,
  occurrences: 12,
  firstDate: "2025-10-03",
  lastDate: "2026-10-03",
  nextDate: "2026-11-03",
  typicalAmountCents: 15000,
  lastAmountCents: 15000,
  monthlyCents: 15000,
  yearlyCents: 180000,
  perMonth: 1,
  monthsActive: 12,
  active: true,
  overdue: false,
  review: false,
  confidence: 1,
  priceChange: null,
};

function open(over: Parameters<typeof bill>[0]) {
  stubApi({ "GET /api/transactions": { items: [], total: 0 } });
  const items = billItems({ series: [credit], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const cal = calendar([month("2026-11", [bill({ date: "2026-11-03", payee: credit.merchant, category: "loans", cents: 15000, seriesId: credit.id, ...over })])]);
  render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
  const row = screen.getByRole("row", { name: /Esimerkki Rahoitus/ });
  fireEvent.click(within(row).getByRole("button", { name: /Tiedot: Esimerkki Rahoitus/ }));
}

describe("Laskut: a saved loan's payment, opened", () => {
  it("offers Poista lasku on a debt's series no saved loan names", () => {
    open({});
    expect(screen.getByRole("button", { name: /Poista lasku/ })).toBeTruthy();
  });

  it("offers no Poista lasku on a credit line's series a saved loan names", () => {
    open({ loanSeries: true });
    expect(screen.queryByRole("button", { name: /Poista lasku/ })).toBeNull();
  });

  it("offers no Poista lasku on the row of a loan's plan", () => {
    open({ kind: "loan" });
    expect(screen.queryByRole("button", { name: /Poista lasku/ })).toBeNull();
  });
});
