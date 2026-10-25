/**
 * "Miksi?" on the figures that are not a sum of a range's rows: Tulos, the usual levels (medians), a part of
 * a joint-account row; and the reasons of card bills, card channels and returns.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { createContext, spendTotals } from "../src/analysis/context.ts";
import { leftOf, totalsOf } from "../src/analysis/flows.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { completeMonthsBefore, usualIncome, usualSpending } from "../src/analysis/usual.ts";
import { incomeReport, regularIncomeMonths } from "../src/reports/income.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import type { StatementBill } from "../src/analysis/statement-explain.ts";
import { monthEnd, monthOf, monthRange } from "../src/dates.ts";
import { sentenceOf } from "../src/explain/catalogue.ts";
import { explain } from "../src/explain/explain.ts";
import type { Explanation, FigureId } from "../src/explain/types.ts";
import { createWhy } from "../src/explain/why.ts";
import { shareOf } from "../src/money-trace-answers.ts";
import type { RowParts } from "../src/money-trace.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, AccountUse } from "../src/types.ts";
import { tx } from "./helpers.ts";

type ExplainArgs = Parameters<typeof explain>[2];

const h = demoHousehold();
const plain = contextOf(h);
const months = monthRange(monthOf(plain.dataFrom!), monthOf(h.today));
const rangeOf = (month: string) => ({ from: `${month}-01`, to: monthEnd(month) });
const argsOf = (month: string, more: Partial<ExplainArgs> = {}): ExplainArgs => ({ view: "own", range: rangeOf(month), ...more });
const diffOf = (e: Explanation) => (e.check.kind === "n/a" ? NaN : e.check.diffCents);
const account: Account = { ...h.accounts[0]!, id: "acc-1" };
const TODAY = "2026-12-20";

describe("explain: Tulos", () => {
  it("is the cash flow report's total of the month, also when a card statement lowers a bill (the first page's total then differs)", () => {
    const current: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
    const cardAccount: Account = { id: "card", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" };
    const rows = [
      tx({ id: "pay", accountId: "chk", bookingDate: "2026-03-01", amountCents: 300000, merchant: "ESIMERKKI OY", category: "income" }),
      tx({ id: "bill", accountId: "chk", bookingDate: "2026-03-10", amountCents: -42000, category: "card_bill", merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI" }),
    ];
    const statement: StatementBill = { billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows: [{ id: "r1", day: "2026-02-03", cents: 15000, text: "K-MARKET ESIMERKKI", category: "groceries" }] };
    const ctx = createContext(rows, [current, cardAccount], "2026-04-01", undefined, [], [], [statement]);
    const range = { from: "2026-03-01", to: "2026-03-31" };
    const e = explain("yli_jai.month", ctx, { view: "own", range });
    expect(e.cents).toBe(cashflowReport(ctx, range).totals.leftCents);
    expect(e.cents).toBe(300000 - 42000);
    expect(spendTotals(ctx, toDayRange(range)).leftCents, "the first page's total reads the lowered bill").not.toBe(e.cents);
    expect(e.lines.map((l) => [l.id, l.cents])).toEqual([["pay", 300000], ["bill", -42000]]);
    expect(diffOf(e)).toBe(0);
  });

  it("is the report's number for each month of the demo household", () => {
    for (const m of months) expect(explain("yli_jai.month", plain, argsOf(m)).cents, m).toBe(cashflowReport(plain, rangeOf(m)).totals.leftCents);
  });

  it("is the first page's number for each month, with a difference of 0", () => {
    let nonZero = 0;
    for (const m of months) {
      const e = explain("yli_jai.month", plain, argsOf(m));
      expect(e.kind).toBe("sum");
      expect(e.cents, m).toBe(spendTotals(plain, toDayRange(rangeOf(m))).leftCents);
      expect(diffOf(e), m).toBe(0);
      expect(e.lines.reduce((s, l) => s + l.cents, 0)).toBe(e.cents);
      expect(e.lines.every((l) => l.cents !== 0)).toBe(true);
      if (e.cents !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(2);
  });

  it("a row adds its income and credit and takes off its spending and saving; the totals are those rows' sum", () => {
    const flows = { consumption: 3000, debt: 500, saved: 200, income: 10000, borrowed: 700 };
    expect(leftOf(flows)).toBe(10000 + 700 - 3000 - 500 - 200);
    expect(totalsOf([flows, { ...flows, income: 0, borrowed: 0 }]).leftCents).toBe(leftOf(flows) + leftOf({ ...flows, income: 0, borrowed: 0 }));
  });

  it("money in, a refund and money out of a month's rows: the lines carry the signs and add up", () => {
    const rows = [
      tx({ id: "pay", bookingDate: "2026-09-01", amountCents: 250000, merchant: "ESIMERKKI OY", category: "income" }),
      tx({ id: "buy", bookingDate: "2026-09-10", amountCents: -10000, merchant: "KAUPPA OY" }),
      tx({ id: "back", bookingDate: "2026-09-15", amountCents: 4000, merchant: "KAUPPA OY" }),
    ];
    const w = createWhy("own");
    const ctx = createContext(rows, [account], TODAY, undefined, [], [], [], w);
    const e = explain("yli_jai.month", ctx, argsOf("2026-09", { why: w }));
    expect(e.cents).toBe(spendTotals(ctx, toDayRange(rangeOf("2026-09"))).leftCents);
    expect(e.lines.map((l) => [l.id, l.cents])).toEqual([["pay", 250000], ["buy", -10000], ["back", 4000]]);
    expect(diffOf(e)).toBe(0);
    // a figure of one account is its own
    expect(explain("yli_jai.month", ctx, argsOf("2026-09", { accountIds: ["nowhere"] })).lines).toEqual([]);
  });
});

describe("explain: the usual levels", () => {
  /** One expense on the 1st of each month, so the history covers every month from its 1st. */
  const monthly = (cents: number[], category = "other") => cents.map((c, i) => tx({ id: `m${i}`, bookingDate: `2026-0${i + 1}-01`, amountCents: -c, merchant: "ESIMERKKI OY", category }));
  const ctxOf = (cents: number[]) => createContext(monthly(cents), [account], TODAY);

  it("four months: the two middle ones are averaged and rounded half up, and the check recomputes it", () => {
    const e = explain("usual.spend", ctxOf([130001, 150000, 120000, 170000]), argsOf("2026-05"));
    expect(e.kind).toBe("median");
    expect(e.cents).toBe(140001);
    expect(e.lines).toEqual([]);
    expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
    expect(e.method).toMatchObject({ kind: "median", tie: "Mediaani eli kahden keskimmäisen kuukauden keskiarvo" });
    expect(e.method!.kind === "median" && e.method!.values.map((v) => [v.label, v.cents])).toEqual([["2026-01", 130001], ["2026-02", 150000], ["2026-03", 120000], ["2026-04", 170000]]);
  });

  it("each listed month opens its own sum, which adds up to the month's value", () => {
    const e = explain("usual.spend", ctxOf([130001, 150000, 120000, 170000]), argsOf("2026-05"));
    if (e.method?.kind !== "median") throw new Error("not a median");
    for (const v of e.method.values) {
      expect(v.explain!.kind).toBe("sum");
      expect(v.explain!.cents).toBe(v.cents);
      expect(v.explain!.check).toEqual({ kind: "sum", diffCents: 0 });
      expect(v.explain!.lines).toHaveLength(1);
    }
  });

  it("an odd count takes the middle one; a median never carries the sum's check", () => {
    const e = explain("usual.spend", ctxOf([100000, 300000, 200000, 500000, 400000]), argsOf("2026-06"));
    expect(e.cents).toBe(300000);
    expect(e.method).toMatchObject({ tie: "Mediaani eli keskimmäinen kuukausi" });
    expect(e.check.kind).toBe("recompute");
    expect(JSON.stringify(e.check)).not.toContain("sum");
  });

  it("under three complete months the figure is null and says how many there were", () => {
    const e = explain("usual.spend", ctxOf([130001, 150000]), argsOf("2026-03"));
    expect(e.cents).toBeNull();
    expect(e.lines).toEqual([]);
    expect(e.method).toMatchObject({ rule: "Vertailuun tarvitaan 3 kuukautta, tietoja on 2" });
    expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
    // three is enough
    expect(explain("usual.spend", ctxOf([130001, 150000, 120000]), argsOf("2026-04")).cents).toBe(130001);
  });

  it("a running month and a month the history does not cover are no part of it", () => {
    const e = explain("usual.spend", createContext(monthly([100000, 100000, 100000]), [account], "2026-04-10"), argsOf("2026-04"));
    expect(e.method!.kind === "median" && e.method!.values.map((v) => v.label)).toEqual(["2026-01", "2026-02", "2026-03"]);
    const later = explain("usual.spend", createContext(monthly([100000, 100000, 100000]), [account], "2026-03-10"), argsOf("2026-03"));
    expect(later.cents).toBeNull();
  });

  it("the usual spending of the demo household is the report's number, each month with a difference of 0", () => {
    let figures = 0;
    for (const m of months) {
      const spend = explain("usual.spend", plain, argsOf(m));
      expect(spend.cents, m).toBe(usualSpending(plain, m));
      expect(spend.kind).toBe("median");
      expect(spend.check).toEqual({ kind: "recompute", diffCents: 0 });
      if (spend.method?.kind !== "median") throw new Error("not a median");
      expect(spend.method.values.map((v) => v.label)).toEqual(completeMonthsBefore(plain, m));
      for (const v of spend.method.values) expect(v.explain!.check).toEqual({ kind: "sum", diffCents: 0 });
      if (spend.cents !== null) figures++;
    }
    expect(figures).toBeGreaterThan(2);
  });

  /** The page's "Säännölliset tulot kuussa": the income report's own median of the range the report is drawn for. */
  const pageIncome = (ctx: typeof plain, range: { from: string; to: string }) => incomeReport(ctx, range).stability?.medianCents ?? null;
  const RANGES = [{ from: "2025-09-01", to: "2026-10-09" }, { from: "2026-01-01", to: "2026-12-31" }, { from: "2025-10-01", to: "2026-09-30" }];

  it("the usual income is the income report's median over the months the report reads, listed, with a difference of 0", () => {
    let figures = 0;
    for (const range of RANGES) {
      const e = explain("usual.income", plain, { view: "own", range });
      expect(e.cents, range.to).toBe(pageIncome(plain, range));
      expect(e.kind).toBe("median");
      expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
      if (e.method?.kind !== "median") throw new Error("not a median");
      expect(e.method.values.map((v) => v.label)).toEqual(regularIncomeMonths(plain, range).map((m) => m.month));
      for (const v of e.method.values) {
        expect(v.explain!.check).toEqual({ kind: "sum", diffCents: 0 });
        expect(v.explain!.lines.reduce((s, l) => s + l.cents, 0)).toBe(v.cents);
      }
      if (e.cents !== null) {
        figures++;
        expect(e.method.values).toHaveLength(12);
        expect(e.method.rule).toBe("Säännölliset tulot viimeiseltä 12 valmiilta kuukaudelta");
      }
    }
    expect(figures).toBeGreaterThan(1);
  });

  it("a 20 % raise from April: the panel is still the page's median, not a median of other months", () => {
    // made-up sums: every income row from 2026-04 on is 20 % more
    const raised = contextOf({ ...h, txs: h.txs.map((t) => (t.amountCents > 0 && t.bookingDate >= "2026-04" ? { ...t, amountCents: Math.round(t.amountCents * 1.2) } : t)) });
    const range = RANGES[0]!;
    const e = explain("usual.income", raised, { view: "own", range });
    // the median of the six months before the last one, which the panel read before, is another number
    expect(usualIncome(raised, "2026-10")).not.toBe(pageIncome(raised, range));
    expect(e.cents).toBe(pageIncome(raised, range));
    expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
    // a range the page draws over a whole year, which the old figure (the six months before its last month) could not tell
    const year = explain("usual.income", raised, { view: "own", range: RANGES[1]! });
    expect(year.cents).toBe(pageIncome(raised, RANGES[1]!));
    expect(year.cents).not.toBeNull();
  });

  it("under twelve complete months the page has no median and the figure says how many there were out of twelve", () => {
    const rows = Array.from({ length: 4 }, (_, i) => tx({ id: `p${i}`, bookingDate: `2026-0${i + 1}-25`, amountCents: 300000, merchant: "ESIMERKKI OY", category: "income" }));
    const ctx = createContext(rows, [account], "2026-05-10");
    const e = explain("usual.income", ctx, { view: "own", range: { from: "2026-01-01", to: "2026-05-10" } });
    expect(e.cents).toBeNull();
    expect(pageIncome(ctx, { from: "2026-01-01", to: "2026-05-10" })).toBeNull();
    expect(e.method).toMatchObject({ rule: expect.stringMatching(/^Vertailuun tarvitaan 12 kuukautta, tietoja on \d+$/) });
    expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
  });

  it("refuses a figure of some accounts, which the reports have none of", () => {
    expect(() => explain("usual.spend", plain, argsOf(months.at(-1)!, { accountIds: ["x"] }))).toThrow("some accounts");
  });
});

