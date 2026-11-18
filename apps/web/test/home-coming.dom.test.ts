/**
 * Yhteenveto's Tulevat kuukaudet: this month and the two after it, read from the answer Laskut reads. Each sum is the
 * month's own field of the bill calendar, so the block and the month heads of Laskut tell the same figures.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { marksBySubject } from "@banking/core";
import { BillsTable } from "../src/components/bills/BillsTable.tsx";
import { Coming, ComingMonths } from "../src/components/home/Coming.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { ReportsData } from "../src/types.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";
import { queryClient } from "../src/query-client.ts";
import { failing, stubApi } from "./dom-kit.ts";

// the answers are cached by path: a test starts with none, so it reads its own
beforeEach(() => queryClient.clear());

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const cells = (tr: Element) => [...tr.children].map((c) => flat(c.textContent)).filter(Boolean);

const rows = (key: string) => [bill({ date: `${key}-12`, payee: "Vuokranantaja", cents: 80000, state: "known" })];

/** Four months, so the block's cut at three shows; the second has no pay. Every bill has its sum, so every month has its sum after the bills. */
const answer = () =>
  calendar([
    month("2026-11", rows("2026-11"), { knownCents: 120000, estimateCents: 30000, billsCents: 150000, incomeCents: 300000, afterCents: 140000 }),
    month("2026-12", rows("2026-12"), { knownCents: 80000, billsCents: 80000, incomeCents: 0, afterCents: -80000 }),
    month("2027-01", rows("2027-01"), { knownCents: 90000, billsCents: 90000, incomeCents: 310000, afterCents: 220000 }),
    month("2027-02", rows("2027-02"), { knownCents: 70000, billsCents: 70000, incomeCents: 310000, afterCents: 240000 }),
  ]);

/** The same months with two bills that have no sum and no day: core then leaves the sum after the bills of every month unknown (`billCalendar` sets `afterCents` null in every month a bill with no day may fall in). */
const unknownAnswer = () => ({
  ...answer(),
  months: answer().months.map((m) => ({ ...m, afterCents: null })),
  unknownCount: 2,
  unknowns: [1, 2].map(() => ({ days: [], open: false, kind: "bill" as const, onCard: false })),
});

