import { type Account, buildDashboard, CATEGORIES, createContext, type Transaction } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncomeSpending } from "../src/components/overview/IncomeSpending.tsx";
import { incomeSpendingView } from "../src/components/overview/income-spending.ts";
import { periodsOf } from "../src/period.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-12";

let seq = 0;
/** A booked row of the checking account, in cents (negative is money out). */
const row = (bookingDate: string, amountCents: number, category: string, merchant = "Prisma"): Transaction => ({
  id: `r${++seq}`,
  accountId: "acc-1",
  currency: "EUR",
  status: "booked",
  counterparty: null,
  counterpartyIban: null,
  description: null,
  mcc: null,
  merchant,
  category,
  categorySource: "default",
  isTransfer: false,
  bookingDate,
  amountCents,
});
const salary = (date: string) => row(date, 300_000, "salary", "Esimerkki Oy");
const buy = (date: string, cents: number, category = "groceries") => row(date, -cents, category);
/** The page's text as a reader sees it: plain spaces, plain minus. */
const plain = (s: string | null | undefined) => (s ?? "").replace(/\s/g, " ").replace(/−/g, "-");

/** August to the 12th of October: pay each month, 120 € bought in September by the 12th and 80 € after it, 145 € in October. */
const history = [
  buy("2026-08-02", 3_000),
  salary("2026-08-25"),
  buy("2026-09-03", 12_000),
  buy("2026-09-20", 8_000),
  row("2026-09-26", -30_000, "savings", "Oma säästö"),
  salary("2026-09-25"),
  buy("2026-10-02", 10_000),
  buy("2026-10-09", 4_500),
];
const answer = (rows: Transaction[], from: string, to: string) => ({ ...buildDashboard(createContext(rows, [checking], today), { from, to }), settlement: [] });
const view = (rows: Transaction[], from: string, to: string) => incomeSpendingView(answer(rows, from, to));
/** The rows of the months' table as they read: the label, the month's sum, the sum of the month before. */
const figures = (v: ReturnType<typeof view>) => v.figures.map((f) => [f.label, plain(f.text), f.previous === null ? null : plain(f.previous)]);

describe("Tulot ja menot: the two months", () => {
  it("a running month stands beside the month before counted to the same day, and the head says the day", () => {
    const v = view(history, "2026-10-01", today);
    expect([v.month, v.previous]).toEqual(["Lokakuu", { month: "Syyskuu", by: "12.9. mennessä" }]);
    // September to the 12th: the 120 € of the 3rd, and the salary of the 25th is not in yet
    expect(figures(v)).toEqual([
      ["Tulot", "0,00 €", "0,00 €"],
      ["Menot", "145,00 €", "120,00 €"],
    ]);
  });

  it("an ended month stands beside the whole month before, and the head names the month alone", () => {
    const v = view(history, "2026-09-01", "2026-09-30");
    expect([v.month, v.previous]).toEqual(["Syyskuu", { month: "Elokuu", by: null }]);
    expect(figures(v)).toEqual([
      ["Tulot", "3 000,00 €", "3 000,00 €"],
      ["Menot", "200,00 €", "30,00 €"],
    ]);
    expect(v.chart).toBe(false);
  });

  it("a history that does not reach the month before has no second column and no change on a row", () => {
    const v = view(history.filter((t) => t.bookingDate >= "2026-09-03"), "2026-09-01", "2026-09-30");
    expect(v.previous).toBeNull();
    expect(v.figures.map((f) => f.previous)).toEqual([null, null]);
    expect(v.categories.every((c) => c.change === "")).toBe(true);
  });

  it("no history at all has one column of zeros", () => {
    const v = view([], "2026-10-01", today);
    expect(v.previous).toBeNull();
    expect(figures(v)).toEqual([
      ["Tulot", "0,00 €", null],
      ["Menot", "0,00 €", null],
    ]);
  });
});

