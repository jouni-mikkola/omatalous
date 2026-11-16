/** Raportit > Vuosivertailu: the card holds the answer and the figures, and none of the explaining lines. */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { section } from "../src/pages/reports/sections/YearOverYear.tsx";
import { reportContext } from "../src/pages/reports/context.ts";
import type { Meta, ReportsData, Scope } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

const plain = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ").trim();
const months = (n: number) => Array.from({ length: 12 }, (_, i) => (i < n ? 100_00 : null));

const yearOverYear = (comparable: boolean) => ({
  year: 2026,
  current: months(10),
  previous: months(10),
  comparableFromMonth: 1,
  comparedMonths: [6, 7, 8],
  comparableMonths: comparable ? 3 : 2,
  dataFrom: "2025-01",
  shortHistory: false,
  // an account left out of some month: the core still says so, the card does not print it
  leftOutAccounts: true,
  comparable,
  partialMonth: 10,
  categories: comparable
    ? [
        { category: "groceries", currentCents: 5_350_00, previousCents: 5_000_00, changeCents: 350_00 },
        { category: "rent", currentCents: 10_500_00, previousCents: 10_500_00, changeCents: 0 },
        { category: "consumer_credit", currentCents: 4_200_00, previousCents: 0, changeCents: 4_200_00 },
      ]
    : [],
  ytdCents: 28_839_00,
  ytdChangeCents: 2_188_00,
  previousYtdCents: 26_651_00,
  ytdChange: 0.08,
  incomeYtdCents: 0,
  previousIncomeYtdCents: 0,
});

function draw(comparable: boolean) {
  const data = {
    yearOverYear: yearOverYear(comparable),
    categories: { groups: [{ categories: [{ category: "rent", fixedShare: 1 }, { category: "consumer_credit", fixedShare: 1 }, { category: "groceries", fixedShare: 0 }] }] },
  } as unknown as ReportsData;
  const meta = { today: "2026-11-11", categories: [{ id: "groceries", label: "Ruokakauppa" }, { id: "rent", label: "Vuokra" }, { id: "consumer_credit", label: "Kulutusluotot" }, { id: "card_bill", label: "Luottokortin lasku" }] } as unknown as Meta;
  const ctx = reportContext(data, meta, { from: "2026-01-01", to: "2026-11-11" }, "own" as Scope);
  return { ctx, ...render(createElement(section.Component, { ctx })) };
}

describe("Vuosivertailu", () => {
  it("has no line that says what the chart leaves out or which accounts the months hold", () => {
    const { container } = draw(true);
    const text = plain(container.textContent);
    expect(text).toContain("Menoja on");
    expect(text).not.toContain("Kiinteät menot eivät ole kuvassa");
    expect(text).not.toContain("Vertailussa on");
    expect(text).not.toContain("Mukana eivät ole tilit");
    expect(container.querySelector(".slope-off")).toBeNull();
  });

  it("still says why there is no comparison when too few months are compared", () => {
    const { container } = draw(false);
    expect(plain(container.textContent)).toContain("Vertailuun ei ole tarpeeksi kuukausia");
  });

  it("names a card bill as Kategoriat does", () => {
    const { ctx } = draw(true);
    expect(ctx.label("card_bill")).toBe("Korttilaskut ilman erittelyä");
    expect(ctx.label("groceries")).toBe("Ruokakauppa");
  });
});