/** The same months with one bill that has no sum, due in the fourth: only that month has no sum after the bills, as core gives it. */
const farUnknownAnswer = () => ({
  ...answer(),
  months: answer().months.map((m) => (m.month === "2027-02" ? { ...m, afterCents: null } : m)),
  unknownCount: 1,
  unknowns: [{ days: ["2027-02-05"], open: false, kind: "bill" as const, onCard: false }],
});

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

  it.each([
    ["every sum known", answer],
    ["bills with no sum", unknownAnswer],
  ])("tells the sums the month heads of Laskut tell, from the same answer: %s", (_name, make) => {
    const cal = make();
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
      else expect(head).toContain(`Laskujen jälkeen ${after}`);
    });
    if (make === answer) expect(cells(trs[0]!)).toEqual(["Marraskuu 2026", "1 500,00 € (arviota 300,00 €)", "3 000,00 €", "1 400,00 €"]);
  });

  it("never turns a sum that is not known into 0, and says how many bills lack one", () => {
    const { container } = render(createElement(ComingMonths, { calendar: unknownAnswer() }));
    const trs = [...container.querySelectorAll("tbody tr")];
    expect(cells(trs[2]!)).toEqual(["Tammikuu 2027", "900,00 €", "3 100,00 €", "Ei tiedossa"]);
    // no month has a sum after the bills while a bill's sum is unknown
    expect(trs.map((tr) => cells(tr)[3])).toEqual(["Ei tiedossa", "Ei tiedossa", "Ei tiedossa"]);
    expect(cells(trs[2]!).join(" ")).not.toContain("0,00 € 0");
    expect(flat(container.textContent)).toContain("2 laskun summa tai päivä ei ole tiedossa");
  });

  it("shows the sum after the bills of the months shown while a bill of a later month has no sum", () => {
    const { container } = render(createElement(ComingMonths, { calendar: farUnknownAnswer() }));
    const trs = [...container.querySelectorAll("tbody tr")];
    expect(trs).toHaveLength(3);
    expect(cells(trs[0]!)[3]).toBe("1 400,00 €");
    expect(cells(trs[1]!)[3]).toMatch(/^[−-]800,00 €$/);
    expect(cells(trs[2]!)[3]).toBe("2 200,00 €");
  });

  it("leaves the pays out of a month that has none and tells what is left below 0, as Laskut does", () => {
    const { container } = render(createElement(ComingMonths, { calendar: answer() }));
    const [month, bills, income, after] = cells([...container.querySelectorAll("tbody tr")][1]!);
    expect([month, bills, income]).toEqual(["Joulukuu 2026", "800,00 €", "–"]);
    expect(after).toMatch(/^[−-]800,00 €$/);
  });

  type Unknown = ReportsData["billCalendar"]["unknowns"][number];
  const noteOf = (unknowns: Unknown[]) => {
    const { container } = render(createElement(ComingMonths, { calendar: { ...answer(), unknownCount: unknowns.length, unknowns } }));
    return flat(container.querySelector(".home-detail")?.textContent) || null;
  };
  const unknown = (over: Partial<Unknown>): Unknown => ({ days: [], open: false, kind: "bill", onCard: false, ...over });

  it("counts no unknown bill of a month after the three shown", () => {
    expect(noteOf([unknown({ days: ["2027-09-05"] })])).toBeNull();
  });

  it("counts an unknown bill of the second month", () => {
    expect(noteOf([unknown({ days: ["2026-12-05"] })])).toBe("1 laskun summa tai päivä ei ole tiedossa");
  });

  it("counts a bill that goes on over the shown months once", () => {
    expect(noteOf([unknown({ days: ["2026-11-20"], open: true, kind: "loan" })])).toBe("1 laskun summa tai päivä ei ole tiedossa");
  });

  it("does not call an unknown pay or saving a bill", () => {
    expect(noteOf([unknown({ kind: "income", open: true }), unknown({ kind: "saving", days: ["2026-11-20"] })])).toBeNull();
    expect(noteOf([unknown({ kind: "income" }), unknown({ days: ["2026-12-05"] })])).toBe("1 laskun summa tai päivä ei ole tiedossa");
  });

  it("leaves out a bill that a card pays", () => {
    expect(noteOf([unknown({ days: ["2026-11-20"], onCard: true })])).toBeNull();
  });

  it("says nothing of unknown bills when core counts none", () => {
    const { container } = render(createElement(ComingMonths, { calendar: { ...answer(), unknownCount: 0 } }));
    expect(flat(container.textContent)).not.toContain("ei ole tiedossa");
  });
});

describe("Laskut: the unknown bills a month head counts", () => {
  it("counts only the unknown bills of that month: a month with its sum shows none, a month without shows its count", () => {
    const heads = laskutHeads(farUnknownAnswer());
    expect(heads).toHaveLength(4);
    for (const head of heads.slice(0, 3)) {
      expect(head).not.toContain("laskun summa tai päivä ei ole tiedossa");
      expect(head).toContain("Laskujen jälkeen");
      expect(head).not.toContain("Laskujen jälkeen: ei tiedossa");
    }
    expect(heads[3]).toContain("1 laskun summa tai päivä ei ole tiedossa");
    expect(heads[3]).toContain("Laskujen jälkeen: ei tiedossa");
  });

  it("counts no unknown pay as a bill in a month head", () => {
    const cal = { ...answer(), unknownCount: 1, unknowns: [{ days: [], open: true, kind: "income" as const, onCard: false }] };
    for (const head of laskutHeads(cal)) expect(head).not.toContain("laskun summa tai päivä ei ole tiedossa");
  });

  it("counts a bill with no day in every month", () => {
    for (const head of laskutHeads(unknownAnswer())) expect(head).toContain("2 laskun summa tai päivä ei ole tiedossa");
  });
});

describe("Tulevat kuukaudet, the block", () => {
  it("asks for the bill calendar of the scope, shows it under its heading and has no link: the figure of Nyt is the one way to Laskut", async () => {
    const seen = stubApi({ "GET /api/reports": { billCalendar: answer() } });
    render(createElement(Coming, { scope: "household" }));
    const region = screen.getByRole("region", { name: "Tulevat kuukaudet" });
    await waitFor(() => expect(within(region).getAllByRole("row").length).toBeGreaterThan(1));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("/api/reports");
    expect(within(region).queryAllByRole("link")).toEqual([]);
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