describe("Tulot ja menot: a month with little or nothing in it", () => {
  it("a running month with no row gives zeros, no chart, and the table of categories says so in its one row", () => {
    const v = view([buy("2026-08-10", 3_000)], "2026-10-01", today);
    expect(figures(v).map((f) => f[1])).toEqual(["0,00 €", "0,00 €"]);
    expect(v.empty).toBe("Ei vielä tapahtumia tässä kuussa.");
    expect(v.chart).toBe(false);
    expect(v.categories).toEqual([]);
  });

  it("a month that has ended with no row says so without the word vielä", () => {
    expect(view([buy("2026-08-10", 3_000)], "2026-09-01", "2026-09-30").empty).toBe("Ei tapahtumia tässä kuussa.");
  });

  it("pay in and nothing spent: the figures, no chart, and the table says nothing is spent", () => {
    const v = view([buy("2026-08-10", 3_000), salary("2026-10-05")], "2026-10-01", today);
    expect(figures(v).map((f) => f[1])).toEqual(["3 000,00 €", "0,00 €"]);
    expect(v.empty).toBe("Ei vielä menoja tässä kuussa.");
    expect(v.chart).toBe(false);
    expect(v.categories).toEqual([]);
    expect(view([buy("2026-07-10", 3_000), salary("2026-09-05")], "2026-09-01", "2026-09-30").empty).toBe("Ei menoja tässä kuussa.");
  });

  it("the chart is there for the running month once something is spent, and never for a month that has ended", () => {
    expect(view(history, "2026-10-01", today)).toMatchObject({ chart: true, empty: null });
    expect(view(history, "2026-09-01", "2026-09-30").chart).toBe(false);
  });
});

describe("Tulot ja menot: the categories", () => {
  const expense = CATEGORIES.filter((c) => c.kind === "expense").slice(0, 12);
  // twelve categories, the largest first; every one was bought in September too: the first for less, the second for the same
  const before = (i: number) => (i === 0 ? 500 : i === 1 ? 2_100 : (12 - i) * 100 + 900);
  const many = [...expense.map((c, i) => buy("2026-10-03", (12 - i) * 100 + 1_000, c.id)), ...expense.map((c, i) => buy("2026-09-03", before(i), c.id)), salary("2026-08-25")];

  it("shows the nine largest and the rest as one row that names how many it holds, each sum with its cents", () => {
    const data = answer(many, "2026-10-01", today);
    const v = incomeSpendingView(data);
    expect(v.categories).toHaveLength(10);
    expect(v.categories.at(-1)).toMatchObject({ key: "rest", label: "Muut (3)", category: null, change: "" });
    expect(v.categories.slice(0, 9).map((c) => c.category)).toEqual(data.categories.slice(0, 9).map((c) => c.category));
    expect(plain(v.categories[0]!.text)).toBe("22,00 €");
    // the rest is what the named rows leave of the month: 11 + 12 + 13 €
    expect(plain(v.categories.at(-1)!.text)).toBe("36,00 €");
    expect(data.categories.reduce((s, c) => s + c.cents, 0)).toBe(data.totals.expenseCents);
  });

  it("gives a row a bar by its sum against the longest row, the row of the rest included", () => {
    const v = view(many, "2026-10-01", today);
    // the rest (36 €) is longer than any named row: it is the measure, and no bar is over it
    expect(v.categories.at(-1)!.share).toBe(100);
    expect(v.categories[0]!.share).toBe(Math.round((2_200 / 3_600) * 10_000) / 100);
    expect(v.categories.every((c) => c.share > 0 && c.share <= 100)).toBe(true);
    const two = view([buy("2026-10-03", 4_000), buy("2026-10-04", 1_000, "restaurants")], "2026-10-01", today);
    expect(two.categories.map((c) => c.share)).toEqual([100, 25]);
  });

  it("keeps the rest as a row when it is below zero, with its minus and no bar, so the rows add up to Menot; a rest of nothing is no row", () => {
    const nine = expense.slice(0, 9).map((c, i) => buy("2026-10-03", (12 - i) * 100 + 1_000, c.id));
    // the tenth category is 2 € spent, the eleventh money in that the user put on it by hand
    const back = (cents: number): Transaction => ({ ...row("2026-10-05", cents, expense[10]!.id, "Esimerkkivaate Oy"), categorySource: "user" });
    const data = answer([...nine, buy("2026-10-04", 200, expense[9]!.id), back(5_000)], "2026-10-01", today);
    const v = incomeSpendingView(data);
    expect(v.categories.at(-1)).toMatchObject({ key: "rest", label: "Muut (2)", category: null, share: 0 });
    expect(plain(v.categories.at(-1)!.text)).toBe("-48,00 €");
    const named = data.categories.slice(0, 9).reduce((s, c) => s + c.cents, 0);
    expect(named - 4_800).toBe(data.totals.expenseCents);
    // 22 + 21 + ... + 14 € named, less the 48 € of the rest
    expect(plain(v.figures[1]!.text)).toBe("114,00 €");
    // the near miss: the two small categories cancel, and a row of 0,00 € is not drawn
    const even = incomeSpendingView(answer([...nine, buy("2026-10-04", 200, expense[9]!.id), back(200)], "2026-10-01", today));
    expect(even.categories.map((c) => c.key)).not.toContain("rest");
    expect(even.categories).toHaveLength(9);
  });

  it("a category below zero among the nine is a row with its minus and no bar", () => {
    const back: Transaction = { ...row("2026-10-05", 4_495, "shopping", "Esimerkkivaate Oy"), categorySource: "user" };
    const v = view([buy("2026-10-03", 41_250), back], "2026-10-01", today);
    expect(v.categories.map((c) => [c.category, plain(c.text), c.share])).toEqual([
      ["groceries", "412,50 €", 100],
      ["shopping", "-44,95 €", 0],
    ]);
    expect(plain(v.figures[1]!.text)).toBe("367,55 €");
  });

  it("tells the change from the month before in whole euros, and prints nothing for a change of nothing", () => {
    const v = view(many, "2026-10-01", today);
    expect(plain(v.categories[0]!.change)).toBe("+17 €");
    // bought for the same sum in both months
    expect(v.categories[1]!.change).toBe("");
    expect(plain(v.categories[2]!.change)).toBe("+1 €");
    expect(JSON.stringify(v)).not.toContain("±");
    // 99 cents more is no euro more
    const near = view([buy("2026-10-03", 2_099), buy("2026-09-03", 2_000), salary("2026-08-25")], "2026-10-01", today);
    expect(near.categories[0]!.change).toBe("");
  });
});

