/**
 * Laskut: the bills before payday against the money. The hero says how many bills fall due, their sum and how many the
 * money does not pay whole; the split bill says how much of it is covered; without a balance the page asks for one.
 */
import type { BillsBeforePayday } from "@banking/core";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BillsBar } from "../src/components/bills/BillsBar.tsx";

afterEach(cleanup);

const bill = (date: string, name: string, euros: number, coveredEuros: number): BillsBeforePayday["bills"][number] => ({
  date,
  name,
  cents: euros * 100,
  coveredCents: coveredEuros * 100,
  missingCents: (euros - coveredEuros) * 100,
  state: coveredEuros === euros ? "covered" : coveredEuros > 0 ? "split" : "short",
});
const before: BillsBeforePayday = {
  payday: "2026-12-10",
  moneyCents: 54_000,
  bills: [bill("2026-12-01", "Vakuutus", 120, 120), bill("2026-12-02", "Vesi", 180, 180), bill("2026-12-03", "Korttilasku", 420, 240), bill("2026-12-05", "Asuntolaina", 390, 0), bill("2026-12-06", "Sähkö", 130, 0)],
  billsCents: 124_000,
  coveredCents: 54_000,
  missingCents: 70_000,
  leftOverCount: 3,
};
/** The app writes sums with no-break spaces. */
const plain = (text: string | null) => (text ?? "").replace(/[  ]/g, " ");
const show = (b: BillsBeforePayday) => render(createElement(BillsBar, { before: b, today: "2026-11-28" }));

describe("Laskut: the bills before payday", () => {
  it("says the count, the sum and how many are left over", () => {
    const { container } = show(before);
    expect(screen.getByText("Ennen palkkaa 10.12. erääntyy 5 laskua")).toBeTruthy();
    expect(plain(container.querySelector(".bills-bar-sum")!.textContent)).toBe("1 240 €");
    expect(container.querySelector(".bills-bar-over")!.textContent).toBe(" · 3 laskua jää maksamatta");
  });

  it("shows each bill as wide as its sum and the split bill half covered", () => {
    const { container } = show(before);
    const items = [...container.querySelectorAll<HTMLElement>("li.bills-bar-bill")];
    expect(items.map((li) => li.style.flexGrow)).toEqual(["12000", "18000", "42000", "39000", "13000"]);
    const split = items[2]!;
    expect(split.classList.contains("bills-bar-split")).toBe(true);
    expect(split.style.getPropertyValue("--have")).toBe(`${(100 * 240) / 420}%`);
    expect(plain(split.textContent)).toContain("Katettu 240 €, puuttuu 180 €");
    expect(items[3]!.textContent).toContain("Ei katettu");
    // the cut stands where the money ends: 540 of 1 240
    expect(container.querySelector<HTMLElement>(".bills-bar-cut")!.style.left).toBe(`${(100 * 54_000) / 124_000}%`);
  });

  it("says the money is enough and draws no cut when every bill is covered", () => {
    const covered = { ...before, moneyCents: 200_000, bills: before.bills.map((b) => ({ ...b, coveredCents: b.cents, missingCents: 0, state: "covered" as const })), coveredCents: 124_000, missingCents: 0, leftOverCount: 0 };
    const { container } = show(covered);
    expect(container.querySelector(".bills-bar-fine")!.textContent).toBe(" · rahat riittävät");
    expect(container.querySelector(".bills-bar-cut")).toBeNull();
  });

  it("asks for a balance when there is none and leaves the covering out", () => {
    const { container } = show({ ...before, moneyCents: null, coveredCents: null, missingCents: null, leftOverCount: null, bills: before.bills.map((b) => ({ ...b, coveredCents: 0, missingCents: b.cents, state: null })) });
    expect(screen.getByText("Lisää saldo, niin näet, mitkä laskut rahat kattavat").getAttribute("href")).toBe("#/settings/banks");
    expect(container.querySelector(".bills-bar-over")).toBeNull();
    expect(container.querySelector(".bills-bar-short")).toBeNull();
  });

  it("is not drawn without bills", () => {
    const { container } = show({ ...before, bills: [], billsCents: 0, coveredCents: 0, missingCents: 0, leftOverCount: 0 });
    expect(container.innerHTML).toBe("");
  });
});
