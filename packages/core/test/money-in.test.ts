/**
 * Money in on a spending category (`moneyIn`): it lowers spending only as a refund of what its payer was paid in the
 * 120 days before it, or in the category the user put it in by hand. Anything else is income, so no month's spending
 * falls because money came in, and the categories of a month always add up to its spending.
 */
import { describe, expect, it } from "vitest";
import { goldenHouseholds } from "../../../tools/findings/golden.ts";
import type { Household } from "../../../tools/findings/households.ts";
import { applyUse } from "../src/account-use.ts";
import { type AnalysisContext, createContext, inDays } from "../src/analysis/context.ts";
import { categoryTotals } from "../src/analysis/category-totals.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { incomeTypes } from "../src/analysis/income.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { addMonths, daysInMonth, monthOf } from "../src/dates.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { REFUND_WINDOW_DAYS } from "../src/returns.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "acc-2", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const TODAY = "2026-11-10";
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
const HALF: Part = { from: 0, to: 1, of: 2 };

const SHOP = "Esimerkkikauppa Oy";
const CLOTHES = "Esimerkkivaate Oy";
const INSURER = "Esimerkkivakuutus Oy";
const MATTI = "Matti Meikalainen";
const MAIJA = "Maija Meikalainen";

const cents = (euros: number) => Math.round(euros * 100);
const paid = (bookingDate: string, euros: number, merchant: string, category: string, extra: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: -cents(euros), merchant, category, categorySource: "rule", ...extra });
const got = (bookingDate: string, euros: number, merchant: string, category: string, extra: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: cents(euros), merchant, category, categorySource: "rule", ...extra });
const salary = (bookingDate: string) => got(bookingDate, 3000, "ESIMERKKI OY", "salary");

const contextOf = (rows: readonly Transaction[], accounts: readonly Account[] = [checking]) => createContext(rows, accounts, TODAY);
/** The month as the first page tells it: "Menot", "Tulot" and the rows of "Menot kategorioittain". */
function monthOn(ctx: AnalysisContext, range = OCTOBER) {
  const d = buildDashboard(ctx, range);
  return {
    spent: d.totals.expenseCents,
    income: d.totals.incomeCents,
    rows: Object.fromEntries(d.categories.map((c) => [c.category, c.cents])),
    listed: d.categories.reduce((sum, c) => sum + c.cents, 0),
    curve: d.pace.current.filter((v): v is number => v !== null),
  };
}
const typeOf = (ctx: AnalysisContext, t: Transaction) => incomeTypes(ctx.txs).get(t.id);
const wholeMonth = (month: string) => ({ from: `${month}-01`, to: `${month}-${daysInMonth(month)}` });

describe("the month of the owner's case, in made-up figures", () => {
  // October: 1 173,00 spent on three things, and an insurer's compensation of 744,00 that the categoriser put in Terveys
  const claim = got("2026-10-08", 744, INSURER, "health");
  // September: 403,00 spent, 50,00 of it sent to a person, and another person paid in 550,00
  const fromPerson = got("2026-09-08", 550, MAIJA, "p2p");
  const ctx = contextOf([
    salary("2026-09-05"),
    paid("2026-09-03", 353, SHOP, "groceries"),
    paid("2026-09-04", 50, MATTI, "p2p"),
    fromPerson,
    salary("2026-10-05"),
    paid("2026-10-02", 640, "Asunto Oy Esimerkki", "housing"),
    paid("2026-10-06", 412.5, SHOP, "groceries"),
    paid("2026-10-09", 120.5, "Esimerkkiasema Oy", "car"),
    claim,
  ]);

  it("Menot is 1 173,00 and the rows under it add up to it: the compensation is income, not spending below zero", () => {
    const october = monthOn(ctx);
    expect(october.spent).toBe(117_300);
    expect(october.listed).toBe(117_300);
    expect(october.rows).toEqual({ housing: 64_000, groceries: 41_250, car: 12_050 });
    expect(october.income).toBe(300_000 + 74_400);
    // the type the income report has for compensations and refunds
    expect(typeOf(ctx, claim)).toBe("refunds");
    expect(Math.min(...october.curve)).toBeGreaterThanOrEqual(0);
    expect(october.curve.at(-1)).toBe(117_300);
  });

  it("the month before is 403,00, not 147,00 below zero: money from a person is not set against Maksut henkilöille", () => {
    const september = monthOn(ctx, SEPTEMBER);
    expect(september.spent).toBe(40_300);
    expect(september.rows).toEqual({ groceries: 35_300, p2p: 5_000 });
    expect(september.income).toBe(300_000 + 55_000);
    expect(typeOf(ctx, fromPerson)).toBe("persons");
  });

  it("the reports say the same: Kategoriat, Menot kuukausittain and Tulot ja menot", () => {
    const r = buildReports({ ctx, range: OCTOBER, balances: [] });
    expect(r.categories.totalCents).toBe(117_300);
    expect(r.categories.groups.flatMap((g) => g.categories).some((c) => c.category === "health")).toBe(false);
    expect(r.pivot.totalCents).toBe(117_300);
    expect(r.cashflow.totals).toMatchObject({ expenseCents: 117_300, incomeCents: 374_400 });
  });

  it("neither is earned income: the usual income of the months is the salary alone", () => {
    expect(earnedIncome(ctx, "2026-09")).toBe(300_000);
  });
});

