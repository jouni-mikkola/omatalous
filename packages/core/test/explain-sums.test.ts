/**
 * "Miksi?" on the sum figures: the rows a month's spending, a category's spending, a month's income and a month's earned
 * income add up, with the rule that placed each row, and the check that the lines add up to the figure to the cent.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { applyUse } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { monthEnd, monthOf, monthRange } from "../src/dates.ts";
import { sentenceOf } from "../src/explain/catalogue.ts";
import { explain } from "../src/explain/explain.ts";
import type { Explanation, FigureId, Reason, RuleId } from "../src/explain/types.ts";
import { createWhy, whyReturns } from "../src/explain/why.ts";
import { settleTransfers } from "../src/card-channel.ts";
import { shareOf } from "../src/money-trace-answers.ts";
import type { RowParts } from "../src/money-trace.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { categoryReport } from "../src/reports/categories.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

type ExplainArgs = Parameters<typeof explain>[2];

/** Every rule: the compiler holds this list to the union. */
const RULES: Record<RuleId, true> = {
  "category.hand": true, "category.own_rule": true, "category.builtin": true, "transfer.pair": true, "transfer.channel": true, "card.bill": true,
  "return.shop": true, "return.person": true, "return.share": true, "return.wallet": true, "share.back": true, "share.open": true, "via.service": true, "refund.net": true, "part.use": true, "part.source": true, "role.payer": true,
  "settle.paid": true, "settle.owed": true, "settle.refund": true, "settle.credit_filled": true, "settle.unknown": true, "settle.open": true,
  "settle.closed": true, "agree.dated": true, "rounding.cent": true,
};

const h = demoHousehold();
const plain = contextOf(h);
const why = createWhy("own");
const changed = new Map(enrichTransactions(h.txs, h.accounts, h.rules, new Map(), undefined, why).map((t) => [t.id, t]));
const withWhy = createContext(h.txs.map((t) => changed.get(t.id) ?? t), h.accounts, h.today, undefined, [], [], [], why);
const months = monthRange(monthOf(plain.dataFrom!), monthOf(h.today));
const rangeOf = (month: string) => ({ from: `${month}-01`, to: monthEnd(month) });
const argsOf = (month: string, more: Partial<ExplainArgs> = {}): ExplainArgs => ({ view: "own", range: rangeOf(month), ...more });
const diffOf = (e: Explanation) => (e.check.kind === "n/a" ? NaN : e.check.diffCents);