describe("Tulot ja menot: the savings rate and the fixed costs", () => {
  it("the running month tells the savings rate of the last complete month, named by its month", () => {
    const v = view(history, "2026-10-01", today);
    expect([v.savings!.label, plain(v.savings!.text)]).toEqual(["Säästöaste, syyskuu", "10 %"]);
  });

  it("a month that has ended tells its own", () => {
    const v = view(history, "2026-09-01", "2026-09-30");
    expect([v.savings!.label, plain(v.savings!.text)]).toEqual(["Säästöaste, syyskuu", "10 %"]);
  });

  it("a first month the history covers in part tells none, and a history with no income tells none", () => {
    expect(view(history.filter((t) => t.bookingDate >= "2026-09-10"), "2026-10-01", today).savings).toBeNull();
    expect(view([buy("2026-10-02", 1_000)], "2026-10-01", today).savings).toBeNull();
  });

  it("the fixed costs are left out when the household has none", () => {
    expect(view(history, "2026-10-01", today).fixed).toBeNull();
  });
});

describe("Tulot ja menot: the month's list or the table of themes", () => {
  const draw = (data: ReturnType<typeof answer>) =>
    renderToStaticMarkup(createElement(IncomeSpending, { data, scope: "own", period: "month", presets: periodsOf("overview", today), anchors: { income: "tulot", months: "kuukaudet", settlement: "yhteiset-menot" }, categories: new Map() }));
  const text = (html: string) => plain(html.replace(/<[^>]*>/g, " ")).replace(/ +/g, " ");
  // three complete months with one account that covers them: July, August and September
  const threeMonths = [buy("2026-07-02", 6_000), ...history];

  it("draws the month's list when core has no themes: under three complete months", () => {
    const data = answer(history, "2026-10-01", today);
    expect(data.themes).toBeNull();
    const html = draw(data);
    expect(html).toContain('class="st-table category-table"');
    expect(text(html)).toMatch(/Kategoria .*Lokakuu Muutos/);
    expect(html).not.toContain("Kuukaudessa");
    expect(html).not.toContain("themes-table");
    expect(text(html)).toContain("Kauppiaat Menot kuukausittain");
  });

  it("draws the table of themes in the list's place when core has them, whichever month is chosen, and keeps the rest of the block", () => {
    const tables: string[] = [];
    for (const [from, to] of [["2026-10-01", today], ["2026-09-01", "2026-09-30"]] as const) {
      const data = answer(threeMonths, from, to);
      expect(data.themes).not.toBeNull();
      const html = draw(data);
      expect(html).toContain("themes-table");
      expect(html).not.toContain("category-table");
      expect(text(html)).toMatch(/Menot kategorioittain 7\/2026–9\/2026 .*Kuukaudessa/);
      expect(text(html)).not.toContain("Kategoria ");
      tables.push(/<table class="st-table themes-table[^"]*".*?<\/table>/.exec(html)![0]);
      // the months' figures, the chart's place and the links stay
      expect(html).toContain("month-table");
      expect(text(html)).toContain("Kauppiaat Menot kuukausittain");
    }
    // the table does not follow the month: the same in both
    expect(tables[0]).toBe(tables[1]);
  });
});