describe("a refund", () => {
  const groceries = paid("2026-10-20", 200, SHOP, "groceries");

  it("from a shop paid 40 days earlier lowers that shop's category in the month it arrives, as a row with its minus", () => {
    const bought = paid("2026-09-01", 89.9, CLOTHES, "shopping");
    const ctx = contextOf([bought, got("2026-10-11", 89.9, CLOTHES, "shopping"), groceries]);
    const october = monthOn(ctx);
    expect(october.rows).toEqual({ groceries: 20_000, shopping: -8_990 });
    expect(october.spent).toBe(20_000 - 8_990);
    expect(october.listed).toBe(october.spent);
    expect(october.income).toBe(0);
    expect(monthOn(ctx, SEPTEMBER).spent).toBe(8_990);
    // the purchase came back whole
    expect(ctx.txs.find((t) => t.id === bought.id)!.refunded).toBe(8_990);
  });

  it("comes within the 120 days the categoriser pairs a shop's refund in: on the 121st day the money is income", () => {
    expect(REFUND_WINDOW_DAYS).toBe(120);
    const after = (day: string) => {
      const back = got(day, 89.9, CLOTHES, "shopping");
      const ctx = contextOf([paid("2026-06-13", 89.9, CLOTHES, "shopping"), back, groceries]);
      return { spent: monthOn(ctx).spent, type: typeOf(ctx, back) };
    };
    expect(after("2026-10-11")).toEqual({ spent: 20_000 - 8_990, type: undefined });
    expect(after("2026-10-12")).toEqual({ spent: 20_000, type: "refunds" });
  });

  it("is not larger than what the payee was paid in those days: a cent more is income", () => {
    const of = (euros: number) => {
      const back = got("2026-10-11", euros, CLOTHES, "shopping");
      const ctx = contextOf([paid("2026-10-01", 50, CLOTHES, "shopping"), back, groceries]);
      return { spent: monthOn(ctx).spent, income: monthOn(ctx).income, type: typeOf(ctx, back) };
    };
    expect(of(50)).toEqual({ spent: 20_000, income: 0, type: undefined });
    expect(of(50.01)).toEqual({ spent: 25_000, income: 5_001, type: "refunds" });
  });

  it("is counted against what is left of the payments: the same 50,00 comes back once", () => {
    const [first, second] = [got("2026-10-11", 30, CLOTHES, "shopping"), got("2026-10-12", 30, CLOTHES, "shopping")];
    const ctx = contextOf([paid("2026-10-01", 50, CLOTHES, "shopping"), first, second]);
    expect(monthOn(ctx)).toMatchObject({ spent: 2_000, income: 3_000, rows: { shopping: 2_000 } });
    expect([typeOf(ctx, first), typeOf(ctx, second)]).toEqual([undefined, "refunds"]);
  });

  it("may take back several payments to the payee, and each of them says how much of it came back", () => {
    const [a, b] = [paid("2026-10-01", 30, CLOTHES, "shopping"), paid("2026-10-03", 45, CLOTHES, "shopping")];
    const ctx = contextOf([a, b, got("2026-10-11", 60, CLOTHES, "shopping")]);
    expect(monthOn(ctx)).toMatchObject({ spent: 1_500, income: 0 });
    // the later payment first, the rest from the one before it
    expect([a, b].map((p) => ctx.txs.find((t) => t.id === p.id)!.refunded)).toEqual([1_500, 4_500]);
  });

  it("lowers the category of the payments, whatever category the row itself was put in", () => {
    const ctx = contextOf([paid("2026-10-01", 300, INSURER, "insurance"), got("2026-10-11", 80, INSURER, "health"), paid("2026-10-12", 25, "Esimerkkiapteekki Oy", "health")]);
    expect(monthOn(ctx).rows).toEqual({ insurance: 22_000, health: 2_500 });
  });

  it("is told by the payee, on whichever account of the view the money moved", () => {
    const ctx = contextOf([paid("2026-10-01", 89.9, CLOTHES, "shopping", { accountId: card.id }), got("2026-10-11", 89.9, CLOTHES, "shopping")], [checking, card]);
    expect(monthOn(ctx)).toMatchObject({ spent: 0, income: 0 });
  });

  it("takes back a loan payment too, and money from a lender that was paid nothing is income", () => {
    const back = got("2026-10-11", 120, "Esimerkkipankki Oyj", "loans");
    const ctx = contextOf([paid("2026-10-05", 400, "Esimerkkipankki Oyj", "loans"), back]);
    expect(monthOn(ctx)).toMatchObject({ spent: 28_000, income: 0, rows: { loans: 28_000 } });
    const alone = contextOf([back, groceries]);
    expect(monthOn(alone)).toMatchObject({ spent: 20_000, income: 12_000 });
    expect(typeOf(alone, back)).toBe("refunds");
  });

  it("is never made of a payee without a name", () => {
    const ctx = contextOf([paid("2026-10-01", 50, "Tuntematon", "other"), got("2026-10-11", 50, "Tuntematon", "other")]);
    expect(monthOn(ctx)).toMatchObject({ spent: 5_000, income: 5_000 });
  });
});