describe("explain: the sum figures on the demo household", () => {
  it("each month's four figures are the reports' numbers, with a difference of 0", () => {
    let spent = 0;
    for (const m of months) {
      const range = rangeOf(m);
      const spend = explain("spend.month", withWhy, argsOf(m, { why }));
      expect(spend.cents, m).toBe(categoryReport(plain, range).totalCents);
      const income = explain("income.month", withWhy, argsOf(m, { why }));
      expect(income.cents, m).toBe(cashflowReport(plain, range).rows.at(-1)!.incomeCents);
      const earned = explain("income.earned", withWhy, argsOf(m, { why }));
      expect(earned.cents, m).toBe(earnedIncome(plain, m));
      for (const e of [spend, income, earned]) {
        expect(e.kind).toBe("sum");
        expect(diffOf(e), `${e.figure} ${m}`).toBe(0);
        expect(e.lines.reduce((s, l) => s + l.cents, 0)).toBe(e.cents);
      }
      spent += spend.cents!;
    }
    expect(spent).toBeGreaterThan(0);
  });

  it("each category's figure is its row of the category report", () => {
    const range = rangeOf(months.at(-2)!);
    const rows = categoryReport(plain, range).groups.flatMap((g) => g.categories);
    expect(rows.length).toBeGreaterThan(3);
    for (const c of rows) {
      const e = explain("spend.category", withWhy, { ...argsOf(months.at(-2)!, { why }), category: c.category });
      expect(e.cents, c.category).toBe(c.totalCents);
      expect(diffOf(e)).toBe(0);
      expect(e.lines.length).toBe(c.count);
    }
  });

  it("the figures are the same with and without a collector", () => {
    expect(withWhy.txs).toEqual(plain.txs);
    expect(withWhy.returns).toEqual(plain.returns);
    for (const m of months) {
      for (const figure of ["spend.month", "income.month", "income.earned"] as FigureId[]) {
        const a = explain(figure, withWhy, argsOf(m, { why }));
        const b = explain(figure, plain, argsOf(m));
        expect(a.cents).toBe(b.cents);
        expect(a.check).toEqual(b.check);
      }
    }
  });

  it("the decision points give their reasons, and a row left out of spending is listed at 0 only with them", () => {
    const rules = new Set<RuleId>();
    let leftOut = 0;
    for (const m of months) {
      for (const l of explain("spend.month", withWhy, argsOf(m, { why })).lines) {
        for (const r of l.why) rules.add(r.rule);
        if (l.cents === 0) leftOut++;
      }
      expect(explain("spend.month", plain, argsOf(m)).lines.every((l) => l.cents !== 0 && l.why.length === 0)).toBe(true);
    }
    expect(rules.has("category.builtin")).toBe(true);
    expect(leftOut).toBeGreaterThan(0);
    for (const m of months) for (const l of explain("spend.month", withWhy, argsOf(m, { why })).lines) if (l.cents === 0) expect(l.why.some((r) => /^(transfer|card)\./.test(r.rule))).toBe(true);
  });

  it("a figure of one account is its own, and the accounts' figures add up to the whole", () => {
    const m = months.at(-2)!;
    const all = explain("spend.month", withWhy, argsOf(m, { why }));
    const parts = h.accounts.map((a) => explain("spend.month", withWhy, argsOf(m, { why, accountIds: [a.id] })));
    expect(parts.reduce((s, e) => s + e.cents!, 0)).toBe(all.cents);
    for (const [i, e] of parts.entries()) expect(e.lines.every((l) => withWhy.txs.find((t) => t.id === l.id)!.accountId === h.accounts[i]!.id)).toBe(true);
    expect(parts.some((e) => e.cents !== all.cents)).toBe(true);
  });

  it("a payload names no IBAN and nothing the bank wrote", () => {
    const json = months.flatMap((m) => ["spend.month", "income.month", "income.earned"].map((f) => JSON.stringify(explain(f as FigureId, withWhy, argsOf(m, { why }))))).join("\n");
    expect(json.length).toBeGreaterThan(1000);
    expect(json).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/);
    const texts = new Set(h.txs.flatMap((t) => [t.merchant, t.counterparty, t.description, t.counterpartyIban]).filter((x): x is string => !!x && x.length >= 6));
    expect(texts.size).toBeGreaterThan(10);
    for (const text of texts) expect(json.includes(text), text).toBe(false);
  });

  it("refuses a figure that is not a sum here, and a category figure with no category", () => {
    expect(() => explain("settlement.over", plain, argsOf(months[0]!))).toThrow("not a sum figure");
    expect(() => explain("spend.category", plain, argsOf(months[0]!))).toThrow("needs a category");
    expect(explain("spend.category", plain, { ...argsOf(months[0]!), category: "no_such_category" }).lines).toEqual([]);
  });
});

