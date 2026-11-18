/**
 * Yhteenveto's Tulevat kuukaudet: this month and the two after it, read from the answer Laskut reads. Each sum is the
 * month's own field of the bill calendar, so the block and the month heads of Laskut tell the same figures.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { marksBySubject } from "@banking/core";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { Coming, ComingMonths } from "../src/components/home/Coming.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { ReportsData } from "../src/types.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";
import { failing, stubApi } from "./dom-kit.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const cells = (tr: Element) => [...tr.children].map((c) => flat(c.textContent)).filter(Boolean);

const rows = (key: string) => [bill({ date: `${key}-12`, payee: "Vuokranantaja", cents: 80000, state: "known" })];

/** Four months, so the block's cut at three shows; the second has no pay and the third a bill with no sum. */
const answer = () =>
  calendar(
    [
      month("2026-11", rows("2026-11"), { knownCents: 120000, estimateCents: 30000, billsCents: 150000, incomeCents: 300000, afterCents: 140000 }),
      month("2026-12", rows("2026-12"), { knownCents: 80000, billsCents: 80000, incomeCents: 0, afterCents: -80000 }),
      month("2027-01", rows("2027-01"), { knownCents: 90000, billsCents: 90000, incomeCents: 310000, afterCents: null }),
      month("2027-02", rows("2027-02"), { knownCents: 70000, billsCents: 70000, incomeCents: 310000, afterCents: 240000 }),
    ],
    { unknownCount: 2 },
  );

function laskutHeads(cal: ReturnType<typeof answer>): string[] {
  stubApi({ "GET /api/transactions": { items: [], total: 0 } });
  const items = billItems({ series: [], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: "2026-11-11" });
  const controls = { markOf: () => null, busy: false, set: () => {}, clear: () => {} };
  const { container, unmount } = render(createElement(BillsTable, { calendar: cal, items, controls, label: (id: string) => id, scope: "own", onRemoved: () => {} }));
  const heads = [...container.querySelectorAll(".bill-sums")].map((e) => flat(e.textContent));
  unmount();
  return heads;
}

describe("Tulevat kuukaudet", () => {
  it("shows this month and the two after it, no more", () => {
    const { container } = render(createElement(ComingMonths, { calendar: answer() }));
    expect([...container.querySelectorAll("tbody tr")].map((tr) => cells(tr)[0])).toEqual(["Marraskuu 2026", "Joulukuu 2026", "Tammikuu 2027"]);
  });

  it("tells the sums the month heads of Laskut tell, from the same answer", () => {
    const cal = answer();
    const heads = laskutHeads(cal);
    const { container } = render(createElement(ComingMonths, { calendar: cal }));
    const trs = [...container.querySelectorAll("tbody tr")];
    expect(trs).toHaveLength(3);
    trs.forEach((tr, i) => {
      const [, bills, income, after] = cells(tr);
      const head = heads[i]!;
      // the bills with their estimated part, as the head says them
      expect(head).toContain(`Laskut ${bills}`);
      if (income !== "–") expect(head).toContain(`Tulot ${income}`);
      if (after === "Ei tiedossa") expect(head).toContain("Laskujen jälkeen: ei tiedossa");
      else if (after !== "–") expect(head).toContain(`Laskujen jälkeen ${after}`);
      else expect(head).not.toContain("Laskujen jälkeen");
    });
    expect(cells(trs[0]!)).toEqual(["Marraskuu 2026", "1 500,00 € (arviota 300,00 €)", "3 000,00 €", "1 400,00 €"]);
  });

  it("never turns a sum that is not known into 0, and says how many bills lack one", () => {
    const { container } = render(createElement(ComingMonths, { calendar: answer() }));
    const january = cells([...container.querySelectorAll("tbody tr")][2]!);
    expect(january).toEqual(["Tammikuu 2027", "900,00 €", "3 100,00 €", "Ei tiedossa"]);
    expect(january.join(" ")).not.toContain("0,00 € 0");
    expect(flat(container.textContent)).toContain("2 laskun summa tai päivä ei ole tiedossa");
  });

  it("leaves the pays and what is left out of a month that has no pay, as Laskut does", () => {
    const { container } = render(createElement(ComingMonths, { calendar: answer() }));
    expect(cells([...container.querySelectorAll("tbody tr")][1]!)).toEqual(["Joulukuu 2026", "800,00 €", "–", "–"]);
  });

  it("says nothing of unknown bills when core counts none", () => {
    const { container } = render(createElement(ComingMonths, { calendar: { ...answer(), unknownCount: 0 } }));
    expect(flat(container.textContent)).not.toContain("ei ole tiedossa");
  });
});

describe("Tulevat kuukaudet, the block", () => {
  it("asks for the bill calendar of the scope, shows it under its heading and links to Laskut", async () => {
    const seen = stubApi({ "GET /api/reports": { billCalendar: answer() } });
    render(createElement(Coming, { scope: "household" }));
    const region = screen.getByRole("region", { name: "Tulevat kuukaudet" });
    await waitFor(() => expect(within(region).getAllByRole("row").length).toBeGreaterThan(1));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("/api/reports");
    const link = within(region).getByRole("link", { name: "Kaikki laskut" });
    expect(link.getAttribute("href")).toBe("#/bills#laskut-taulukko");
  });

  it("shows the error of a failed answer and no figure", async () => {
    stubApi({ "GET /api/reports": failing(500, { error: "Palvelin ei vastaa" }) });
    render(createElement(Coming, { scope: "own" }));
    const region = screen.getByRole("region", { name: "Tulevat kuukaudet" });
    await waitFor(() => expect(within(region).getByRole("alert")).toBeTruthy());
    expect(within(region).queryByRole("table")).toBeNull();
  });
});

// keeps the type of the answer in step with the web's own
export type _CalendarAnswer = ReportsData["billCalendar"];
