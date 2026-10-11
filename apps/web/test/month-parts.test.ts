import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bridgeIncome, bridgeParts } from "../src/components/month-parts.ts";
import type { DashboardData } from "../src/types.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("the surplus bridge", () => {
  const totals = { incomeCents: 400000, consumptionCents: 250000, debtCents: 40000, savedCents: 50000, leftCents: 60000 };

  it("keeps the order and gives every part a colour of its own", () => {
    const parts = bridgeParts(totals);
    expect(parts.map((p) => p.label)).toEqual(["Kulutus", "Velanhoito", "Säästöön", "Yli jäi"]);
    expect(new Set(parts.map((p) => p.color)).size).toBe(4);
  });

  it("what stayed is not drawn in the colour of the income in the cash flow chart under it", () => {
    const income = /key: "income"[^}]*?color: "(var\(--series-\d\))"/.exec(source("pages/reports/sections/Cashflow.tsx"))?.[1];
    expect(income).toBeDefined();
    expect(bridgeParts(totals).map((p) => p.color)).not.toContain(income);
    // the component takes its parts from the one list
    expect(source("components/SurplusBridge.tsx")).toContain("bridgeParts(");
  });

  it("a negative remainder is no segment, and savings taken out are none either", () => {
    const over = bridgeParts({ ...totals, leftCents: -20000, savedCents: -5000 });
    expect(over.find((p) => p.key === "left")!.cents).toBe(0);
    expect(over.find((p) => p.key === "saved")!.cents).toBe(0);
  });

  it("the sentence names the income its change is told from, never all income against the usual earned income", () => {
    const bridge = (incomeCents: number, earnedIncomeCents: number | null, usualIncomeCents: number | null) =>
      ({ totals: { ...totals, incomeCents }, basis: "range", month: "2026-09", usualIncomeCents, earnedIncomeCents, usualSavingsRate: null }) as unknown as Parameters<typeof bridgeIncome>[0];
    // settled seed 3: 3 825 € in, of which 3 605 € earned, against a usual income of 3 607 €
    expect(bridgeIncome(bridge(382541, 360541, 360701))).toEqual({ label: "Ansiotulot", cents: 360541, usualCents: 360701 });
    expect(bridgeIncome(bridge(300000, 300000, 290000))).toEqual({ label: "Tulot", cents: 300000, usualCents: 290000 });
    // a month that is not complete has no usual income and keeps the bar's figure
    expect(bridgeIncome(bridge(300000, null, null))).toEqual({ label: "Tulot", cents: 300000, usualCents: null });
    expect(source("pages/Overview.tsx")).toContain("bridgeIncome(b)");
  });
});
