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
]) => ({ window: { first: "2025-10", last: "2026-09", months: 12, days: 365 }, lines, cents: 1_341_300, monthlyCents: 111_775, basket: null, ...over });
const context = (data: unknown): ReportContext => ({ data: { food: data }, meta: { today: "2026-10-11" } }) as unknown as ReportContext;
/** The markup with every kind of space a figure uses as a plain one. */
const html = (data: unknown) => renderToStaticMarkup(createElement(section.Component, { ctx: context(data) })).replace(/[  ]/g, " ");
/** The cells of the row of a line, by its name. */
const cells = (out: string, name: string) => {
  const row = out.split("<tr").find((r) => r.includes(`>${name}<`) || r.includes(`>${name}<span`)) ?? "";
  return [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
};

describe("Raportit: Ruoka", () => {
  it("is there when core has a window with food, and not otherwise", () => {
    expect(section.visible?.(context(food()))).toBe(true);
    expect(section.visible?.(context(null))).toBe(false);
  });

  it("prints the shares of the four lines as 54, 24, 19 and 3, which add up to 100", () => {
    const out = html(food());
    // the cells after the name: months, a month's spend, share, basket, visits
    expect(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus", "Alko"].map((n) => cells(out, n)[2])).toEqual(["54 %", "24 %", "19 %", "3 %"]);
    expect(out).toContain("Ruoka 1 118 € kuussa");
  });

  it("gives a line at or under zero its row with no share or basket figures, and leaves it out of the shares", () => {
    const lines = [line("groceries", "Ruokakauppa", 100_000), line("restaurants", "Ravintolat ja kahvilat", -5_000, { weekCents: null, meanCents: null, perMonth: null, monthCents: [-5_000], dearest: null })];
    const out = html(food({ lines }, lines));
    // each empty figure says why in words: no share for a line at or under zero, too few purchases for a mean
    expect(cells(out, "Ravintolat ja kahvilat").slice(2)).toEqual(["ei osuutta", "liian vähän ostoja", "–", "–"]);
    expect(cells(out, "Ruokakauppa")[2]).toBe("100 %");
    // a month's spend in whole euros, as every figure of the table (critic 1: no cents in a report table)
    expect(cells(out, "Ravintolat ja kahvilat")[1]).toBe("−4 €");
  });

  it("is one reason and no figure when core says card bills in the window have no purchases", () => {
    const text = "Ruoan menoja ei lasketa: ajalla 1.1.2026–31.8.2026 on korttilaskuja 1 600 €, mutta kortin ostot alkavat vasta 10.9.2026.";
    const out = html({ gap: { window: { from: "2026-01-01", to: "2026-08-31" }, cents: 160_000, bills: [], text } });
    expect(out).toContain("kortin ostot alkavat vasta 10.9.2026");
    expect(out).not.toContain("kuussa");
    expect(out).not.toContain("<table");
    expect(section.visible?.(context({ gap: { text } }))).toBe(true);
  });

  it("has the change column only when a line has a change or the window is long enough to say a line is as usual", () => {
    expect(html(food({ window: { first: "2026-07", last: "2026-09", months: 3, days: 92 } }))).not.toContain("Muutos");
    const lines = [line("groceries", "Ruokakauppa", 721_440, { changeCents: 4_100 })];
    expect(html(food({ lines }, lines))).toContain("+41 €");
  });
});
