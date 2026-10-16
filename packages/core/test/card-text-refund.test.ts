/**
 * A foreign merchant on a card is one payee whatever the card text puts around it (currency, country, city), and its
 * refund is a refund, not income.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { fillEnvelopeMerchants } from "../src/card-envelope.ts";
import { isCardEnvelopeOnly, normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { matchReturns } from "../src/returns.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Korttitili", iban: null, currency: "EUR", type: "checking" };

describe("one merchant is one payee", () => {
  it.each([
    ["USD IRL DUBLIN ANTHROPIC", "Anthropic"],
    ["SAN FRANCISCO ANTHROPIC PRO", "Anthropic"],
    ["ANTHROPIC", "Anthropic"],
    ["SAN FRANCISCO OPENAI PLUS", "OpenAI"],
    ["SAN FRANCISCO GITHUB PRO", "GitHub"],
    ["USD USA SAN FRANCISCO NOTION", "Notion"],
    ["SAN FRANCISCO FIGMA PRO", "Figma"],
    ["SAN FRANCISCO CANVA PRO", "Canva"],
    ["SAN FRANCISCO DROPBOX PLUS", "Dropbox"],
    ["SAN FRANCISCO MIDJOURNEY PRO", "Midjourney"],
    ["SEATTLE AUDIBLE PLUS", "Audible"],
    ["SAN FRANCISCO PATREON PRO", "Patreon"],
    ["LONDON DISNEY PLUS", "Disney+"],
    ["NEW YORK NETFLIX PRO", "Netflix"],
    ["USD HYVITYS IRL DUBLIN ANTHROPIC", "Anthropic"],
    ["USD IRL DUBLIN EXAMPLECO", "Exampleco"],
    ["EUR NLD AMSTERDAM EXAMPLECO", "Exampleco"],
    ["USD USA NEW YORK EXAMPLECO", "Exampleco"],
    ["USD MOUNTAIN VIEW EXAMPLECO", "Exampleco"],
    ["EXAMPLECO", "Exampleco"],
    ["EXAMPLECO SEATTLE USA", "Exampleco"],
    ["EXAMPLECO OSLO NOR", "Exampleco"],
  ])("%s is %s", (text, name) => {
    expect(normalizeMerchant(null, text)).toBe(name);
  });

  it("keeps a merchant whose own name is a city word or holds a country code", () => {
    expect(normalizeMerchant(null, "DUBLIN BAKERY")).toBe("Dublin Bakery");
    expect(normalizeMerchant(null, "LONDON ROAD COFFEE")).toBe("London Road Coffee");
    expect(normalizeMerchant(null, "SAN FRANCISCO EXAMPLECO PRO")).toBe("San Francisco Exampleco Pro");
    expect(normalizeMerchant(null, "USDA FARMS")).toBe("Usda Farms");
    expect(normalizeMerchant(null, "IRLANDA CAFE")).toBe("Irlanda Cafe");
    expect(normalizeMerchant(null, "NO FRILLS CAFE")).toBe("No Frills Cafe");
    expect(normalizeMerchant(null, "DUBLIN")).toBe("Dublin");
  });

  it("tells a text of only currency, country and city", () => {
    expect(isCardEnvelopeOnly(null, "USD USA SAN FRANCISCO")).toBe(true);
    expect(isCardEnvelopeOnly(null, "USD HYVITYS IRL DUBLIN")).toBe(true);
    expect(isCardEnvelopeOnly(null, "USD USA SAN FRANCISCO EXAMPLECO")).toBe(false);
    expect(isCardEnvelopeOnly(null, "DUBLIN")).toBe(false);
    expect(isCardEnvelopeOnly(null, null)).toBe(false);
  });
});

describe("a row of only currency, country and city", () => {
  const row = (id: string, bookingDate: string, euros: number, description: string, extra: Partial<Transaction> = {}) =>
    tx({ id, bookingDate, amountCents: Math.round(euros * 100), description, merchant: normalizeMerchant(null, description), ...extra });

  it("takes the merchant of the same card's row of the same day and sum", () => {
    const rows = [row("buy", "2026-10-05", -20, "USD IRL DUBLIN EXAMPLECO"), row("fee", "2026-10-05", -20, "USD USA SAN FRANCISCO")];
    expect(fillEnvelopeMerchants(rows)).toEqual(new Map([["fee", "Exampleco"]]));
  });

  it("stays as it is with another sum, another day or another card", () => {
    const buy = row("buy", "2026-10-05", -20, "USD IRL DUBLIN EXAMPLECO");
    expect(fillEnvelopeMerchants([buy, row("a", "2026-10-05", -0.6, "USD USA SAN FRANCISCO")]).size).toBe(0);
    expect(fillEnvelopeMerchants([buy, row("b", "2026-10-06", -20, "USD USA SAN FRANCISCO")]).size).toBe(0);
    expect(fillEnvelopeMerchants([buy, row("c", "2026-10-05", -20, "USD USA SAN FRANCISCO", { accountId: "acc-2" })]).size).toBe(0);
  });

  it("a refund takes the merchant of the latest payment of that sum before it", () => {
    const rows = [
      row("old", "2026-05-01", -20, "EXAMPLECO"),
      row("buy", "2026-07-10", -20, "USD IRL DUBLIN EXAMPLECO"),
      row("back", "2026-10-12", 20, "USD HYVITYS IRL DUBLIN"),
    ];
    expect(fillEnvelopeMerchants(rows)).toEqual(new Map([["back", "Exampleco"]]));
    expect(fillEnvelopeMerchants([row("late", "2026-10-13", -20, "EXAMPLECO"), row("back", "2026-10-12", 20, "USD HYVITYS IRL DUBLIN")]).size).toBe(0);
  });
});

// Exampleco: no rule knows it, so its purchases are "other" and money back is plain income unless it is told a refund
const bought = (id: string, date: string, euros: number, extra: Partial<Transaction> = {}) =>
  tx({ id, bookingDate: date, amountCents: -Math.round(euros * 100), merchant: "Exampleco", counterparty: "EXAMPLECO", category: "other", categorySource: "default", ...extra });
const back = (id: string, date: string, euros: number, extra: Partial<Transaction> = {}) =>
  tx({ id, bookingDate: date, amountCents: Math.round(euros * 100), merchant: "Exampleco", counterparty: "EXAMPLECO", category: "income", categorySource: "default", ...extra });

describe("a refund no single purchase holds", () => {
  const word = { description: "USD HYVITYS IRL DUBLIN", category: "reimbursements", categorySource: "rule" } as const;

  it("by its word takes the latest earlier purchase, whatever its size, inside the window", () => {
    expect(matchReturns([bought("p", "2026-09-10", 20), back("r", "2026-10-12", 25, word)]).get("r")).toBe("p");
    expect(matchReturns([back("r", "2026-10-12", 25, word)]).size).toBe(0);
  });

  it("is income when the purchase is older than the window, the word or not", () => {
    expect(matchReturns([bought("p", "2026-01-10", 20), back("r", "2026-10-12", 25, word)]).size).toBe(0);
    expect(matchReturns([bought("p", "2026-01-10", 20), back("r", "2026-10-12", 15)]).size).toBe(0);
  });

  it("from a payee only paid to takes it with no word, up to what is left of the payments", () => {
    const paid = [bought("p1", "2026-09-10", 10), bought("p2", "2026-09-11", 10)];
    expect(matchReturns([...paid, back("r", "2026-10-12", 15)]).get("r")).toBe("p2");
    expect(matchReturns([...paid, back("r", "2026-10-12", 25)]).size).toBe(0);
    expect([...matchReturns([bought("p", "2026-09-10", 20), back("r1", "2026-10-12", 15), back("r2", "2026-10-20", 15)])]).toEqual([["r1", "p"]]);
  });

  it("is income from a payee that paid the household before, a salary included", () => {
    const paid = [bought("p1", "2026-09-10", 10), bought("p2", "2026-09-11", 10)];
    const salary = back("s", "2026-02-01", 3000, { description: "PALKKA", category: "salary", categorySource: "rule" });
    expect(matchReturns([...paid, salary, back("r", "2026-10-12", 15)]).size).toBe(0);
    expect(matchReturns([...paid, back("r", "2026-10-12", 15, { description: "PALKKA", category: "salary", categorySource: "rule" })]).size).toBe(0);
  });

  it("is income when it is more than was paid: a bank's bonus is no refund of its fee", () => {
    expect(matchReturns([bought("p", "2026-09-10", 3), back("r", "2026-10-12", 12)]).size).toBe(0);
  });

  it("is income when the user said so, or when nothing was paid before it", () => {
    expect(matchReturns([bought("p1", "2026-09-10", 10), bought("p2", "2026-09-11", 10), back("r", "2026-10-12", 15, { categorySource: "user" })]).size).toBe(0);
    expect(matchReturns([bought("p", "2026-11-10", 20), back("r", "2026-10-12", 15)]).size).toBe(0);
  });
});

describe("a refund lowers its merchant's category and Tulot", () => {
  const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
  function october(rows: readonly Transaction[]) {
    const byId = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    const ctx = createContext(rows.map((t) => byId.get(t.id) ?? t), [checking], "2026-11-10");
    const d = buildDashboard(ctx, OCTOBER);
    return { spent: d.totals.expenseCents, income: d.totals.incomeCents, rows: Object.fromEntries(d.categories.map((c) => [c.category, c.cents])) };
  }
  const salary = () => tx({ bookingDate: "2026-10-01", amountCents: 300000, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", category: "salary", categorySource: "rule" });
  const shop = (date: string, euros: number, text: string) => ({ bookingDate: date, amountCents: Math.round(euros * 100), merchant: normalizeMerchant(null, text), description: text });

  it("takes the refund out of the category in the month it lands, not into Tulot", () => {
    const rows = [
      tx(shop("2026-09-20", -10, "USD IRL DUBLIN EXAMPLECO")),
      tx(shop("2026-10-05", -10, "EXAMPLECO")),
      tx({ ...shop("2026-10-12", 25, "USD HYVITYS IRL DUBLIN EXAMPLECO"), category: "income" }),
      salary(),
    ];
    const month = october(rows);
    expect(month.income).toBe(300000);
    expect(month.rows.other).toBe(-1500);
  });

  it("does the same for money from a payee only paid to, with no word", () => {
    const rows = [tx(shop("2026-09-20", -10, "EXAMPLECO")), tx(shop("2026-10-05", -10, "EXAMPLECO")), tx({ ...shop("2026-10-12", 15, "EXAMPLECO"), category: "income" }), salary()];
    const month = october(rows);
    expect(month.income).toBe(300000);
    expect(month.rows.other).toBe(-500);
  });

  it("keeps money from a payee that also pays the household as income", () => {
    const rows = [
      tx(shop("2026-09-20", -10, "EXAMPLECO")),
      tx(shop("2026-10-05", -10, "EXAMPLECO")),
      tx({ ...shop("2026-09-25", 3000, "EXAMPLECO"), description: "PALKKA", category: "salary", categorySource: "rule" }),
      tx({ ...shop("2026-10-12", 15, "EXAMPLECO"), category: "income" }),
      salary(),
    ];
    expect(october(rows).income).toBe(300000 + 1500);
  });
});
