/** Raportit > Menot, Tulot ja menot: the twelve months of income and spending as bars, each a link to its rows. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { section } from "../src/pages/reports/sections/Months.tsx";
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

const MONTHS = monthsOf(12).map((month, i) => ({ month, incomeCents: 400000 + i * 100, spendCents: 300000 + i * 100, complete: i > 0 && i < 11 }));
const categories = { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, fromSavingsCents: 0, usualMonths: 0 };
const overview = (more: Record<string, unknown> = {}) => ({ months: MONTHS, usualSpendCents: 214900, usualMonths: 10, categories, ...more });

const ctx = { meta: { today: TODAY, accounts: [{ id: "acc-1" }], sharedAccounts: [] }, scope: "own" } as unknown as ReportContext;

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
  it("is a section of Raportit > Menot, named for what it shows", () => {
    expect(section.page).toBe("reports");
    expect(section.title).toBe("Tulot ja menot");
    expect(section.visible?.(ctx)).toBe(true);
    expect(section.visible?.({ ...ctx, meta: { ...ctx.meta, accounts: [] } } as ReportContext)).toBe(false);
  });

  it("draws twelve months, each a link to its rows, the running one to today", async () => {
    const container = await show({ overview: overview() });
    expect(screen.getByRole("region", { name: "Tulot ja menot" })).toBeTruthy();
    const links = [...container.querySelectorAll("svg a")];
    expect(links).toHaveLength(12);
    expect(links[0]!.getAttribute("href")).toBe("#/transactions?from=2025-12-01&to=2025-12-31");
    expect(links[10]!.getAttribute("href")).toBe("#/transactions?from=2026-10-01&to=2026-10-31");
    expect(links[11]!.getAttribute("href")).toBe("#/transactions?from=2026-11-01&to=2026-11-11");
    // the link names the month and its two sums, so a reader who cannot see the bars hears them
    expect(flat(links[11]!.getAttribute("aria-label"))).toMatch(/^Marraskuu 2026.*Tulot 4 011 €.*Menot ilman säästöistä maksettua 3 011 €.*kesken/i);
    // the year stands under January only
    const years = [...container.querySelectorAll("svg text tspan")].map((s) => s.textContent).filter((s) => /^\d{4}$/.test(s ?? ""));
    expect(years).toEqual(["2026"]);
  });

  it("marks the running month and one the accounts do not cover from its 1st as not whole, and no other", async () => {
    const container = await show({ overview: overview() });
    const groups = [...container.querySelectorAll(".mb-month")];
    expect(groups.map((g) => g.classList.contains("mb-partial"))).toEqual([true, ...Array(10).fill(false), true]);
    // the two partial months are hatched, and the key says what the hatching means
    expect(groups.filter((g) => g.querySelector(".mb-spend-part")?.getAttribute("fill")?.startsWith("url(#")).length).toBe(2);
    expect(flat(container.querySelector(".mb-key")?.textContent)).toContain("Kesken tai vajaa kuukausi");
  });

  it("draws the usual month as a line and names it in the key, and leaves both out without one", async () => {
    const usual = await show({ overview: overview() });
    expect(usual.querySelector(".mb-usual")).not.toBeNull();
    expect(flat(usual.querySelector(".mb-key")?.textContent)).toContain("Tavallinen kuukausi 2 149 € (10 kk)");
    const none = await show({ overview: overview({ usualSpendCents: null, usualMonths: 0 }) });
    expect(none.querySelector(".mb-usual")).toBeNull();
    expect(flat(none.querySelector(".mb-key")?.textContent)).not.toContain("Tavallinen");
  });

  it("is nothing with no month", async () => {
    fresh();
    stubApi({ "GET /api/dashboard": { overview: overview({ months: [] }) } });
    const view = render(createElement(section.Component, { ctx }));
    await waitFor(() => expect(view.container.innerHTML).toBe(""));
  });
});