describe("explain: the worked cases", () => {
  const account: Account = { ...h.accounts[0]!, id: "acc-1" };
  const TODAY = "2026-12-20";

  it("a refund that arrives the month after sits in the later month and names its purchase's month; the earlier month is unchanged", () => {
    const purchase = tx({ id: "buy", bookingDate: "2026-09-28", amountCents: -10000, merchant: "ESIMERKKI OY" });
    const refund = tx({ id: "back", bookingDate: "2026-10-03", amountCents: 4000, merchant: "ESIMERKKI OY" });
    const w = createWhy("own");
    const both = createContext([purchase, refund], [account], TODAY, undefined, [], [], [], w);
    const only = createContext([purchase], [account], TODAY);
    const sept = explain("spend.month", both, { ...argsOf("2026-09", { why: w }) });
    expect(sept.lines).toEqual(explain("spend.month", only, argsOf("2026-09", { why: createWhy("own") })).lines);
    expect(sept.cents).toBe(10000);
    const oct = explain("spend.month", both, argsOf("2026-10", { why: w }));
    expect(oct.cents).toBe(-4000);
    expect(oct.lines).toEqual([{ id: "back", day: "2026-10-03", cents: -4000, why: [{ rule: "refund.net", purchase: "buy", months: 1, cents: 4000 }] }]);
    expect(diffOf(oct)).toBe(0);
    expect(sentenceOf(oct.lines[0]!.why[0]!)).toBe("Palautus vähennetty edellisen kuukauden ostosta");
    // the same month: the line says so
    const same = tx({ id: "same", bookingDate: "2026-09-29", amountCents: 2500, merchant: "ESIMERKKI OY" });
    const w2 = createWhy("own");
    const near = createContext([purchase, same], [account], TODAY, undefined, [], [], [], w2);
    expect(explain("spend.month", near, argsOf("2026-09", { why: w2 })).lines.find((l) => l.id === "same")!.why).toEqual([{ rule: "refund.net", purchase: "buy", months: 0, cents: 2500 }]);
  });

  it("a row cut by the part says the part and carries the bank's amount; a whole account says neither", () => {
    const row = tx({ id: "rent", bookingDate: "2026-09-05", amountCents: -10001, merchant: "ESIMERKKI OY" });
    const w = createWhy("own");
    const cut = applyUse([row], [account], new Map([["acc-1", { from: 0, to: 3, of: 5 }]]), new Map(), undefined, w);
    const e = explain("spend.month", createContext(cut, [account], TODAY), argsOf("2026-09", { why: w }));
    expect(e.lines).toEqual([{ id: "rent", day: "2026-09-05", cents: 6001, whole: 10001, why: [{ rule: "part.use", from: 0, to: 3, of: 5 }] }]);
    expect(e.cents).toBe(6001);
    expect(diffOf(e)).toBe(0);
    expect(sentenceOf(e.lines[0]!.why[0]!)).toBe("Osuutesi tilin rahoista on 3/5");
    const w2 = createWhy("own");
    const whole = applyUse([row], [account], new Map([["acc-1", { from: 0, to: 1, of: 1 }]]), new Map(), undefined, w2);
    expect(explain("spend.month", createContext(whole, [account], TODAY), argsOf("2026-09", { why: w2 })).lines).toEqual([{ id: "rent", day: "2026-09-05", cents: 10001, why: [] }]);
  });

  it("a traced row says whose money its own parts were and cuts only the unknown parts; one with no unknown part has no cut", () => {
    const parts = (extra: RowParts["parts"]): RowParts => ({
      key: "k",
      ids: ["r1"],
      day: 1,
      cents: -10001,
      what: "all",
      parts: [{ owner: "u:a", kind: "own", cents: 5000 }, { owner: "u:b", kind: "own", cents: 3000 }, ...extra],
    });
    const half = { from: 0, to: 1, of: 2 };
    const w = createWhy("own");
    expect(shareOf(parts([{ owner: "g:x", kind: "unknown", cents: 2001 }]), "u:a", half, () => false, w).cents).toBe(-6001);
    expect(w.of("r1")).toEqual([
      { rule: "part.source", owner: "u:a", kind: "own", cents: -5000, passed: false, mine: true },
      { rule: "part.source", owner: "u:b", kind: "own", cents: -3000, passed: false, mine: false },
      { rule: "part.use", from: 0, to: 1, of: 2, cents: -1001 },
    ]);
    const w2 = createWhy("own");
    shareOf(parts([]), "u:a", half, () => false, w2);
    expect(w2.of("r1").some((r) => r.rule === "part.use")).toBe(false);
    // no collector: the same cents
    expect(shareOf(parts([{ owner: "g:x", kind: "unknown", cents: 2001 }]), "u:a", half, () => false).cents).toBe(-6001);
  });

  it("every rule has a Finnish sentence", () => {
    for (const rule of Object.keys(RULES) as RuleId[]) {
      const reason: Reason = { rule, source: "mcc", months: 2, from: 0, to: 1, of: 2, valid_from: "1.1.2026", mine: true };
      expect(sentenceOf(reason).length, rule).toBeGreaterThan(5);
    }
    expect(sentenceOf({ rule: "category.builtin", source: "industry" })).toBe("Luokiteltu kaupan toimialan mukaan");
    // an agreement date is written d.m.yyyy, never ISO
    expect(sentenceOf({ rule: "agree.dated", valid_from: "2026-10-01" })).toBe("Sopimus on voimassa 1.10.2026 alkaen");
    expect(sentenceOf({ rule: "agree.dated", valid_from: "2026-12-15" })).toBe("Sopimus on voimassa 15.12.2026 alkaen");
    // a refund two months on and one with a same-month purchase
    expect(sentenceOf({ rule: "refund.net", months: 2 })).toBe("Palautus vähennetty ostosta, joka tehtiin 2 kuukautta aiemmin");
    expect(sentenceOf({ rule: "refund.net", months: 0 })).toBe("Palautus vähennetty saman kuukauden ostosta");
  });
});

