/**
 * One placement for Kategoriat and Menot kuukausittain (reports/shared.ts `placeOf`, which reads `themeOf`): with a
 * car, Auto holds the car's fuel, insurance, tax and finance in both, so each group of Kategoriat is the theme of the
 * same name to the cent, and a category the car takes part of is a row in Auto and a row in its own group.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addMonths, dateIn, monthEnd } from "../src/dates.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Pankki" };
const TODAY = "2026-12-05";
const RANGE = { from: "2025-12-01", to: monthEnd("2026-11") };

const monthly = (euros: number, merchant: string, category: string, day: number): Transaction[] => {
  const out: Transaction[] = [];
  for (let m = "2025-12"; m <= "2026-11"; m = addMonths(m, 1)) out.push(tx({ bookingDate: dateIn(m, day), amountCents: -euros * 100, merchant, category, categorySource: "rule" }));
  return out;
};
const once = (date: string, euros: number, merchant: string, category: string) => tx({ bookingDate: date, amountCents: -euros * 100, merchant, category, categorySource: "rule" });

const rows = [
  ...monthly(900, "Asunto Oy Esimerkki", "housing", 1),
  ...monthly(300, "Lähikauppa", "groceries", 6),
  ...monthly(70, "Neste Keskusta", "car", 9),
  ...monthly(250, "Autolaina Rahoitus Oy", "loans", 15),
  ...monthly(120, "Kulutusluotto Pankki", "loans", 16),
  ...monthly(40, "Liikennevakuutus Vakuutusyhtiö", "insurance", 20),
  ...monthly(25, "Kotivakuutus Vakuutusyhtiö", "insurance", 21),
  once("2026-03-10", 180, "Traficom Ajoneuvovero", "taxes"),
  once("2026-05-10", 60, "Kunnan jätemaksu", "taxes"),
];
const ctx = createContext(rows, [checking], TODAY);

describe("a household with car costs in several categories", () => {
  const categories = categoryReport(ctx, RANGE);
  const pivot = pivotReport(ctx, RANGE);
  const themes = [...pivot.themes, ...(pivot.rest?.themes ?? [])];

  it("has each group of Kategoriat equal to its theme of Menot kuukausittain", () => {
    expect(pivot.large).toBeNull();
    const groups = Object.fromEntries(categories.groups.map((g) => [g.group, g.totalCents]));
    expect(Object.fromEntries(themes.map((t) => [t.label, t.totalCents]))).toEqual(groups);
    expect(groups["Auto"]).toBe(12 * (70 + 250 + 40) * 100 + 18_000);
  });

  it("puts the car's part of a category in Auto, named so, and the rest in its own group", () => {
    const auto = categories.groups.find((g) => g.group === "Auto")!;
    expect(auto.categories.map((c) => c.label).sort()).toEqual(["Auto, polttoaine ja pysäköinti", "Kulutusluotot (Auto)", "Vakuutukset (Auto)", "Verot, maksut ja sakot (Auto)"]);
    const insurance = categories.groups.find((g) => g.group === "Vakuutukset")!;
    expect(insurance.totalCents).toBe(12 * 2_500);
    // the table of Menot kuukausittain has the same rows
    const placed = (r: { group: string; category: string; totalCents: number }) => `${r.group}/${r.category}=${r.totalCents}`;
    expect(pivot.rows.map(placed).sort()).toEqual(categories.groups.flatMap((g) => g.categories.map((c) => placed({ ...c, group: g.group }))).sort());
  });
});
