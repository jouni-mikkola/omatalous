/**
 * The sentence under Tulojen käyttö names every term Tulos is made of: each term is its exact sum in whole euros, and
 * the terms with the sign the words give them add up to the Tulos it prints within the rounding, on the demo and seeded households and on made-up totals for the
 * cases a household may not reach (credit paid back, savings drawn on).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addMonths, buildReports, monthEnd, monthOf, type PeriodTotals, printedEuros } from "@banking/core";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { useAnswer, useTerms } from "../src/pages/reports/sections/Cashflow.tsx";

const totals = (over: Partial<PeriodTotals>) => ({ incomeCents: 0, borrowedCents: 0, consumptionCents: 0, debtCents: 0, savedCents: 0, leftCents: 0, ...over });

/** The sentence as plain text, every kind of space a figure uses as a plain one. */
const textOf = (t: ReturnType<typeof totals>) => renderToStaticMarkup(createElement("p", null, useAnswer(t))).replace(/<[^>]+>/g, "").replace(/[\u00a0\u202f]/g, " ");

/** Every amount a sentence prints, in whole euros and with its sign: "Tulos −1 000 €." → [-1000]. */
const amounts = (sentence: string) => [...sentence.matchAll(/(−?)(\d[\d ]*) €/g)].map((m) => (m[1] ? -1 : 1) * Number(m[2]!.replace(/ /g, "")));

/** What each sentence adds to Tulos, by its words: what came in is plus, what went out is minus, a refund or a return the other way. */
const ADDS: [RegExp, 1 | -1][] = [
  [/^Tuloja oli/, 1],
  [/^Tuloja peruttiin/, -1],
  [/^Nostit luottoa/, 1],
  [/^Maksoit luottoa takaisin/, -1],
  [/^Kulutukseen meni/, -1],
  [/^Kulutuksesta palautui/, 1],
  [/^Velanhoitoon meni/, -1],
  [/^Velanhoidosta palautui/, 1],
  [/^Säästöön meni/, -1],
  [/^Otit säästöistä/, 1],
];

/** Tulos as the words add it up, and the Tulos they print: from the sentences alone. */
export function sumOfText(text: string): { sum: number; left: number } {
  let sum = 0;
  let left = 0;
  for (const s of text.split(/(?<=\.) /)) {
    const [first = 0] = amounts(s);
    if (s.startsWith("Tulos")) left = first;
    else {
      const sign = ADDS.find(([re]) => re.test(s))?.[1];
      if (!sign) throw new Error(`a sentence the test does not know: ${s}`);
      sum += sign * first;
    }
  }
  return { sum, left };
}

describe("the terms of the sentence", () => {
  it("name the credit drawn, which Tulos holds and the spending does not", () => {
    const t = totals({ incomeCents: 300_000, borrowedCents: 500_000, consumptionCents: 250_000, debtCents: 50_000, savedCents: 20_000, leftCents: 480_000 });
    expect(textOf(t)).toBe("Tuloja oli 3 000 €. Nostit luottoa 5 000 €. Kulutukseen meni 2 500 €. Velanhoitoon meni 500 €. Säästöön meni 200 €. Tulos 4 800 €.");
  });

  it.each([
    ["credit paid back", totals({ incomeCents: 300_000, borrowedCents: -100_000, consumptionCents: 150_000, debtCents: 30_000, savedCents: 10_000, leftCents: 10_000 })],
    ["savings drawn on", totals({ incomeCents: 100_000, consumptionCents: 150_000, debtCents: 20_000, savedCents: -80_000, leftCents: 10_000 })],
    ["no credit", totals({ incomeCents: 300_000, consumptionCents: 150_000, debtCents: 30_000, savedCents: 20_000, leftCents: 100_000 })],
    ["refunds larger than the purchases", totals({ incomeCents: 300_000, consumptionCents: -50_000, leftCents: 350_000 })],
    ["debt service paid back", totals({ incomeCents: 300_000, consumptionCents: 100_000, debtCents: -20_000, leftCents: 220_000 })],
    ["a negative Tulos", totals({ incomeCents: 100_000, consumptionCents: 250_000, debtCents: 30_000, savedCents: 10_000, leftCents: -190_000 })],
  ])("add up to Tulos in the words: %s", (_, t) => {
    const { sum, left } = sumOfText(textOf(t));
    expect(sum).toBe(left);
  });

  it("print each term as its own exact sum rounded, never moved to make the others add up (the one euro rule)", () => {
    const t = totals({ incomeCents: 100_050, borrowedCents: 10_050, consumptionCents: 40_050, debtCents: 20_050, savedCents: 30_050, leftCents: 19_950 });
    for (const term of Object.values(useTerms(t))) expect(term.printed).toBe(printedEuros(term.cents));
    // 100,50 rounds to 101 and 400,50 to 401 whatever the others do: the sentence reads as the table in cents beside it rounds
    expect(textOf(t)).toContain("Kulutukseen meni 401 €");
  });

  it("are each a term of Tulos to the cent", () => {
    const t = totals({ incomeCents: 123_456, borrowedCents: 7_890, consumptionCents: 45_678, debtCents: 1_234, savedCents: 5_678, leftCents: 78_756 });
    expect(Object.values(useTerms(t)).reduce((s, x) => s + x.cents, 0)).toBe(t.leftCents);
  });
});

const households: Household[] = [demoHousehold(), seededHousehold(3, true), seededHousehold(4, false)];

describe.each(households.map((h) => [h.name, h] as const))("%s", (_, h) => {
  const ctx = contextOf(h);
  const month = monthOf(h.today);
  const ranges = {
    "twelve months": { from: `${addMonths(month, -12)}-01`, to: monthEnd(addMonths(month, -1)) },
    "with the running month": { from: `${addMonths(month, -5)}-01`, to: h.today },
    "three months": { from: `${addMonths(month, -3)}-01`, to: monthEnd(addMonths(month, -1)) },
  };

  it.each(Object.entries(ranges))("tells terms that add up to the rows' Tulos, %s", (_range, range) => {
    const r = buildReports({ ctx, range, balances: h.balances, inputs: h.inputs }, ["cashflow"]).cashflow;
    const t = r.whole;
    // the terms, as cents, against the rows of the months the sentence is of: error under a euro
    const terms = Object.values(useTerms(t)).reduce((s, x) => s + x.cents, 0);
    const rows = r.rows.reduce((s, x) => s + x.leftCents, 0);
    expect(Math.abs(terms - rows)).toBeLessThan(100);
    // and the words
    for (const term of Object.values(useTerms(t))) expect(term.printed).toBe(printedEuros(term.cents));
    // each of the five terms is off by half a euro at most, so the words add up to Tulos within two euros
    const { sum, left } = sumOfText(textOf(t));
    expect(Math.abs(sum - left)).toBeLessThanOrEqual(2);
    expect(Math.abs(left * 100 - rows)).toBeLessThanOrEqual(50);
  });
});
