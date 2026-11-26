/**
 * Mistä luku koostuu on Yhteenveto (Breakdown): core's walk to the payday as rows that start at the accounts of the Nyt card
 * and add up, to the cent, to the figure of the Arvio card, its total. The web adds up nothing; the test does.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { KnownLowPoint } from "../src/charts/forms/BalanceSteps.tsx";
import { Breakdown, type Runway } from "../src/components/home/Breakdown.tsx";
import { breakdownShown } from "../src/components/home/breakdown-shown.ts";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(cleanup);

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const cellsOf = (tr: Element) => [...tr.children].map((c) => flat(c.textContent));
/** "−1 500,00 €" as cents. */
const centsOf = (text: string) => Math.round(Number(text.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", ".")) * 100);

const corner = (date: string, cents: number) => ({ date, cents, lowCents: cents, highCents: cents });
// 1 400 € on the accounts, 200 € of card debt no bill holds, rent 600 € (a known sum) and a bill of 45,50 € (an estimate), the
// spending between the days, and the pay of the payday, which lands after them and is left out
const low: KnownLowPoint = {
  known: true,
  date: "2026-12-13",
  cents: 30_000,
  lowCents: 30_000,
  highCents: 30_000,
  days: 5,
  line: [corner("2026-12-10", 120_000), corner("2026-12-14", 25_000)],
  steps: [
    { date: "2026-12-13", payee: "Vuokra", cents: -60_000, estimate: false, afterCents: 30_000, rowAfterCents: 30_000 },
    { date: "2026-12-13", payee: "Sähkö", cents: -4_550, estimate: true, afterCents: 30_000, rowAfterCents: 30_000 },
    { date: "2026-12-14", payee: "Palkka", cents: 200_000, estimate: true, afterCents: 225_000, rowAfterCents: 225_000 },
  ],
  startCents: 120_000,
  cardDebtCents: 20_000,
  spending: [
    { date: "2026-12-13", since: "2026-12-10", until: "2026-12-12", kind: "everyday", cents: -30_000, afterCents: 90_000 },
    { date: "2026-12-14", since: "2026-12-13", until: "2026-12-13", kind: "everyday", cents: -2_000, afterCents: 28_000 },
  ],
};
const leftCents = 120_000 - 60_000 - 4_550 - 30_000 - 2_000;
const runway = { known: true, from: "2026-12-10", payday: { date: "2026-12-14", name: "Työnantaja" }, days: 4, balanceCents: 140_000, freeCents: 0, everydayCents: 0, billedCents: 0, laterCents: 0, leftCents, lowCents: leftCents, highCents: leftCents, months: 6 } as Runway;

describe("Breakdown", () => {
  it("starts at the accounts of the Nyt card and its rows add up to the figure of the Arvio card, which is the total", () => {
    const { container } = render(createElement(Breakdown, { low, runway }));
    const rows = [...container.querySelectorAll("tbody tr")].map(cellsOf);
    expect(rows.map((r) => [r[0], r[r.length - 1]])).toEqual([
      ["Tilien saldo nyt", "1 400,00 €"],
      ["Korttivelka laskujen lisäksi", "−200,00 €"],
      ["Arvioitu kulutus 10.–12.12.", "−300,00 €"],
      ["Vuokra", "−600,00 €"],
      ["Sähkö, arvio", "−45,50 €"],
      ["Arvioitu kulutus 13.12.", "−20,00 €"],
    ]);
    const total = cellsOf(container.querySelector("tfoot tr")!);
    expect(total[0]).toBe("Jää palkkapäivänä");
    expect(rows.reduce((sum, r) => sum + centsOf(r[r.length - 1]!), 0)).toBe(centsOf(total[total.length - 1]!));
    expect(centsOf(total[total.length - 1]!)).toBe(runway.leftCents);
  });

  it("has no rows when they do not make the figure", () => {
    expect(breakdownShown(low, runway)).toBe(true);
    expect(breakdownShown(low, { ...runway, leftCents: leftCents + 1 })).toBe(false);
    expect(render(createElement(Breakdown, { low, runway: { ...runway, leftCents: leftCents + 1 } })).container.querySelector("table")).toBeNull();
  });
});