describe("explain: a part of one joint-account row", () => {
  const two: AccountUse = { users: [{ userId: "u1", label: "A", weight: 1 }, { userId: "u2", label: "B", weight: 1 }], source: "said" };
  const row = tx({ id: "rent", bookingDate: "2026-09-05", amountCents: -10001, merchant: "ESIMERKKI OY" });
  const ctx = createContext([row], [account], TODAY);

  it("an untraced row: each user's part by the weights, the cent to the first, and the parts add up to the bank's amount", () => {
    const a = explain("share.part", ctx, argsOf("2026-09", { rowId: "rent", use: two, viewerId: "u1" }));
    expect(a.kind).toBe("share");
    expect(a.cents).toBe(-5001);
    expect(a.lines).toEqual([
      { id: "u:u1", day: "2026-09-05", cents: -5001, whole: -10001, why: [{ rule: "part.use", from: 0, to: 1, of: 2 }, { rule: "rounding.cent" }] },
      { id: "u:u2", day: "2026-09-05", cents: -5000, whole: -10001, why: [{ rule: "part.use", from: 1, to: 2, of: 2 }] },
    ]);
    expect(a.check).toEqual({ kind: "recompute", diffCents: 0 });
    expect(sentenceOf(a.lines[0]!.why[0]!)).toBe("Osuutesi tilin rahoista on 1/2");
    // the other member's view of the same row: their part, the same lines, and the two add up to the whole
    const b = explain("share.part", ctx, argsOf("2026-09", { rowId: "rent", use: two, viewerId: "u2" }));
    expect(b.cents).toBe(-5000);
    expect(a.cents! + b.cents!).toBe(-10001);
    expect(b.lines).toEqual(a.lines);
  });

  it("a user with no part, and an even split that needs no rounding", () => {
    expect(explain("share.part", ctx, argsOf("2026-09", { rowId: "rent", use: two, viewerId: "u3" })).cents).toBe(0);
    const even = createContext([{ ...row, amountCents: -10000 }], [account], TODAY);
    const e = explain("share.part", even, argsOf("2026-09", { rowId: "rent", use: two, viewerId: "u1" }));
    expect(e.lines.flatMap((l) => l.why.map((r) => r.rule))).toEqual(["part.use", "part.use"]);
    expect(e.lines.map((l) => l.cents)).toEqual([-5000, -5000]);
    // three users, parts of 1:1:1 of 100,01 add up too
    const three: AccountUse = { users: ["u1", "u2", "u3"].map((userId) => ({ userId, label: userId, weight: 1 })), source: "said" };
    const t = explain("share.part", ctx, argsOf("2026-09", { rowId: "rent", use: three, viewerId: "u2" }));
    expect(t.lines.map((l) => l.cents)).toEqual([-3334, -3333, -3334]);
    expect(t.check).toEqual({ kind: "recompute", diffCents: 0 });
  });

  it("the part of an instalment row of a joint loan account is the part its row shows, whatever the loan holds", () => {
    const half = { from: 0, to: 1, of: 2 };
    const row = (parts: RowParts["parts"], cents: number, id: string) => ({ key: id, ids: [id], day: 1, cents, what: "all", parts }) as RowParts;
    // 600,00 paid on a loan that holds -0,90: the opening is the viewer's, the 0,90 the account owes is nobody's
    const instalment = row([{ owner: "u:a", kind: "opening", cents: 59910 }, { owner: "g:x", kind: "unknown", cents: 90 }], -60000, "i1");
    // the same 600,00 as money the viewer paid in
    const paidIn = row([{ owner: "u:a", kind: "own", cents: 60000 }], 60000, "i2");
    for (const [traced, whole] of [[instalment, -60000], [paidIn, 60000]] as const) {
      const w = createWhy("own");
      const mine = shareOf(traced, "u:a", half, () => false, w).cents;
      w.add(traced.ids[0]!, { rule: "category.builtin", source: "default" });
      const rowOf = tx({ id: traced.ids[0]!, bookingDate: "2026-09-05", amountCents: mine, wholeCents: whole, merchant: "ESIMERKKI OY" });
      const e = explain("share.part", createContext([rowOf], [account], TODAY), argsOf("2026-09", { why: w, rowId: traced.ids[0]!, use: two, viewerId: "u1" }));
      expect(e.cents).toBe(mine);
      expect(e.lines.reduce((sum, l) => sum + l.cents, 0)).toBe(mine);
      expect(e.check).toEqual({ kind: "recompute", diffCents: 0 });
    }
    expect(shareOf(instalment, "u:a", half, () => false).cents).toBe(-59955);
  });

  it("a traced row says whose money its own parts were and cuts only the unknown ones; with none unknown there is no cut", () => {
    const parts = (extra: RowParts["parts"]): RowParts => ({
      key: "k",
      ids: ["r1"],
      day: 1,
      cents: -10001,
      what: "all",
      parts: [{ owner: "u:a", kind: "own", cents: 5000 }, { owner: "u:b", kind: "own", cents: 3000 }, ...extra],
    });
    const half = { from: 0, to: 1, of: 2 };
    const traced = (extra: RowParts["parts"], counted: number) => {
      const w = createWhy("own");
      expect(shareOf(parts(extra), "u:a", half, () => false, w).cents).toBe(counted);
      const rowOf = tx({ id: "r1", bookingDate: "2026-09-05", amountCents: counted, wholeCents: -10001, merchant: "ESIMERKKI OY" });
      return explain("share.part", createContext([rowOf], [account], TODAY), argsOf("2026-09", { why: w, rowId: "r1", use: two, viewerId: "u1" }));
    };
    const e = traced([{ owner: "g:x", kind: "unknown", cents: 2001 }], -6001);
    expect(e.lines.map((l) => [l.why[0]!.rule, l.cents])).toEqual([["part.source", -5000], ["part.source", 0], ["part.use", -1001]]);
    expect(e.lines.some((l) => l.why.some((r) => r.rule === "part.source" && r.mine === false))).toBe(true);
    expect(e).toMatchObject({ cents: -6001, check: { kind: "recompute", diffCents: 0 } });
    const none = traced([], -5000);
    expect(none.lines.some((l) => l.why.some((r) => r.rule === "part.use"))).toBe(false);
    expect(none.check).toEqual({ kind: "recompute", diffCents: 0 });
    // a traced row is never explained by the weights alone: no rounding line, and the weights' lines are not there
    expect(e.lines.some((l) => l.id.startsWith("u:"))).toBe(false);
  });

  it("needs a row of the view and the use of its account, and names nobody", () => {
    expect(() => explain("share.part", ctx, argsOf("2026-09", { rowId: "none", use: two }))).toThrow("no such row");
    expect(() => explain("share.part", ctx, argsOf("2026-09", { rowId: "rent" }))).toThrow("needs a row");
    expect(JSON.stringify(explain("share.part", ctx, argsOf("2026-09", { rowId: "rent", use: two, viewerId: "u1" })))).not.toMatch(/"label"|ESIMERKKI/);
  });
});