describe("money in on a category the user set by hand", () => {
  const BY_HAND = { categorySource: "user" } as const;
  const rent = paid("2026-10-02", 640, "Asunto Oy Esimerkki", "housing");
  const food = paid("2026-10-06", 412.5, SHOP, "groceries");

  it("lowers the category it was put in, whoever paid it: a lodger's rent on Asuminen, and the same row is income when a rule put it there", () => {
    const of = (extra: Partial<Transaction>) => {
      const lodger = got("2026-10-08", 300, MAIJA, "housing", extra);
      const ctx = contextOf([rent, food, lodger]);
      return { ...monthOn(ctx), type: typeOf(ctx, lodger) };
    };
    const byHand = of(BY_HAND);
    expect(byHand.rows).toEqual({ housing: 34_000, groceries: 41_250 });
    expect(byHand).toMatchObject({ spent: 75_250, listed: 75_250, income: 0, type: undefined });
    expect(of({})).toMatchObject({ spent: 105_250, listed: 105_250, income: 30_000, type: "refunds", rows: { housing: 64_000, groceries: 41_250 } });
  });

  it("whatever the days: the payee was paid 200 days before, and the category below zero is a row that Menot counts", () => {
    const back = got("2026-10-11", 89.9, CLOTHES, "shopping", BY_HAND);
    const ctx = contextOf([paid("2026-03-25", 89.9, CLOTHES, "shopping"), back, food]);
    expect(monthOn(ctx)).toMatchObject({ rows: { groceries: 41_250, shopping: -8_990 }, spent: 41_250 - 8_990, listed: 41_250 - 8_990, income: 0 });
  });

  it("stays in the category the user chose, though the payee's payments are in another", () => {
    const premium = paid("2026-10-01", 300, INSURER, "insurance");
    const ctx = contextOf([premium, got("2026-10-11", 80, INSURER, "health", BY_HAND), paid("2026-10-12", 25, "Esimerkkiapteekki Oy", "health")]);
    expect(monthOn(ctx).rows).toEqual({ insurance: 30_000, health: -5_500 });
    expect(monthOn(ctx).listed).toBe(monthOn(ctx).spent);
    // the premium did not come back: the user said the money is about health
    expect(ctx.txs.find((t) => t.id === premium.id)!.refunded).toBe(0);
  });

  it("takes back the payee's payment of that category, so the same 50,00 does not come back twice", () => {
    const bought = paid("2026-10-01", 50, CLOTHES, "shopping");
    const [byHand, second] = [got("2026-10-11", 30, CLOTHES, "shopping", BY_HAND), got("2026-10-12", 30, CLOTHES, "shopping")];
    const ctx = contextOf([bought, byHand, second]);
    expect(monthOn(ctx)).toMatchObject({ spent: 2_000, income: 3_000, rows: { shopping: 2_000 } });
    expect(ctx.txs.find((t) => t.id === bought.id)!.refunded).toBe(3_000);
    expect([typeOf(ctx, byHand), typeOf(ctx, second)]).toEqual([undefined, "refunds"]);
  });

  it("is the user's word on Maksut henkilöille too, where a rule's row from a person is income", () => {
    const sent = paid("2026-10-04", 50, MATTI, "p2p");
    const of = (extra: Partial<Transaction>) => monthOn(contextOf([sent, got("2026-10-08", 20, MAIJA, "p2p", extra)]));
    expect(of(BY_HAND)).toMatchObject({ spent: 3_000, income: 0, rows: { p2p: 3_000 } });
    expect(of({})).toMatchObject({ spent: 5_000, income: 2_000, rows: { p2p: 5_000 } });
  });
});