describe("explain: the reasons of the pipeline", () => {
  const account: Account = { ...h.accounts[0]!, id: "acc-1" };
  const run = (rows: ReturnType<typeof tx>[], rules: Parameters<typeof enrichTransactions>[2] = []) => {
    const w = createWhy("own");
    const done = new Map(enrichTransactions(rows, [account], rules, new Map(), undefined, w).map((t) => [t.id, t]));
    const ctx = createContext(rows.map((t) => done.get(t.id) ?? t), [account], "2026-12-20", undefined, [], [], [], w);
    return { w, ctx, lines: explain("spend.month", ctx, { view: "own", range: { from: "2026-09-01", to: "2026-09-30" }, why: w }).lines };
  };
  const shop = (id: string, date: string, cents: number) => tx({ id, bookingDate: date, amountCents: cents, merchant: "Zxq Tmi", counterparty: "ZXQ TMI", category: "other", categorySource: "default" });

  it("says who chose a category: the household by hand, its own rule, the built-in rules", () => {
    const rule = { field: "merchant" as const, pattern: "Zxq", category: "groceries", priority: 10 };
    const hand = tx({ id: "hand", bookingDate: "2026-09-02", amountCents: -1000, merchant: "Other Oy", category: "groceries", categorySource: "user" });
    const own = run([shop("own", "2026-09-03", -2000), hand], [rule]);
    expect(own.lines.find((l) => l.id === "own")!.why).toEqual([{ rule: "category.own_rule" }]);
    expect(own.lines.find((l) => l.id === "hand")!.why).toEqual([{ rule: "category.hand" }]);
    const builtin = run([shop("plain", "2026-09-03", -2000)]);
    expect(builtin.lines[0]!.why).toEqual([{ rule: "category.builtin", source: "default" }]);
  });

  it("a shop's refund names its purchase", () => {
    const { lines } = run([shop("p", "2026-09-03", -7900), shop("r", "2026-09-17", 7900)]);
    expect(lines.find((l) => l.id === "r")!.why.map((r) => r.rule)).toEqual(expect.arrayContaining(["return.shop", "refund.net"]));
    expect(lines.find((l) => l.id === "r")!.why).toContainEqual({ rule: "return.shop", purchase: "p" });
    expect(lines.find((l) => l.id === "r")!.cents).toBe(-7900);
    // a near miss: another merchant's money in is no return
    const other = run([shop("p", "2026-09-03", -7900), { ...shop("x", "2026-09-17", 7900), merchant: "Other", counterparty: "OTHER" }]);
    expect(other.lines.some((l) => l.why.some((r) => r.rule.startsWith("return.")))).toBe(false);
  });
});

