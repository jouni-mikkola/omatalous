/**
 * The lowest-balance line of Yhteenveto's Nyt block: core's day and range, and the reason core gives while there is no
 * figure. The web adds up nothing.
 */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { LowPoint } from "../src/components/home/LowPoint.tsx";
import { Now } from "../src/components/home/Now.tsx";
import type { DashboardData } from "../src/types.ts";

type Low = DashboardData["home"]["lowPoint"];

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const known = (over: Partial<Extract<NonNullable<Low>, { known: true }>> = {}): Low => ({ known: true, date: "2026-12-13", cents: 30_000, lowCents: 12_000, highCents: 48_000, days: 60, ...over });
const lineOf = (lowPoint: Low) => flat(render(createElement(LowPoint, { lowPoint })).container.textContent);

describe("LowPoint", () => {
  it("says the day and the range with the euro sign once, after the range", () => {
    expect(lineOf(known())).toBe("Alin saldo 60 pv: 13.12., arviolta 120–480 €");
  });

  it("says a range below zero as core gives it", () => {
    expect(lineOf(known({ lowCents: -25_000, highCents: 5_000 }))).toBe("Alin saldo 60 pv: 13.12., arviolta −250–50 €");
  });

  it.each([
    ["no-payday", "Alin saldo Palkkapäivä ei vielä tiedossa"],
    ["late", "Alin saldo Palkkasi on myöhässä"],
    ["no-balance", "Alin saldo Käyttötilin saldo puuttuu"],
    ["no-card-balance", "Alin saldo Kortin saldo puuttuu"],
    ["history", "Alin saldo Liian lyhyt historia"],
    ["cards", "Alin saldo Kortin ostot puuttuvat"],
  ] as const)("says the reason %s and no figure", (reason, text) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason } }));
    expect(flat(container.textContent)).toBe(text);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("shows nothing when core gives nothing", () => {
    expect(render(createElement(LowPoint, { lowPoint: null })).container.textContent).toBe("");
  });
});

describe("Now", () => {
  it("stands the line under the sum left to the payday, outside its link", () => {
    const data = { nyt: { left: { known: false, reason: "no-payday" } }, home: { lowPoint: known() } } as unknown as DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
    const { container } = render(createElement(Now, { data }));
    const section = container.querySelector("section.home-now")!;
    const line = section.querySelector("p.home-low")!;
    expect(flat(line.textContent)).toBe("Alin saldo 60 pv: 13.12., arviolta 120–480 €");
    expect(line.previousElementSibling?.matches('a[data-tile="left"]')).toBe(true);
    expect(line.closest("a")).toBeNull();
  });
});
