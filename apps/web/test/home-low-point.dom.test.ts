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

  it("spaces the dash of a range that starts below zero, mixed or all below it, so the minus is not read as the dash", () => {
    expect(lineOf(known({ lowCents: -25_000, highCents: 5_000 }))).toBe("Alin saldo 60 pv: 13.12., arviolta −250 – 50 €");
    expect(lineOf(known({ cents: -30_000, lowCents: -48_000, highCents: -12_000 }))).toBe("Alin saldo 60 pv: 13.12., arviolta −480 – −120 €");
  });

  it("keeps the dash of a range that stays above zero tight", () => {
    expect(lineOf(known({ lowCents: 0, highCents: 5_000 }))).toBe("Alin saldo 60 pv: 13.12., arviolta 0–50 €");
  });

  it.each([
    ["no-payday", "Alin saldo 60 pv: Palkkapäivä ei vielä tiedossa"],
    ["late", "Alin saldo 60 pv: Palkkasi on myöhässä"],
    ["no-balance", "Alin saldo 60 pv: Käyttötilin saldo puuttuu"],
    ["no-card-balance", "Alin saldo 60 pv: Kortin saldo puuttuu"],
    ["history", "Alin saldo 60 pv: Liian lyhyt historia"],
    ["cards", "Alin saldo 60 pv: Kortin ostot eivät näy historiassa"],
    ["bills", "Alin saldo 60 pv: Laskun summa tai päivä ei ole tiedossa"],
  ] as const)("says the reason %s and no figure", (reason, text) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(flat(container.textContent)).toBe(text);
    expect(container.querySelector(".home-low-status")?.textContent).not.toMatch(/\d/);
  });

  it.each(["no-balance", "no-card-balance"] as const)("links the reason %s to the state of the fetch, and no other reason", (reason) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(container.querySelector(".home-low-status a")?.getAttribute("href")).toBe("#/settings/banks");
  });

  it.each(["no-payday", "late", "history", "bills"] as const)("leaves the reason %s as plain text", (reason) => {
    const { container } = render(createElement(LowPoint, { lowPoint: { known: false, reason, days: 60 } }));
    expect(container.querySelector(".home-low-status a")).toBeNull();
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