describe("explain: what each rule says it is", () => {
  const person = (id: string, cents: number, extra: Partial<ReturnType<typeof tx>> = {}) =>
    tx({ id, bookingDate: "2026-09-10", amountCents: cents, merchant: "Matti Meikalainen", counterparty: "MATTI MEIKALAINEN", ...extra });
  const bill = tx({ id: "p", bookingDate: "2026-09-03", amountCents: -6000, merchant: "ZXQ RAVINTOLA OY", counterparty: "ZXQ RAVINTOLA OY", category: "other" });
  const ruleOf = (rows: ReturnType<typeof tx>[]) => {
    const w = createWhy("own");
    whyReturns(w, rows, new Map([["r", "p"]]), new Set(), new Set());
    return w.of("r").map((r) => r.rule);
  };

  it("tells a friend's share of a business's bill, money sent to a person coming back, and a shop's refund apart", () => {
    expect(ruleOf([bill, person("r", 6000, { category: "p2p_in", categorySource: "rule" })])).toEqual(["return.share"]);
    expect(ruleOf([{ ...bill, merchant: "Matti Meikalainen", counterparty: "MATTI MEIKALAINEN", category: "p2p", amountCents: -5000 }, person("r", 5000, { category: "income" })])).toEqual(["return.person"]);
    expect(ruleOf([{ ...bill, merchant: "Matti Meikalainen", counterparty: "MATTI MEIKALAINEN", category: "p2p", amountCents: -5000 }, person("r", 5000, { category: "p2p_in", categorySource: "rule" })])).toEqual(["return.person"]);
    expect(ruleOf([bill, { ...bill, id: "r", amountCents: 6000, category: "income" }])).toEqual(["return.shop"]);
  });

  const ibans = { chk: "FI2112345600000785", sav: "FI4950009420028730" };
  const accounts: Account[] = [
    { ...h.accounts[0]!, id: "chk", iban: ibans.chk },
    { ...h.accounts[0]!, id: "sav", iban: ibans.sav, type: "savings" },
  ];

  it("a transfer to the household's own savings account is a transfer between accounts, not a card's payment", () => {
    const out = tx({ id: "out", accountId: "chk", bookingDate: "2026-09-04", amountCents: -20000, counterpartyIban: ibans.sav, merchant: "Oma säästö" });
    const w = createWhy("own");
    const { transfers, cardBills } = settleTransfers([out], accounts, new Set(), w);
    expect(transfers.has("out")).toBe(true);
    expect(cardBills.size).toBe(0);
    expect(w.of("out")).toEqual([{ rule: "transfer.pair" }]);
    // a pair names its other leg
    const into = tx({ id: "in", accountId: "sav", bookingDate: "2026-09-04", amountCents: 20000, counterpartyIban: ibans.chk, merchant: "Oma säästö" });
    const w2 = createWhy("own");
    settleTransfers([out, into], accounts, new Set(), w2);
    expect(w2.of("out")).toEqual([{ rule: "transfer.pair", other: "in" }]);
    expect(w2.of("in")).toEqual([{ rule: "transfer.pair", other: "out" }]);
    // no collector: the same answer
    expect([...settleTransfers([out, into], accounts, new Set()).transfers].sort()).toEqual(["in", "out"]);
  });

  it("a transfer whose other leg is outside the view becomes money between people and says so", () => {
    const out = tx({ id: "out", accountId: "chk", bookingDate: "2026-09-04", amountCents: -5000, counterpartyIban: ibans.sav, merchant: "ESIMERKKI OY", category: "transfer", categorySource: "transfer", isTransfer: true });
    const w = createWhy("own");
    w.add("out", { rule: "transfer.pair", other: "in" });
    const [row] = applyUse([out], accounts, new Map([["chk", { from: 0, to: 1, of: 1 }], ["sav", { from: 0, to: 0, of: 1 }]]), new Map(), undefined, w);
    expect(row).toMatchObject({ id: "out", category: "p2p", isTransfer: false });
    expect(w.of("out")).toEqual([{ rule: "transfer.pair", people: true, other: "in" }]);
    expect(sentenceOf(w.of("out")[0]!)).toBe("Rahansiirto henkilöiden välillä");
  });

  it("a collector belongs to one view: another view's explanation refuses it", () => {
    const koko = createWhy("household");
    expect(() => explain("spend.month", plain, argsOf(months[0]!, { why: koko }))).toThrow("another view");
    expect(() => explain("spend.month", plain, argsOf(months[0]!, { view: "household", why: koko }))).not.toThrow();
  });
});