describe("explain: a sum figure and settlement", () => {
  it("a sum figure checks against its lines", () => {
    for (const f of ["spend.month", "income.month", "yli_jai.month"] as FigureId[]) expect(explain(f, plain, argsOf(months.at(-1)!)).check.kind).toBe("sum");
  });

  it("settlement is not built yet", () => {
    expect(() => explain("settlement.over", plain, argsOf(months[0]!))).toThrow("not a sum figure");
  });
});

describe("explain: the figures are the same with and without a collector", () => {
  const w = createWhy("own");
  const changed = new Map(enrichTransactions(h.txs, h.accounts, h.rules, new Map(), undefined, w).map((t) => [t.id, t]));
  const withWhy = createContext(h.txs.map((t) => changed.get(t.id) ?? t), h.accounts, h.today, undefined, [], [], [], w);

  it("each new figure gives one number either way", () => {
    for (const m of months) {
      for (const f of ["yli_jai.month", "usual.spend", "usual.income"] as FigureId[]) {
        const a = explain(f, withWhy, argsOf(m, { why: w }));
        const b = explain(f, plain, argsOf(m));
        expect(a.cents, `${f} ${m}`).toBe(b.cents);
        expect(a.check, `${f} ${m}`).toEqual(b.check);
      }
    }
  });
});

