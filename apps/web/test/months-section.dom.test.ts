/** Raportit > Tulot ja menot: the twelve months of income and spending as bars, each a link to its rows. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CashflowLead, section } from "../src/pages/reports/sections/Months.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import { queryClient } from "../src/query-client.ts";
import { stubApi } from "./dom-kit.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

const TODAY = "2026-11-11";
const monthsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });

const MONTHS = monthsOf(12).map((month, i) => ({ month, incomeCents: 400000 + i * 100, spendCents: 300000 + i * 100, complete: i > 0 && i < 11, againstUsual: i > 0 && i < 11 ? { cents: 300000 + i * 100 - 214900, side: "more" as const } : null }));
const categories = { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, fromSavingsCents: 0, usualMonths: 0 };
// what the server adds up over the ten complete months of MONTHS: the page prints these and sums nothing
const completeTotals = { months: 10, incomeCents: 4005000, averageIncomeCents: 400500, spendCents: 3005500, peak: { month: "2026-10", spendCents: 301000 } };
const overview = (more: Record<string, unknown> = {}) => ({ months: MONTHS, usualSpendCents: 214900, usualMonths: 10, completeTotals, categories, ...more });
const stripItems = () => [...document.querySelectorAll(".strip-item")].map((li) => [...li.children].map((c) => flat(c.textContent)).join(" "));

const ctx = { meta: { today: TODAY, accounts: [{ id: "acc-1" }], sharedAccounts: [] }, scope: "own", data: { income: { monthlyCents: 396000 } } } as unknown as ReportContext;

/** The answer is cached by its path: each show starts with an empty cache and no earlier view, so it reads its own. */
function fresh() {
  cleanup();
  queryClient.clear();
}

async function show(answer: unknown) {
  fresh();
  stubApi({ "GET /api/dashboard": answer });
  const view = render(createElement(section.Component, { ctx }));
  await waitFor(() => expect(view.container.querySelector("svg a")).not.toBeNull());
  return view.container;
}

