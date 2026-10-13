import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section } from "../src/pages/reports/sections/Food.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

/** A line as core gives it; `over` is what a test changes. */
const line = (id: string, heading: string, cents: number, over: Record<string, unknown> = {}) => ({
  id,
  heading,
  cents,
  monthlyCents: Math.round(cents / 12),
  monthCents: [cents],
  dearest: 0,
  weekCents: Math.round((cents * 7) / 365),
  purchases: 20,
  meanCents: 4_000,
  perMonth: 2.5,
  payees: [],
  otherCents: 0,
  weekdays: null,
  changeCents: null,
  ...over,
});
const food = (over: Record<string, unknown> = {}, lines = [
  line("groceries", "Ruokakauppa", 721_440),
  line("restaurants", "Ravintolat ja kahvilat", 324_050),
  line("food_delivery", "Ruoan kotiinkuljetus", 254_610),
  line("alcohol", "Alko", 41_200),
]) => ({ window: { first: "2025-10", last: "2026-09", months: 12, days: 365 }, lines, cents: 1_341_300, monthlyCents: 111_775, cardBills: null, basket: null, ...over });
const context = (data: unknown): ReportContext => ({ data: { food: data }, meta: { today: "2026-10-11" } }) as unknown as ReportContext;
/** The markup with every kind of space a figure uses as a plain one. */
const html = (data: unknown) => renderToStaticMarkup(createElement(section.Component, { ctx: context(data) })).replace(/[  ]/g, " ");
/** The cells of the row of a line, by its name. */
const cells = (out: string, name: string) => {
  const row = out.split("<tr").find((r) => r.includes(`>${name}<`)) ?? "";
  return [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
};

describe("Raportit: Ruoka", () => {
  it("is there when core has a window with food, and not otherwise", () => {
    expect(section.visible?.(context(food()))).toBe(true);
    expect(section.visible?.(context(null))).toBe(false);
  });

  it("prints the shares of the four lines as 54, 24, 19 and 3, which add up to 100", () => {
    const out = html(food());
    expect(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus", "Alko"].map((n) => cells(out, n)[1])).toEqual(["54 %", "24 %", "19 %", "3 %"]);
    expect(out).toContain("10/2025–9/2026");
  });

  it("gives a line at or under zero its row with dashes, and leaves it out of the shares", () => {
    const lines = [line("groceries", "Ruokakauppa", 100_000), line("restaurants", "Ravintolat ja kahvilat", -5_000, { weekCents: null, meanCents: null, perMonth: null, monthCents: [-5_000], dearest: null })];
    const out = html(food({ lines }, lines));
    expect(cells(out, "Ravintolat ja kahvilat").slice(1)).toEqual(["–", "–", "–", "–"]);
    expect(cells(out, "Ruokakauppa")[1]).toBe("100 %");
    expect(out).toContain("−4,17 €");
  });

  it("has the card bills as the first row when the window holds some, and no row otherwise", () => {
    expect(html(food())).not.toContain("Luottokortin laskut");
    const out = html(food({ cardBills: { cents: 120_000, monthlyCents: 10_000 } }));
    expect(out.indexOf("Luottokortin laskut")).toBeGreaterThan(0);
    expect(out.indexOf("Luottokortin laskut")).toBeLessThan(out.indexOf("Ruokakauppa"));
  });

  it("has the change column only when a line has a change", () => {
    expect(html(food())).not.toContain("Muutos");
    const lines = [line("groceries", "Ruokakauppa", 721_440, { changeCents: 4_100 })];
    expect(html(food({ lines }, lines))).toContain("+41 €");
  });
});
