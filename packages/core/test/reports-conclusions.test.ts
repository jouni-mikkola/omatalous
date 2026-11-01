import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { COMPARE_KINDS, QUESTIONS } from "../src/reports/conclusion.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const range = { from: "2026-01-01", to: "2026-09-30" };
const balances = [{ id: "acc-1", name: "Käyttötili", type: "checking" as const, balanceCents: 123456, ownerName: null, balanceAt: null }];

// the same account used by two members: the household has a joint account
const jointBalances = [{ ...balances[0]!, use: { users: [{ userId: "u1", label: "Aino", weight: 0.5 }, { userId: "u2", label: "Eero", weight: 0.5 }], source: "said" as const } }];

describe("the conclusion of each question page of Raportit", () => {
  const r = buildReports({ ctx: createContext(dataset(), [checking], today), range, balances });
  const joint = buildReports({ ctx: createContext(dataset(), [checking], today), range, balances: jointBalances });

  it("every page has one, and its basis rows add up to its figure to the cent", () => {
    // the household has no joint account, so only the shared page has nothing to say
    expect(QUESTIONS.filter((q) => r.conclusions[q] === null)).toEqual(["yhteiset"]);
    for (const q of QUESTIONS) {
      const c = r.conclusions[q];
      if (c === null) continue;
      expect(c.question, q).not.toBe("");
      // Tulot leaves it empty: Tulojen käyttö below the head tells where Tulos comes from, to the euro
      if (q !== "tulot") expect(c.explanation, q).not.toBe("");
      // a figure of nothing (no debt) has no rows to show
      if (c.verdict.figure.cents !== 0) expect(c.basis.rows.length, q).toBeGreaterThan(0);
      expect(c.basis.rows.reduce((sum, row) => sum + row.cents, 0), q).toBe(c.verdict.figure.cents);
    }
  });

  it("Velat names the lender paid every month whose loan was never saved, which its total leaves out", () => {
    expect(r.conclusions.velat!.explanation).toContain("Summassa ei ole lainaa, jonka saldo puuttuu: Nordea Rahoitus Suomi Oy.");
  });

  it("each page is named by one or two nouns, and Rahankäyttö names categories, not themes", () => {
    for (const q of QUESTIONS) {
      const c = r.conclusions[q];
      if (c) expect(c.question.split(" ").length, q).toBeLessThanOrEqual(2);
    }
    const themes = new Set(r.categories.groups.map((g) => g.group));
    const menot = r.conclusions.menot!;
    expect(menot.basis.rows.some((row) => themes.has(row.label) && !r.spendingTable.rows.some((x) => x.label === row.label))).toBe(false);
    expect(menot.explanation).not.toContain("kategoriaan Asuminen");
  });

  it("a household with a joint account gets the shared page too, and its basis adds up", () => {
    const c = joint.conclusions.yhteiset;
    expect(c).not.toBeNull();
    expect(c!.verdict.figure.cents).toBeGreaterThan(0);
    expect(c!.basis.rows.length).toBeGreaterThan(0);
    expect(c!.basis.rows.reduce((sum, row) => sum + row.cents, 0)).toBe(c!.verdict.figure.cents);
    expect(c!.basis.accounts).toEqual([{ id: "acc-1", name: "Käyttötili" }]);
    // every row of the fixture is on the joint account, so its figure is the consumption and debt of the period
    expect(c!.verdict.figure.cents).toBe(joint.cashflow.totals.consumptionCents + joint.cashflow.totals.debtCents);
  });

  it("each comparison has a figure or says why it has none, and the verdict shows one of them", () => {
    for (const q of QUESTIONS) {
      const c = joint.conclusions[q];
      if (c === null) continue;
      for (const kind of COMPARE_KINDS) expect(c.compare[kind] !== null || typeof c.gaps[kind] === "string", `${q} ${kind}`).toBe(true);
      if (c.verdict.comparison) expect(c.compare[c.verdict.comparison.kind], q).toBe(c.verdict.comparison);
    }
  });

  it("this month is the running month whatever period the page is set to", () => {
    // the range ends on 30 September, the last whole month, and today is 9 October
    expect(r.conclusions.kuukausi!.explanation).toContain("kuun 9. päivään");
    const other = buildReports({ ctx: createContext(dataset(), [checking], today), range: { from: "2026-03-01", to: "2026-04-30" }, balances });
    expect(other.conclusions.kuukausi!.verdict.figure.cents).toBe(r.conclusions.kuukausi!.verdict.figure.cents);
  });

  it("the budget is never compared before one is set", () => {
    for (const q of QUESTIONS) expect(joint.conclusions[q]?.compare.budget ?? null, q).toBeNull();
  });

  it("with no history the pages that remain still add up", () => {
    const empty = buildReports({ ctx: createContext([], [checking], today), range, balances: [] });
    for (const q of QUESTIONS) {
      const c = empty.conclusions[q];
      if (c !== null) expect(c.basis.rows.reduce((sum, row) => sum + row.cents, 0), q).toBe(c.verdict.figure.cents);
    }
  });
});