describe("money from a person", () => {
  it("does not lower Maksut henkilöille, though the same person was paid more a week before", () => {
    const back = got("2026-10-11", 30, MATTI, "p2p");
    const ctx = contextOf([paid("2026-10-04", 50, MATTI, "p2p"), back]);
    expect(monthOn(ctx)).toMatchObject({ spent: 5_000, income: 3_000, rows: { p2p: 5_000 } });
    expect(typeOf(ctx, back)).toBe("persons");
  });

  it("a payment that came back still cancels: the same person, the same sum", () => {
    const sent = paid("2026-10-04", 80, MATTI, "p2p");
    const ctx = contextOf([sent, got("2026-10-06", 80, MATTI, "p2p"), paid("2026-10-07", 12, SHOP, "groceries")]);
    expect(monthOn(ctx)).toMatchObject({ spent: 1_200, income: 0, rows: { groceries: 1_200 } });
    expect(ctx.txs.find((t) => t.id === sent.id)!.refunded).toBe(8_000);
  });

  it("friends' shares of a bill still lower the bill's category", () => {
    const share = (day: string, from: string) => got(day, 40, from, "restaurants", { categorySource: "match" });
    const ctx = contextOf([paid("2026-10-04", 120, "Ravintola Esimerkki", "restaurants"), share("2026-10-05", MATTI), share("2026-10-06", MAIJA)]);
    expect(monthOn(ctx)).toMatchObject({ spent: 4_000, income: 0, rows: { restaurants: 4_000 } });
  });
});

describe("a joint account at a half", () => {
  const joint: Account = { id: "joint", name: "Yhteinen tili", holder: "MEIKALAINEN MATTI, MEIKALAINEN MAIJA", iban: null, currency: "EUR", type: "checking" };
  const on = (t: Transaction) => ({ ...t, accountId: joint.id });
  const rows = [
    on(salary("2026-10-05")),
    on(paid("2026-10-02", 640.01, "Asunto Oy Esimerkki", "housing")),
    on(paid("2026-09-01", 89.9, CLOTHES, "shopping")),
    // a refund of the purchase 40 days before, a compensation and money from a person
    on(got("2026-10-11", 89.9, CLOTHES, "shopping")),
    on(got("2026-10-08", 744, INSURER, "health")),
    on(got("2026-10-09", 30, MAIJA, "p2p")),
  ];

  it("the own view is the half of Koko talous in every figure: the same rules on the part", () => {
    const whole = monthOn(contextOf(rows, [joint]));
    const own = monthOn(contextOf(applyUse(rows, [joint], new Map([[joint.id, HALF]])), [joint]));
    expect(whole).toMatchObject({ spent: 64_001 - 8_990, income: 300_000 + 74_400 + 3_000, rows: { housing: 64_001, shopping: -8_990 } });
    // the half of an odd cent is rounded once for each row, so the rows are compared one by one
    expect(own).toMatchObject({ spent: 32_001 - 4_495, income: 150_000 + 37_200 + 1_500, rows: { housing: 32_001, shopping: -4_495 } });
    expect(own.listed).toBe(own.spent);
    expect(whole.listed).toBe(whole.spent);
  });
});

describe("the rows of Menot kategorioittain add up to Menot", () => {
  /** A household's rows as the server reads them, and the same rows as a member with a half of every account sees them. */
  function views(h: Household): { view: string; ctx: AnalysisContext }[] {
    const changed = new Map(enrichTransactions(h.txs, h.accounts, h.rules, new Map()).map((t) => [t.id, t]));
    const rows = h.txs.map((t) => changed.get(t.id) ?? t);
    const halves = new Map(h.accounts.map((a) => [a.id, HALF]));
    return [
      { view: "Koko talous", ctx: createContext(rows, h.accounts, h.today) },
      { view: "own", ctx: createContext(applyUse(rows, h.accounts, halves), h.accounts, h.today) },
    ];
  }

  it.each(goldenHouseholds().map((h) => [h.name, h] as const))("%s: in both views and every month the history holds", (_name, h) => {
    for (const { view, ctx } of views(h)) {
      let months = 0;
      for (let month = monthOf(ctx.dataFrom!); month <= monthOf(ctx.today); month = addMonths(month, 1)) {
        const rows = inDays(ctx, toDayRange(wholeMonth(month)));
        const spent = totalsOf(rows.map((t) => t.flows)).expenseCents;
        const listed = categoryTotals(rows);
        expect(listed.reduce((sum, c) => sum + c.cents, 0), `${view} ${month}`).toBe(spent);
        expect(listed.every((c) => c.cents !== 0), `${view} ${month}`).toBe(true);
        months += 1;
      }
      expect(months).toBeGreaterThan(10);
      // the answer the first page reads, for the running month and the one before it
      for (const month of [monthOf(ctx.today), addMonths(monthOf(ctx.today), -1)]) {
        const d = buildDashboard(ctx, wholeMonth(month));
        expect(d.categories.reduce((sum, c) => sum + c.cents, 0), `${view} ${month}`).toBe(d.totals.expenseCents);
      }
    }
  });
});
