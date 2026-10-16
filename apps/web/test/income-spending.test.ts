import { type Account, buildDashboard, createContext, type Transaction } from "@banking/core";
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
const ANCHORS = { food: "ruoka", months: "kuukaudet", settlement: "yhteiset-menot" };
const answer = (rows: Transaction[], from: string, to: string) => ({ ...buildDashboard(createContext(rows, [checking], today), { from, to }), settlement: [] });
const view = (rows: Transaction[], from: string, to: string) => incomeSpendingView(answer(rows, from, to));

describe("Tulot ja menot: a month with little or nothing in it", () => {
  it("a running month with no row has no chart and no links to the merchants", () => {
    expect(view([buy("2026-08-10", 3_000)], "2026-10-01", today)).toMatchObject({ chart: false, spending: false });
  });

  it("pay in and nothing spent: no chart and no spending", () => {
    expect(view([buy("2026-08-10", 3_000), salary("2026-10-05")], "2026-10-01", today)).toMatchObject({ chart: false, spending: false });
  });

  it("the chart is there for the running month once something is spent, and never for a month that has ended", () => {
    expect(view(history, "2026-10-01", today)).toMatchObject({ chart: true, spending: true });
    expect(view(history, "2026-09-01", "2026-09-30")).toMatchObject({ chart: false, spending: true });
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

describe("Tulot ja menot: what the block draws under the waterfall", () => {
  const draw = (data: ReturnType<typeof answer>) =>
    renderToStaticMarkup(createElement(IncomeSpending, { data, scope: "own", period: "month", presets: periodsOf("overview", today), anchors: ANCHORS, categories: new Map() }));
  const text = (html: string) => plain(html.replace(/<[^>]*>/g, " ")).replace(/ +/g, " ");
  // three complete months with one account that covers them: July, August and September
  const threeMonths = [buy("2026-07-02", 6_000), ...history];

  it("has no table of Tulot and Menot and no list of the month's categories: the waterfall tells both", () => {
    const html = draw(answer(history, "2026-10-01", today));
    for (const gone of ["month-table", "category-table", "Kategoria", "categories-h"]) expect(html).not.toContain(gone);
    expect(text(html)).not.toContain("Menot kategorioittain");
  });

  it("puts the savings rate under Yli jäi and the chart and the links after it", () => {
    const html = draw(answer(history, "2026-10-01", today));
    const order = ["Yli jäi", "Säästöaste, syyskuu", "Menojen kertymä", "Kauppiaat", "Menot kuukausittain"].map((s) => text(html).indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("draws no table of themes whichever month is chosen, also when core has them", () => {
    for (const [from, to] of [["2026-10-01", today], ["2026-09-01", "2026-09-30"]] as const) {
      const data = answer(threeMonths, from, to);
      expect(data.themes).not.toBeNull();
      const html = draw(data);
      expect(html).not.toContain("themes-table");
      expect(text(html)).not.toContain("Menot kategorioittain");
      expect(text(html)).toContain("Kauppiaat Menot kuukausittain");
    }
  });

  it("keeps the three links under the chart: Kauppiaat, Menot kuukausittain and the existing one to Ruoka on Raportit", () => {
    const html = draw(answer(history, "2026-10-01", today));
    expect(text(html)).toContain("Kauppiaat Menot kuukausittain Ruoka");
    expect(html).toContain('<a href="#/reports#ruoka">Ruoka</a>');
  });

  it("keeps the large purchases under the chart as one row that opens to each purchase, with the label and the sum core gives", () => {
    const data = answer(threeMonths, "2026-10-01", today);
    const large = { cents: 245_000, count: 2, rows: [{ id: "a", date: "2026-08-10", payee: "ESIMERKKI AUTOLIIKE", cents: 200_000 }, { id: "b", date: "2026-09-02", payee: "ESIMERKKI KONE", cents: 45_000 }] };
    const withLarge = { ...data, themes: { ...data.themes!, large } };
    const v = incomeSpendingView(withLarge);
    expect(v.large!.label).toBe("Suuret hankinnat (2)");
    expect(plain(v.large!.sum)).toBe("2 450,00 €");
    expect(v.large!.rows.map((r) => [r.key, r.payee])).toEqual([["a", "ESIMERKKI AUTOLIIKE"], ["b", "ESIMERKKI KONE"]]);
    const html = draw(withLarge);
    expect(text(html)).toContain("Suuret hankinnat (2) 2 450,00 €");
    expect(html).toMatch(/<button type="button" class="themes-toggle" aria-expanded="false"><span class="themes-label">Suuret hankinnat \(2\)/);
    // closed at first: the rows are not drawn
    expect(text(html)).not.toContain("ESIMERKKI AUTOLIIKE");
    // near miss: no large purchases, no row; no themes at all, no row
    expect(incomeSpendingView({ ...data, themes: { ...data.themes!, large: { cents: 0, count: 0, rows: [] } } }).large).toBeNull();
    expect(incomeSpendingView({ ...data, themes: null }).large).toBeNull();
  });
});

const card: Account = { id: "card-1", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" };
/** The same household with a card linked this month: `cents` spent on it in all. */
const withCard = (cents: number) => {
  const rows = [...history, ...[2, 3].map((d) => ({ ...buy(`2026-10-0${d}`, cents / 2), accountId: "card-1" }))];
  return { ...buildDashboard(createContext(rows, [checking, card], today), { from: "2026-10-01", to: today }), settlement: [] };
};
const drawBlock = (data: ReturnType<typeof answer>) => renderToStaticMarkup(createElement(IncomeSpending, { data, scope: "own", period: "month", presets: periodsOf("overview", today), anchors: ANCHORS, categories: new Map() }));

describe("Tulot ja menot: the month before in the open rows", () => {
  it("tells it when the months compare: the month's name, Tulot from previousTotals and a category from previousCents", () => {
    const data = answer(history, "2026-10-01", today);
    expect(data.comparable).toBe(true);
    const { before, note } = incomeSpendingView(data);
    expect(before!.name).toBe("Syyskuu");
    expect(before!.incomeCents).toBe(data.previousTotals.incomeCents);
    // groceries of 1-12 September: the 120 € of the 3rd
    expect(before!.categories.get("groceries")).toBe(12_000);
    expect(note).toBeNull();
  });

  it("names the month before for an ended month too", () => {
    const { before } = view(history, "2026-09-01", "2026-09-30");
    expect(before!.name).toBe("Elokuu");
    expect(before!.categories.get("groceries")).toBe(3_000);
  });

  it("says once, under the waterfall, that an account is left out, and still tells the month before on the accounts both have", () => {
    const data = withCard(1_000);
    expect(data.comparable).toBe(true);
    const v = incomeSpendingView(data);
    expect(v.note).toBe("Vertailu on laskettu vain samoista tileistä molemmilta jaksoilta.");
    expect(v.before).not.toBeNull();
    const html = drawBlock(data);
    expect(html.match(/samoista tileistä/g)).toHaveLength(1);
    expect(html.indexOf("samoista tileistä")).toBeGreaterThan(html.indexOf("wf-rows"));
    // near miss: no account left out, no sentence
    expect(drawBlock(answer(history, "2026-10-01", today))).not.toContain("samoista tileistä");
  });

  it("tells no month before when the accounts left out carry over a tenth of the spending", () => {
    const data = withCard(100_000);
    expect(data.comparable).toBe(false);
    const v = incomeSpendingView(data);
    expect(v.before).toBeNull();
    // the sentence still names that accounts were left out
    expect(v.note).not.toBeNull();
  });
});
