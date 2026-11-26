/**
 * Saldo päivä päivältä on Yhteenveto (BalanceDays, BalanceSteps): core's walk of the lowest balance drawn as it is, its
 * lowest corner ringed with its sum, the payday a rule, the day read out with its range and steps, and the payments and
 * pays folded under it as a table. The web adds up nothing.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { KnownLowPoint } from "../src/charts/forms/BalanceSteps.tsx";
import { BalanceDays } from "../src/components/home/BalanceDays.tsx";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const corner = (date: string, cents: number, lowCents = cents, highCents = cents) => ({ date, cents, lowCents, highCents });

// today 10.12. with 200 € of card debt, the rent on 13.12. takes the balance to its lowest, the pay lands on 14.12.
// The spending between the days is rows of its own: 100 € a day, and on 14.12. a card's purchases of 30 € besides 20 €.
const walk: KnownLowPoint = {
  known: true,
  date: "2026-12-13",
  cents: 30_000,
  lowCents: 12_000,
  highCents: 48_000,
  days: 5,
  line: [
    corner("2026-12-10", 120_000),
    corner("2026-12-11", 110_000, 105_000, 115_000),
    corner("2026-12-12", 100_000, 90_000, 110_000),
    corner("2026-12-13", 90_000, 72_000, 108_000),
    corner("2026-12-13", 30_000, 12_000, 48_000),
    corner("2026-12-14", 25_000, 5_000, 45_000),
    corner("2026-12-14", 225_000, 205_000, 245_000),
  ],
  steps: [
    { date: "2026-12-13", payee: "Vuokra", cents: -60_000, estimate: false, afterCents: 30_000 },
    { date: "2026-12-14", payee: "Palkka", cents: 200_000, estimate: true, afterCents: 225_000 },
  ],
  startCents: 120_000,
  cardDebtCents: 20_000,
  everydayPerDayCents: 10_000,
  spending: [
    { date: "2026-12-13", since: "2026-12-10", until: "2026-12-12", kind: "everyday", cents: -30_000, afterCents: 90_000 },
    { date: "2026-12-14", since: "2026-12-13", until: "2026-12-13", kind: "everyday", cents: -2_000, afterCents: 28_000 },
    { date: "2026-12-14", since: "2026-12-13", until: "2026-12-13", kind: "cards", cents: -3_000, afterCents: 25_000 },
  ],
};

const view = (payday: string | null = "2026-12-14") => render(createElement(BalanceDays, { low: walk, payday })).container;
const cells = (tr: Element) => [...tr.children].map((c) => flat(c.textContent));

afterEach(cleanup);

describe("BalanceDays", () => {
  it("rings the lowest corner with core's day and sum and names the picture by them", () => {
    const c = view();
    expect(c.querySelectorAll(".qc-low")).toHaveLength(1);
    expect(flat(c.querySelector(".qc-note")?.textContent)).toBe("alimmillaan 13.12. 300 €");
    expect(flat(c.querySelector('[role="img"]')?.getAttribute("aria-label"))).toBe("Tilien saldo päivittäin 10.12.–14.12. Alimmillaan 13.12., arviolta 300 €.");
  });

  it("reads out the lowest day while nothing is pointed at: its balance, its range and its payments", () => {
    const c = view();
    expect(flat(c.querySelector(".readout-title")?.textContent)).toBe("13.12.");
    expect([...c.querySelectorAll(".readout-part")].map((p) => flat(p.textContent))).toEqual(["Saldo 300 €", "tavallisesti 120–480 €", "Vuokra −600 €"]);
  });

  it("names the biggest payment at its step and draws the payday as a rule only inside the days", () => {
    const c = view();
    expect([...c.querySelectorAll(".qc-end-sub")].map((e) => flat(e.textContent))).toEqual(["palkkapäivä 14.12.", "Vuokra 600 €"]);
    expect(view("2027-01-23").querySelector(".kit-event-rule")).toBeNull();
  });

  it("folds the payments, pays and spending under the picture, each balance the one before plus the row's sum", () => {
    const c = view();
    expect(flat(c.querySelector(".chart-fold-title")?.textContent)).toBe("Maksut taulukkona");
    expect(flat(c.querySelector(".chart-fold-count")?.textContent)).toBe("6 riviä");
    expect([...c.querySelectorAll("tbody tr")].map(cells)).toEqual([
      ["10.12.", "Korttivelka tänään", "−200,00 €", "1 200,00 €"],
      ["10.12.", "Arvioitu kulutus 10.12.–12.12., noin 100 € päivässä", "−300,00 €", "900,00 €"],
      ["13.12.", "Vuokra", "−600,00 €", "300,00 €"],
      ["13.12.", "Arvioitu kulutus 13.12.", "−20,00 €", "280,00 €"],
      ["13.12.", "Korttiostot ennen palkkapäivää, arvio", "−30,00 €", "250,00 €"],
      ["14.12.", "Palkka, arvio", "2 000,00 €", "2 250,00 €"],
    ]);
  });
});
