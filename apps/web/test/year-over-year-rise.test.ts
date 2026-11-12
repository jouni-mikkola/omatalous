import { describe, expect, it } from "vitest";
import { datumOf, fixedLeftOut, largestRise } from "../src/pages/reports/sections/YearOverYear.tsx";
import { t } from "../src/text.ts";

// a loan that began this year is a fixed cost: the slope leaves it out, the table and the total have it
const rows = [
  { category: "groceries", changeCents: 350_00 },
  { category: "consumer_credit", changeCents: 4_200_00 },
  { category: "clothing", changeCents: -900_00 },
  { category: "fees", changeCents: 7_00 },
];

describe("the largest rise the year comparison names", () => {
  it("is the largest rise of the table, a fixed cost too", () => {
    expect(largestRise(rows)?.category).toBe("consumer_credit");
  });
  it("is none when nothing rose by 100 € or more", () => {
    expect(largestRise(rows.filter((r) => r.changeCents < 100_00))).toBeUndefined();
  });
});

describe("the figure beside the title of the year comparison", () => {
  const months = (n: number) => Array.from({ length: 12 }, (_, i) => (i < n ? 1 : null));
  it("names the months it sums when only some are compared, never the whole year", () => {
    const datum = datumOf({ year: 2026, current: months(11), comparedMonths: [4, 5, 6, 7], ytdCents: 12_345_00 }, false);
    expect(datum).toContain("huhti–heinäkuu 2026");
    expect(datum).not.toContain(t("period.year"));
  });
  it("says so far when every month of the year so far is compared, and the year for a whole past year", () => {
    expect(datumOf({ year: 2026, current: months(10), comparedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ytdCents: 100_00 }, false)).toContain("2026 tähän asti");
    expect(datumOf({ year: 2025, current: months(12), comparedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ytdCents: 100_00 }, true)).toMatch(/, 2025$/);
  });
});

describe("the note under the slope of the year comparison", () => {
  const label = (c: string) => ({ rent: "Vuokra ja vastike", consumer_credit: "Kulutusluotot", groceries: "Ruokakauppa", insurance: "Vakuutukset", phone: "Puhelin ja netti" })[c] ?? c;
  const categories = [
    { category: "groceries", previousCents: 5_000_00, currentCents: 5_350_00, changeCents: 350_00 },
    { category: "consumer_credit", previousCents: 0, currentCents: 4_200_00, changeCents: 4_200_00 },
    { category: "rent", previousCents: 10_500_00, currentCents: 10_500_00, changeCents: 0 },
    { category: "phone", previousCents: 400_00, currentCents: 250_00, changeCents: -150_00 },
    { category: "insurance", previousCents: 0, currentCents: 0, changeCents: 0 },
  ];
  it("says the fixed costs are left out and names those that moved most with their change", () => {
    // money is written with no-break spaces
    expect(fixedLeftOut(categories, new Set(["rent", "consumer_credit", "phone", "insurance"]), label)?.replace(/[\u00a0\u202f]/g, " ")).toBe(
      "Kiinteät menot eivät ole kuvassa. Suurimmat muutokset niistä: Kulutusluotot +4 200 €, Puhelin ja netti −150 €. Kaikki luvut ovat taulukossa.",
    );
  });
  it("names one that moved in words that fit a singular label too", () => {
    const loan = [{ category: "mortgage", previousCents: 0, currentCents: 1_200_00, changeCents: 1_200_00 }];
    expect(fixedLeftOut(loan, new Set(["mortgage"]), () => "Asuntolaina")?.replace(/[\u00a0\u202f]/g, " ")).toBe(
      "Kiinteät menot eivät ole kuvassa. Suurin muutos niistä: Asuntolaina +1 200 €. Kaikki luvut ovat taulukossa.",
    );
  });
  it("only says they are left out when none moved by 100 €", () => {
    expect(fixedLeftOut(categories, new Set(["rent", "insurance"]), label)).toBe("Kiinteät menot eivät ole kuvassa. Niiden luvut ovat taulukossa.");
  });
  it("says nothing when no fixed cost has a figure", () => {
    expect(fixedLeftOut(categories, new Set(["insurance"]), label)).toBeNull();
  });
});
