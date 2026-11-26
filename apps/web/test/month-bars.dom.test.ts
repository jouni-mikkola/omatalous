/**
 * The twelve-month bars (MonthBars): a bar far above the others is cut with a break and its sum written, a short view cuts
 * nothing, and the readout keeps the true sum.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MonthBars } from "../src/charts/MonthBars.tsx";
import type { DashboardData } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

const TODAY = "2026-11-11";
const flat = (s: string | null | undefined) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const num = (el: Element | null, name: string) => Number(el!.getAttribute(name));

/** `n` months ending at the running one, each earning 4 000 € and spending 3 000 € but the one at `cutIndex`, which spends 60 000 €. */
function overviewOf(n: number, cutIndex: number): DashboardData["overview"] {
  const months = Array.from({ length: n }, (_, i) => ({
    month: `2026-${String(11 - (n - 1 - i)).padStart(2, "0")}`,
    incomeCents: 400000,
    spendCents: i === cutIndex ? 6000000 : 300000,
    fromSavingsCents: 0,
    complete: i < n - 1,
  }));
  return { months, usualSpendCents: 300000, usualMonths: Math.max(n - 1, 0) } as unknown as DashboardData["overview"];
}

const show = (overview: DashboardData["overview"]) => render(createElement(MonthBars, { overview, today: TODAY }));

describe("the twelve-month bars: a bar far above the others", () => {
  it("is cut 6 px past the top with a break, and its sum is written above it", () => {
    const { container } = show(overviewOf(6, 2));
    const spend = [...container.querySelectorAll("g.mb-month rect.mb-spend")];
    expect(spend).toHaveLength(5);
    expect(container.querySelectorAll("path.cap-break")).toHaveLength(1);
    expect(flat(container.querySelector("text.cap-sum")!.textContent)).toBe("60 000 €");
    const cut = container.querySelectorAll("g.mb-month")[2]!.querySelector("rect.mb-spend")!;
    expect(num(cut, "y")).toBe(-6);
  });

  it("keeps its true sum in the name of its link", () => {
    const { container } = show(overviewOf(6, 2));
    const label = container.querySelectorAll("svg a")[2]!.getAttribute("aria-label");
    expect(flat(label)).toContain("60 000 €");
  });

  it("names the spending Menot ilman säästöistä maksettua only for a month where savings paid a debt", () => {
    const overview = overviewOf(3, 1);
    overview.months[2]!.fromSavingsCents = 50_000;
    const labels = [...show(overview).container.querySelectorAll("svg a")].map((a) => flat(a.getAttribute("aria-label")));
    expect(labels[1]).toContain("Menot ");
    expect(labels[1]).not.toContain("Menot ilman säästöistä maksettua");
    expect(labels[2]).toContain("Menot ilman säästöistä maksettua");
  });

  it("is not cut in a view of three months, where a usual level or two bars a month would otherwise make four values", () => {
    const { container } = show(overviewOf(3, 1));
    expect(container.querySelector("path.cap-break")).toBeNull();
    expect(container.querySelector("text.cap-sum")).toBeNull();
    expect(num(container.querySelectorAll("g.mb-month")[1]!.querySelector("rect.mb-spend"), "y")).toBeGreaterThanOrEqual(0);
  });
});