describe("explain: the reasons of card bills, card channels and returns", () => {
  const CHK: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
  const CARD: Account = { id: "card", name: "Esimerkkipankki Gold", iban: null, currency: "EUR", type: "credit_card" };
  const bank = { counterparty: "ESIMERKKIPANKKI OYJ", counterpartyIban: "FI0000000000000009", description: "10016", merchant: "ESIMERKKIPANKKI" };
  const pay = (id: string, date: string, cents: number) => ({ ...tx({ id, bookingDate: date, amountCents: cents, accountId: "chk", ...bank }), reference: "10016" });
  // the card's rows begin on 10.9. and its bill of 300 is paid on 14.9. and booked on the card on 15.9.
  const card = [
    tx({ id: "purchase", bookingDate: "2026-09-10", amountCents: -4200, accountId: "card", merchant: "KAHVILA ESIMERKKI", description: "KAHVILA ESIMERKKI HELSINKI" }),
    pay("pay", "2026-09-14", -30000),
    tx({ id: "paid", bookingDate: "2026-09-15", amountCents: 30000, accountId: "card", description: "SUORITUS 14.09", merchant: "SUORITUS" }),
  ];
  const run = (rows: ReturnType<typeof tx>[]) => {
    const w = createWhy("own");
    enrichTransactions(rows, [CHK, CARD], [], new Map(), undefined, w);
    return w;
  };

  it("a payment to a card's channel from before the card's rows is a card bill, naming the card", () => {
    const w = run([pay("june", "2026-06-03", -50000), ...card, pay("soon", "2026-09-25", -12000)]);
    expect(w.of("june")).toEqual([{ rule: "card.bill", card: "card" }]);
    expect(w.of("soon")).toEqual([{ rule: "card.bill", card: "card" }]);
    expect(sentenceOf(w.of("june")[0]!)).toBe("Luottokortin lasku. Kortin ostoja ei näy, joten lasku lasketaan velanhoitoon.");
    // the pair itself is a transfer between accounts, not a card bill
    expect(w.of("pay").map((r) => r.rule)).toEqual(["transfer.pair"]);
  });

  it("an unpaired payment to the channel after the card's rows began is a channel transfer, not a card bill", () => {
    const w = run([...card, pay("later", "2026-11-14", -45000)]);
    expect(w.of("later")).toEqual([{ rule: "transfer.channel" }]);
    expect(w.of("later").some((r) => r.rule === "card.bill")).toBe(false);
  });

  it("a payee that taught no channel gives neither reason", () => {
    const w = run([{ ...pay("one", "2026-06-03", -50000), counterparty: "KAUPPA ESIMERKKI OY", counterpartyIban: "FI0000000000000025", reference: "40040" }, ...card.slice(0, 1)]);
    expect(w.of("one").filter((r) => /^(card|transfer)\./.test(r.rule))).toEqual([]);
  });

  const friend = { merchant: "Matti Meikalainen", counterparty: "MATTI MEIKALAINEN", description: "MOBILEPAY MATTI MEIKALAINEN" };
  it("money back from the person it was sent to says return.person, and a part of a business's bill return.share", () => {
    const sent = tx({ id: "sent", bookingDate: "2026-09-03", amountCents: -5000, ...friend });
    const back = tx({ id: "back", bookingDate: "2026-09-10", amountCents: 5000, ...friend });
    const w = createWhy("own");
    enrichTransactions([sent, back], [CHK], [], new Map(), undefined, w);
    expect(w.of("back").map((r) => r.rule)).toContain("return.person");
    expect(w.of("back")).toContainEqual({ rule: "return.person", purchase: "sent" });
    const bill = tx({ id: "bill", bookingDate: "2026-09-03", amountCents: -6000, merchant: "ZXQ RAVINTOLA OY", counterparty: "ZXQ RAVINTOLA OY", category: "other" });
    const share = tx({ id: "share", bookingDate: "2026-09-10", amountCents: 6000, ...friend });
    const w2 = createWhy("own");
    enrichTransactions([bill, share], [CHK], [], new Map(), undefined, w2);
    expect(w2.of("share")).toContainEqual({ rule: "return.share", purchase: "bill" });
    expect(sentenceOf({ rule: "return.share" })).toBe("Toisen osuus yhteisestä ostoksesta");
    // a near miss: a different sum from the same person is no return
    const other = tx({ id: "other", bookingDate: "2026-09-10", amountCents: 1234, ...friend });
    const w3 = createWhy("own");
    enrichTransactions([sent, other], [CHK], [], new Map(), undefined, w3);
    expect(w3.of("other").some((r) => r.rule.startsWith("return."))).toBe(false);
  });
});