describe("Tulot ja menot", () => {
  it("is a section of Raportit > Tulot ja menot, named for what it shows", () => {
    expect(section.page).toBe("reports");
    expect(section.title).toBe("Tulot ja menot kuukausittain");
    expect(section.visible?.(ctx)).toBe(true);
    expect(section.visible?.({ ...ctx, meta: { ...ctx.meta, accounts: [] } } as ReportContext)).toBe(false);
  });

  it("draws twelve months, each a link to its rows, the running one to today", async () => {
    const container = await show({ overview: overview() });
    expect(screen.getByRole("region", { name: "Tulot ja menot kuukausittain" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tulot ja menot kuukausittain" })).toBeTruthy();
    const links = [...container.querySelectorAll("svg a")];
    expect(links).toHaveLength(12);
    expect(links[0]!.getAttribute("href")).toBe("#/transactions?from=2025-12-01&to=2025-12-31");
    expect(links[10]!.getAttribute("href")).toBe("#/transactions?from=2026-10-01&to=2026-10-31");
    expect(links[11]!.getAttribute("href")).toBe("#/transactions?from=2026-11-01&to=2026-11-11");
    // the link names the month and its two sums, so a reader who cannot see the bars hears them
    expect(flat(links[11]!.getAttribute("aria-label"))).toMatch(/^Marraskuu 2026.*Tulot 4 011 €.*Menot ilman säästöistä maksettua 3 011 €.*kesken/i);
    // the year stands under the first month and under January
    const years = [...container.querySelectorAll("svg text tspan")].map((s) => s.textContent).filter((s) => /^\d{4}$/.test(s ?? ""));
    expect(years).toEqual(["2025", "2026"]);
  });

  it("marks the running month and one the accounts do not cover from its 1st as not whole, and no other", async () => {
    const container = await show({ overview: overview() });
    const groups = [...container.querySelectorAll(".mb-month")];
    expect(groups.map((g) => g.classList.contains("mb-partial"))).toEqual([true, ...Array(10).fill(false), true]);
    // the two partial months are hatched, the running one says so under its name, and there is no key list
    expect(groups.filter((g) => g.querySelector(".mb-spend-part")?.getAttribute("fill")?.startsWith("url(#")).length).toBe(2);
    expect(container.querySelector(".mb-key")).toBeNull();
    expect(flat(groups[11]!.querySelector("text")?.textContent)).toBe("marraskesken");
  });

  // a card joining in a month leaves its spending partial and its income whole: Tulolajit draws the month solid, so its income bar is too
  it("hatches an income bar only where the income report does not count the month complete", async () => {
    fresh();
    stubApi({ "GET /api/dashboard": { overview: overview() } });
    const incomeCtx = { ...ctx, data: { income: { monthlyCents: 396000, months: MONTHS.map((m, i) => ({ month: m.month, complete: i < 11 })) } } } as unknown as ReportContext;
    const view = render(createElement(section.Component, { ctx: incomeCtx }));
    await waitFor(() => expect(view.container.querySelector("svg a")).not.toBeNull());
    const [first, ...rest] = [...view.container.querySelectorAll(".mb-month")];
    expect(first!.querySelector(".mb-income")).not.toBeNull();
    expect(first!.querySelector(".mb-income-part")).toBeNull();
    expect(first!.querySelector(".mb-spend-part")).not.toBeNull();
    // the running month is hatched in both bars
    expect(rest.at(-1)!.querySelector(".mb-income-part")).not.toBeNull();
  });

  it("draws the usual month as a line and names it at the line's end, and leaves both out without one", async () => {
    const usual = await show({ overview: overview() });
    expect(usual.querySelector(".mb-usual")).not.toBeNull();
    expect(flat(usual.querySelector("text.usual-label")?.textContent)).toBe("tavallinen kuukausi 2 149 €");
    const none = await show({ overview: overview({ usualSpendCents: null, usualMonths: 0 }) });
    expect(none.querySelector(".mb-usual")).toBeNull();
    expect(none.querySelector("text.usual-label")).toBeNull();
  });

  it("names the last whole month and its sums in the readout line while nothing is picked", async () => {
    const container = await show({ overview: overview() });
    const readout = flat(container.querySelector(".readout-line")?.textContent);
    expect(readout).toContain("lokakuu 2026");
    expect(readout).toContain("Tulot 4 010 €");
    expect(readout).toContain("Menot ilman säästöistä maksettua 3 010 €");
    expect(readout).toContain("menot 861 € yli tavallisen");
  });

  it("gives the comparison in the month's link and the live readout, and none for a month that is not whole", async () => {
    const container = await show({ overview: overview() });
    const links = [...container.querySelectorAll("svg a")];
    expect(flat(links[10]!.getAttribute("aria-label"))).toContain("menot 861 € yli tavallisen");
    expect(flat(links[11]!.getAttribute("aria-label"))).not.toContain("tavallisen");
    expect(flat(links[0]!.getAttribute("aria-label"))).not.toContain("tavallisen");
  });

  it("leaves the sentence to the page's lead: the section draws only the bars", async () => {
    const container = await show({ overview: overview({ gap: { gapCents: 123400, creditCents: 50000, savingsCents: 73400, accountsCents: 0 } }) });
    expect(flat(container.textContent)).not.toContain("ylittivät tulot");
    expect(container.querySelector(".q-lead")).toBeNull();
  });

  it("is nothing with no month", async () => {
    fresh();
    stubApi({ "GET /api/dashboard": { overview: overview({ months: [] }) } });
    const view = render(createElement(section.Component, { ctx }));
    await waitFor(() => expect(view.container.innerHTML).toBe(""));
  });
});

describe("Tulot ja menot: the sentence the page opens with", () => {
  async function lead(answer: unknown) {
    fresh();
    stubApi({ "GET /api/dashboard": answer });
    const view = render(createElement(CashflowLead, { ctx }));
    await waitFor(() => expect(view.container.querySelector(".q-lead")).not.toBeNull());
    return flat(view.container.querySelector(".q-lead")?.textContent);
  }

  it("says the gap of the complete months and what paid it, naming only the parts above zero", async () => {
    const text = await lead({ overview: overview({ gap: { gapCents: 123400, creditCents: 50000, savingsCents: 73400, accountsCents: 0 } }) });
    expect(text).toContain("ylittivät tulot 1 234 €");
    expect(text).toContain("rahat tulivat luotosta 500 € ja säästöistä 734 €.");
    expect(text).not.toContain("tileiltä");
  });

  it("says the gap alone when nothing is known to have paid it", async () => {
    const text = await lead({ overview: overview({ gap: { gapCents: 20000, creditCents: 0, savingsCents: 0, accountsCents: 0 } }) });
    expect(text).toContain("ylittivät tulot 200 €");
    expect(text).not.toContain("rahat tulivat");
  });

  it("says the income covered the complete months when they have no gap, and gives their figures once, in the strip", async () => {
    // the ten complete months of MONTHS
    expect(await lead({ overview: overview() })).toBe("Päättyneinä kuukausina tulot riittivät menoihin ja säästöön siirrettyyn rahaan.");
    expect(stripItems()).toEqual([
      "Tulot, 10 kk 40 050 € Keskimäärin 4 005 € kuussa",
      "Menot, 10 kk 30 055 € Suurin kuukausi lokakuu 2026, 3 010 €",
      "Tavallinen kuukausi 2 149 € Ilman suuria ostoja, 10 kk",
    ]);
  });

  it("prints the server's totals as they are, whatever the months of the answer hold", async () => {
    await lead({ overview: overview({ completeTotals: { months: 3, incomeCents: 1234500, averageIncomeCents: 411500, spendCents: 987600, peak: { month: "2026-09", spendCents: 400000 } } }) });
    expect(stripItems().slice(0, 2)).toEqual(["Tulot, 3 kk 12 345 € Keskimäärin 4 115 € kuussa", "Menot, 3 kk 9 876 € Suurin kuukausi syyskuu 2026, 4 000 €"]);
  });

  it("draws the strip under the gap sentence when the months took more than they earned", async () => {
    const text = await lead({ overview: overview({ gap: { gapCents: 20000, creditCents: 0, savingsCents: 0, accountsCents: 0 } }) });
    expect(text).toContain("ylittivät tulot 200 €");
    expect(stripItems()).toHaveLength(3);
    expect(stripItems()[0]).toBe("Tulot, 10 kk 40 050 € Keskimäärin 4 005 € kuussa");
  });

  it("draws two figures when there is no usual month, and names no dearest month of a single one", async () => {
    await lead({ overview: overview({ usualSpendCents: null, usualMonths: 0, completeTotals: { months: 1, incomeCents: 400100, averageIncomeCents: 400100, spendCents: 300100, peak: null } }) });
    expect(document.querySelector(".strip")!.getAttribute("data-count")).toBe("2");
    expect(stripItems()).toEqual(["Tulot, 1 kk 4 001 € Keskimäärin 4 001 € kuussa", "Menot, 1 kk 3 001 €"]);
  });

  it("is nothing when no month is complete", async () => {
    fresh();
    const seen = stubApi({ "GET /api/dashboard": { overview: overview({ months: MONTHS.map((m) => ({ ...m, complete: false })), completeTotals: null }) } });
    const view = render(createElement(CashflowLead, { ctx }));
    await waitFor(() => expect(seen.length).toBe(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((done) => setTimeout(done, 0));
    expect(view.container.querySelector(".q-lead")).toBeNull();
  });
});
