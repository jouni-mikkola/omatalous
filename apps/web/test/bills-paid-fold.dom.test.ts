/**
 * Laskut: the open month lists what is still to come, and its paid rows, two or more, wait under one toggle that names
 * their count and no sum. So do its rows still to come that a card pays, two or more, under a toggle of their own before
 * the paid one. A toggle starts closed; opened, it shows the rows as they were.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { marksBySubject } from "@banking/core";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import type { CalBill } from "../src/components/bills/calendar-rows.ts";
import { billItems } from "../src/components/bills/items.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";

const TODAY = "2026-10-11";
const PAID = ["Vesiyhtiö", "Vakuutusyhtiö", "Taloyhtiö"];
const unpaid = bill({ date: "2026-10-20", payee: "Sähköyhtiö" });
const paid = (payee: string, day: number): CalBill => bill({ date: `2026-10-0${day}`, payee, state: "paid" });

function show(rows: CalBill[]) {
  const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const cal = calendar([month("2026-10", rows, { knownCents: 6420, billsCents: 6420 }), month("2026-11", [bill()])]);
  return render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
}

afterEach(cleanup);

describe("Laskut: the paid rows of the open month", () => {
  it("are folded under a closed toggle that names their count, below the rows still to pay", () => {
    show([paid(PAID[0]!, 1), paid(PAID[1]!, 3), paid(PAID[2]!, 5), unpaid]);
    const toggle = screen.getByRole("button", { name: "Maksetut laskut, 3 kpl" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).not.toMatch(/€/);
    for (const name of PAID) expect(screen.queryAllByText(name)).toHaveLength(0);
    const due = screen.getByText("Sähköyhtiö");
    expect(due.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryAllByText("Maksettu")).toHaveLength(0);
  });

  it("shows the paid rows when opened, each one named by the toggle's aria-controls", () => {
    show([paid(PAID[0]!, 1), paid(PAID[1]!, 3), paid(PAID[2]!, 5), unpaid]);
    const toggle = screen.getByRole("button", { name: "Maksetut laskut, 3 kpl" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const name of PAID) expect(screen.getAllByText(name)).toHaveLength(1);
    expect(screen.getAllByText("Maksettu")).toHaveLength(3);
    const ids = toggle.getAttribute("aria-controls")!.split(" ");
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(document.getElementById(id)?.tagName).toBe("TR");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    for (const name of PAID) expect(screen.queryAllByText(name)).toHaveLength(0);
  });

  it("folds nothing when the month has one paid row", () => {
    show([paid(PAID[0]!, 1), unpaid]);
    expect(screen.queryByRole("button", { name: /^Maksetut laskut/ })).toBeNull();
    expect(screen.getAllByText(PAID[0]!)).toHaveLength(1);
    expect(screen.getAllByText("Maksettu")).toHaveLength(1);
  });
});

describe("Laskut: the rows of the open month that a card pays", () => {
  const CARD = ["Suoratoisto", "Kuntosali", "Lehtitilaus"];
  const onCard = (payee: string, day: number, over: Partial<CalBill> = {}): CalBill => bill({ date: `2026-10-${String(day).padStart(2, "0")}`, payee, onCard: true, ...over });

  it("are folded under a closed toggle that names their count, below the rows still to pay and above the paid toggle", () => {
    show([paid(PAID[0]!, 1), paid(PAID[1]!, 3), onCard(CARD[0]!, 14), unpaid, onCard(CARD[1]!, 22), onCard(CARD[2]!, 25)]);
    const toggle = screen.getByRole("button", { name: "Kortilla, 3 kpl" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).not.toMatch(/€/);
    for (const name of CARD) expect(screen.queryAllByText(name)).toHaveLength(0);
    const due = screen.getByText("Sähköyhtiö");
    expect(due.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const paidToggle = screen.getByRole("button", { name: "Maksetut laskut, 2 kpl" });
    expect(toggle.compareDocumentPosition(paidToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the card's rows when opened, each one named by the toggle's aria-controls, and leaves the paid ones folded", () => {
    show([paid(PAID[0]!, 1), paid(PAID[1]!, 3), onCard(CARD[0]!, 14), unpaid, onCard(CARD[1]!, 22)]);
    const toggle = screen.getByRole("button", { name: "Kortilla, 2 kpl" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const name of CARD.slice(0, 2)) expect(screen.getAllByText(name)).toHaveLength(1);
    expect(screen.getAllByText("Kortilla")).toHaveLength(2);
    const ids = toggle.getAttribute("aria-controls")!.split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(document.getElementById(id)?.tagName).toBe("TR");
    for (const name of PAID.slice(0, 2)) expect(screen.queryAllByText(name)).toHaveLength(0);
  });

  it("folds nothing for one card row, and a paid card row goes with the paid rows", () => {
    show([onCard(CARD[0]!, 14), unpaid, onCard(CARD[1]!, 2, { state: "paid" }), paid(PAID[0]!, 1)]);
    expect(screen.queryByRole("button", { name: /^Kortilla/ })).toBeNull();
    expect(screen.getAllByText(CARD[0]!)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Maksetut laskut, 2 kpl" })).toBeTruthy();
    expect(screen.queryAllByText(CARD[1]!)).toHaveLength(0);
  });
});
