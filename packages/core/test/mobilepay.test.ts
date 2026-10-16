import { describe, expect, it } from "vitest";
import { categoryTotals } from "../src/analysis/category-totals.ts";
import { createContext, spendRows } from "../src/analysis/context.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { sentenceOf } from "../src/explain/catalogue.ts";
import { createWhy } from "../src/explain/why.ts";
import { normalizeMerchant, serviceOf } from "../src/merchant.ts";
import { isUnnamedMobilePay, matchMobilePayShares } from "../src/mobilepay.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { matchReturns, pairedReturns } from "../src/returns.ts";
import { type Account, NO_INPUTS, type PayerInput, type Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const range = { from: "2026-09-01", to: "2026-09-30" };
const eur = (euros: number) => Math.round(euros * 100);

/** A purchase by card at a place the rules know as a restaurant. */
const dinner = (id: string, date: string, euros: number): Transaction =>
  tx({ id, bookingDate: date, amountCents: -eur(euros), merchant: "Hesburger", counterparty: "HESBURGER", description: "KORTTIOSTO" });
/** MobilePay money in that names no sender. */
const friend = (id: string, date: string, euros: number): Transaction =>
  tx({ id, bookingDate: date, amountCents: eur(euros), merchant: normalizeMerchant(null, "Tiedot MobilePay-sovelluksessa"), counterparty: null, description: "Tiedot MobilePay-sovelluksessa" });

const run = (rows: Transaction[], payers?: PayerInput) => {
  const changed = new Map(enrichTransactions(rows, [checking], [], new Map(), payers).map((t) => [t.id, t]));
  return rows.map((t) => ({ ...t, ...changed.get(t.id) }));
};
const spendOf = (rows: Transaction[], category: string) => categoryReport(createContext(rows, [checking], "2026-10-09"), range).groups.flatMap((g) => g.categories).find((c) => c.category === category)?.totalCents ?? 0;
const incomeOf = (rows: Transaction[]) => createContext(rows, [checking], "2026-10-09").txs.reduce((sum, t) => sum + t.flows.income, 0);
const matchedOf = (rows: Transaction[]) => Object.fromEntries(rows.filter((t) => t.categorySource === "match").map((t) => [t.id, t.category]));

describe("the payment service in a row", () => {
  it.each([
    ["PAYPAL *SPOTIFY", "Spotify", "PayPal"],
    ["SUMUP *KAHVILA X", "Kahvila X", "SumUp"],
    ["ZETTLE_*PUOTI Y", "Puoti Y", "Zettle"],
    ["KLARNA*ZALANDO", "Zalando", "Klarna"],
    ["PAYTRAIL OY/VERKKOKAUPPA Z", "Verkkokauppa Z", "Paytrail"],
    ["SQ *SHOP", "Shop", "Square"],
    ["VIPPS*NAME", "Name", "Vipps"],
    ["MOBILEPAY *NAME", "Name", "MobilePay"],
    ["MOBILEPAY ESIMERKKI OY", "Esimerkki", "MobilePay"],
    ["SVEA PAYMENTS*ESIMERKKI", "Esimerkki", "Svea Payments"],
    ["CHECKOUT FINLAND*ESIMERKKI", "Esimerkki", "Checkout Finland"],
  ])("%s: the shop is %s, the service %s", (text, merchant, service) => {
    expect([normalizeMerchant(text, null), serviceOf(text, null)]).toEqual([merchant, service]);
  });

  it("a person behind MobilePay without a star keeps the wallet's word in the merchant, the service is still told", () => {
    expect([normalizeMerchant("MobilePay Matti Meikalainen", null), serviceOf("MobilePay Matti Meikalainen", null)]).toEqual(["Mobilepay Matti Meikalainen", "MobilePay"]);
  });

  it("Trustly: the word of the text is the shop, a reference alone leaves the service", () => {
    expect(normalizeMerchant("Trustly Group AB", "Viite 99887 Kahvila Esimerkki")).toBe("Kahvila Esimerkki");
    expect(normalizeMerchant("TRUSTLY GROUP AB", "Ref 12345 ESIMERKKI")).toBe("Esimerkki");
    expect(normalizeMerchant("TRUSTLY GROUP AB", "Viite 99887")).toBe("Trustly");
    expect(normalizeMerchant("Trustly Group AB", null)).toBe("Trustly");
    expect(serviceOf("Trustly Group AB", "Viite 99887 Kahvila Esimerkki")).toBe("Trustly");
  });

  it("the shop behind a service goes through the normal chain: its category comes from the shop", () => {
    const [a, b] = run([
      tx({ bookingDate: "2026-09-05", amountCents: -eur(12), merchant: normalizeMerchant("PAYPAL *SPOTIFY", null), counterparty: "PAYPAL *SPOTIFY" }),
      tx({ bookingDate: "2026-09-05", amountCents: -eur(30), merchant: normalizeMerchant("Trustly Group AB", "Viite 99887 Hesburger"), counterparty: "Trustly Group AB", description: "Viite 99887 Hesburger" }),
    ]);
    expect([a!.category, b!.category, b!.merchant]).toEqual(["subscriptions", "restaurants", "Hesburger"]);
  });

  it("no shop found: the row stays with the service under one merchant, and is asked once per service", () => {
    const rows = run([
      ...[1, 2, 3].map((d) => tx({ bookingDate: `2026-09-0${d}`, amountCents: -eur(40), merchant: normalizeMerchant("TRUSTLY GROUP AB", `Viite 1234${d}`), counterparty: "TRUSTLY GROUP AB", description: `Viite 1234${d}` })),
      tx({ bookingDate: "2026-09-04", amountCents: -eur(20), merchant: "PayPal", counterparty: "PAYPAL" }),
    ]);
    expect(new Set(rows.map((t) => t.merchant))).toEqual(new Set(["Trustly", "PayPal"]));
    const items = buildQuestions(createContext(rows, [checking], "2026-10-09"), { from: "2026-09-01", to: "2026-10-09" }, NO_INPUTS).items;
    expect(items.map((i) => (i.kind === "payee_out" ? [i.service, i.count, i.cents] : null))).toEqual([["Trustly", 3, 12000], ["PayPal", 1, 2000]]);
  });

  it("MobilePay to a person is a transfer to a person, to a company the normal chain", () => {
    const [person, company, brand] = run([
      tx({ bookingDate: "2026-09-05", amountCents: -eur(20), merchant: normalizeMerchant("MobilePay Matti Meikalainen", null), counterparty: "MobilePay Matti Meikalainen" }),
      tx({ bookingDate: "2026-09-05", amountCents: -eur(20), merchant: normalizeMerchant("MOBILEPAY *ESIMERKKI OY", null), counterparty: "MOBILEPAY *ESIMERKKI OY" }),
      tx({ bookingDate: "2026-09-05", amountCents: -eur(20), merchant: normalizeMerchant("MOBILEPAY *HESBURGER OY", null), counterparty: "MOBILEPAY *HESBURGER OY" }),
    ]);
    expect([person!.category, company!.category, company!.merchant, brand!.category]).toEqual(["p2p", "other", "Esimerkki", "restaurants"]);
  });
});

describe("unnamed MobilePay money in", () => {
  it("is read by the words around the wallet, a name in the text makes it a person's", () => {
    expect(isUnnamedMobilePay({ counterparty: null, description: "Tiedot MobilePay-sovelluksessa" })).toBe(true);
    expect(isUnnamedMobilePay({ counterparty: "MobilePay", description: null })).toBe(true);
    expect(isUnnamedMobilePay({ counterparty: "LIISA VIRTANEN", description: "MOBILEPAY" })).toBe(false);
    expect(isUnnamedMobilePay({ counterparty: null, description: "Tiedot MobilePay-sovelluksessa Liisa Virtanen" })).toBe(false);
    expect(isUnnamedMobilePay({ counterparty: null, description: "Tiedot sovelluksessa" })).toBe(false);
  });
});

describe("shares that friends send back by MobilePay", () => {
  it("one dinner paid, three friends send a quarter each: the category is left with the quarter and the income with none", () => {
    const rows = [dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25), friend("c", "2026-09-06", 25)];
    const final = run(rows);
    expect(final[0]!.category).toBe("restaurants");
    expect(matchedOf(final)).toEqual({ a: "restaurants", b: "restaurants", c: "restaurants" });
    // new = old - net: the same rows without the friends cost 100 euros, the netted sum is 75
    expect([spendOf(run(rows.slice(0, 1)), "restaurants"), spendOf(final, "restaurants")]).toEqual([10000, 2500]);
    expect(incomeOf(final)).toBe(0);
    expect([...pairedReturns(final)].sort()).toEqual([["a", "p"], ["b", "p"], ["c", "p"]]);
  });

  it("the friends' rows stay income when nothing was bought before them", () => {
    const final = run([friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25)]);
    expect(matchedOf(final)).toEqual({});
    expect(incomeOf(final)).toBe(5000);
  });

  it("two purchases the same day: the share goes to the one it divides", () => {
    const rows = [dinner("big", "2026-09-03", 100), tx({ id: "shop", bookingDate: "2026-09-03", amountCents: -4000, merchant: "Prisma", counterparty: "PRISMA", description: "KORTTIOSTO" }), friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25)];
    const final = run(rows);
    expect([...pairedReturns(final)].sort()).toEqual([["a", "big"], ["b", "big"]]);
    expect(spendOf(final, "groceries")).toBe(4000);
  });

  it("two purchases that both fit: the nearer in time, then the larger", () => {
    const buys = [{ id: "big", day: 100, cents: 10000 }, { id: "small", day: 100, cents: 5000 }, { id: "later", day: 101, cents: 2500 }];
    expect([...matchMobilePayShares(buys.slice(0, 2), [{ id: "a", day: 101, cents: 2500 }])]).toEqual([["a", "big"]]);
    // 12,50 is a fifth of 62,50 and a quarter of 50: the purchase one day nearer wins over the larger
    expect([...matchMobilePayShares([{ id: "far", day: 100, cents: 10000 }, { id: "near", day: 102, cents: 5000 }], [{ id: "a", day: 103, cents: 2500 }])]).toEqual([["a", "near"]]);
    expect(matchMobilePayShares(buys.slice(2), [{ id: "a", day: 101, cents: 1250 }]).size).toBe(1);
  });

  it("a row 7 days after matches, one 8 days after does not, and nor does one before", () => {
    const at = (day: string) => matchedOf(run([dinner("p", "2026-09-03", 100), friend("a", day, 25)]));
    expect([at("2026-09-10"), at("2026-09-11"), at("2026-09-02")]).toEqual([{ a: "restaurants" }, {}, {}]);
  });

  it("a sum not near any share does not match, one within a euro does", () => {
    const at = (euros: number) => Object.keys(matchedOf(run([dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", euros)]))).length;
    expect([at(22), at(24), at(26), at(27.5), at(16.7), at(18.5)]).toEqual([0, 1, 1, 0, 1, 0]);
    // a row that is as large as the purchase is no share
    expect(at(100)).toBe(0);
  });

  it("rows that are no share alone but together come to the others' part of the purchase match", () => {
    const rows = [dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 40), friend("b", "2026-09-05", 35)];
    expect(Object.keys(matchedOf(run(rows)))).toEqual(["a", "b"]);
    // one such row alone, or two that do not add up, are not matched
    expect(Object.keys(matchedOf(run(rows.slice(0, 2))))).toEqual([]);
    expect(Object.keys(matchedOf(run([rows[0]!, rows[1]!, friend("b", "2026-09-05", 30)])))).toEqual([]);
  });

  it("shares never exceed the purchase, and a row nets against one purchase only", () => {
    const rows = [dinner("p", "2026-09-03", 100), ...["a", "b", "c", "d", "e"].map((id) => friend(id, "2026-09-04", 25))];
    expect(Object.keys(matchedOf(run(rows)))).toEqual(["a", "b", "c"]);
    const m = matchMobilePayShares([{ id: "p1", day: 10, cents: 10000 }, { id: "p2", day: 10, cents: 10000 }], ["a", "b", "c", "d"].map((id) => ({ id, day: 11, cents: 2500 })));
    expect([...m.values()].filter((p) => p === "p1").length + [...m.values()].filter((p) => p === "p2").length).toBe(m.size);
    expect(m.size).toBe(4);
  });

  it("a bill, cash, a card bill and a payment to a person are no shared purchase", () => {
    for (const category of ["housing", "utilities", "cash", "card_bill", "p2p"]) {
      const rows = [tx({ id: "p", bookingDate: "2026-09-03", amountCents: -10000, merchant: "Zxq Tmi", category, categorySource: "rule" }), friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25)];
      expect(matchReturns(rows).size, category).toBe(0);
    }
  });

  it("a later row never moves a match made already", () => {
    const before = [dinner("p1", "2026-09-03", 100), dinner("p2", "2026-09-05", 60), friend("a", "2026-09-06", 25), friend("b", "2026-09-06", 15)];
    const first = matchReturns(run(before));
    const second = matchReturns(run([...before, friend("c", "2026-09-09", 25), friend("d", "2026-09-10", 15), friend("e", "2026-09-12", 25)]));
    for (const [id, purchase] of first) expect(second.get(id), id).toBe(purchase);
    // and the same rows in another order give the same pairs
    expect([...matchReturns([...run(before)].reverse())].sort()).toEqual([...first].sort());
  });

  it("a user's answer on the payer wins and sticks, for the rows it has now and the ones that come", () => {
    const rows = [dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25)];
    const payers: PayerInput = { memberId: "m", roles: [{ scope: "member", userId: "m", counterpartyKey: "name:MOBILEPAY", role: "sales" }] };
    const final = run(rows, payers);
    expect(final.filter((t) => t.categorySource === "payer").map((t) => [t.id, t.category])).toEqual([["a", "sales"], ["b", "sales"]]);
    expect(spendOf(final, "restaurants")).toBe(10000);
    // a row that comes later is the same payer's
    const later = run([...rows, friend("c", "2026-09-05", 25)], payers);
    expect(later.find((t) => t.id === "c")!.category).toBe("sales");
  });

  it("a row the user categorised is left as it is", () => {
    const rows = [dinner("p", "2026-09-03", 100), { ...friend("a", "2026-09-04", 25), category: "income", categorySource: "user" as const }, friend("b", "2026-09-04", 25)];
    const final = run(rows);
    expect([final[1]!.category, final[1]!.categorySource]).toEqual(["income", "user"]);
  });

  it("running again changes nothing", () => {
    const rows = [dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 25), friend("b", "2026-09-04", 25), friend("c", "2026-09-06", 7)];
    const once = run(rows);
    expect(enrichTransactions(once, [checking], [])).toEqual([]);
    expect(matchedOf(once)).toEqual({ a: "restaurants", b: "restaurants" });
  });
});

describe("MobilePay money answered as shares of shared purchases", () => {
  const share: PayerInput = { memberId: "m", roles: [{ scope: "member", userId: "m", counterpartyKey: "name:MOBILEPAY", role: "cost_share" }] };
  const gift: PayerInput = { memberId: "m", roles: [{ scope: "member", userId: "m", counterpartyKey: "name:MOBILEPAY", role: "gift" }] };
  const shop = (id: string, date: string, euros: number) => tx({ id, bookingDate: date, amountCents: -eur(euros), merchant: "Prisma", counterparty: "PRISMA", description: "KORTTIOSTO" });
  // a category the user set stays as it is
  const set = (id: string, date: string, euros: number, category: string) => tx({ id, bookingDate: date, amountCents: -eur(euros), merchant: "Zxq Tmi", category, categorySource: "user" });

  it("the rows are no income: the totals move by their sum from income to a lower spending", () => {
    // 30 euros is no share of 100 (a third is 33,33), so the matcher leaves it for the answer
    const rows = [dinner("p", "2026-09-03", 100), friend("x", "2026-09-10", 30)];
    const [open, answered] = [run(rows), run(rows, share)];
    expect([incomeOf(open), spendOf(open, "restaurants")]).toEqual([3000, 10000]);
    expect([incomeOf(answered), spendOf(answered, "restaurants")]).toEqual([0, 7000]);
    expect(answered[1]).toMatchObject({ category: "restaurants", categorySource: "payer" });
  });

  it("nets against the nearest purchase before it, 14 days at most, bills and people not counted", () => {
    const at = (day: string, ...buys: Transaction[]) => run([...buys, friend("x", day, 30)], share).find((t) => t.id === "x")!.category;
    expect(at("2026-09-10", dinner("p", "2026-09-03", 100), shop("g", "2026-09-08", 40))).toBe("groceries");
    expect(at("2026-09-10", dinner("p", "2026-09-03", 100), shop("g", "2026-09-08", 40), set("h", "2026-09-09", 500, "housing"), set("c", "2026-09-09", 50, "cash"))).toBe("groceries");
    expect(at("2026-09-17", dinner("p", "2026-09-03", 100))).toBe("restaurants");
    expect(at("2026-09-18", dinner("p", "2026-09-03", 100))).toBe("other");
    expect(at("2026-09-02", dinner("p", "2026-09-03", 100))).toBe("other");
  });

  it("with no purchase it is returned spending in Muut menot, never income", () => {
    const final = run([friend("x", "2026-09-10", 30)], share);
    expect([final[0]!.category, incomeOf(final), spendOf(final, "other")]).toEqual(["other", 0, -3000]);
  });

  it("another answer keeps its meaning: other income stays income", () => {
    const final = run([dinner("p", "2026-09-03", 100), friend("x", "2026-09-10", 30)], gift);
    expect([final[1]!.category, incomeOf(final), spendOf(final, "restaurants")]).toEqual(["p2p_in", 3000, 10000]);
  });

  it("says which purchase, or that it is a share of shared purchases", () => {
    const why = createWhy("own");
    const rows = [dinner("p", "2026-09-03", 100), friend("x", "2026-09-10", 30), friend("y", "2026-09-30", 5)];
    enrichTransactions(rows, [checking], [], new Map(), share, why);
    expect(why.of("x")).toContainEqual({ rule: "return.wallet", purchase: "p", day: "2026-09-03" });
    expect(why.of("y")).toContainEqual({ rule: "share.open" });
    expect(why.of("p")).toContainEqual({ rule: "share.back", cents: 3000, count: 1 });
    expect(sentenceOf({ rule: "share.open" })).toBe("Osuus yhteisistä ostoista");
  });

  it("running again changes nothing, and the full run is asked for", () => {
    const rows = [dinner("p", "2026-09-03", 100), friend("x", "2026-09-10", 30)];
    expect(enrichTransactions(run(rows, share), [checking], [], new Map(), share)).toEqual([]);
    const stored = run(rows, share);
    const result = enrichIsland({ rows: [stored[0]!], before: new Map(), accounts: [checking], rules: [], oldRules: [], industries: new Map(), outsideMatches: [], payers: share });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("MobilePay shares") });
  });
});

describe("what the panel says", () => {
  it("a netted row says which purchase it paid a share of, the purchase what came back, a row its service", () => {
    const why = createWhy("own");
    const rows = [dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 25), friend("b", "2026-09-05", 25.5), tx({ id: "s", bookingDate: "2026-09-06", amountCents: -1200, merchant: "Spotify", counterparty: "PAYPAL *SPOTIFY" })];
    enrichTransactions(rows, [checking], [], new Map(), undefined, why);
    expect(why.of("a")).toContainEqual({ rule: "return.wallet", purchase: "p", day: "2026-09-03" });
    expect(sentenceOf({ rule: "return.wallet", purchase: "p", day: "2026-09-03", shop: "Hesburger" })).toBe("Osuus ostoksesta Hesburger 3.9.2026");
    expect(why.of("p")).toContainEqual({ rule: "share.back", cents: 5050, count: 2 });
    expect(sentenceOf({ rule: "share.back", cents: 5050, count: 2 }).replace(/\s/g, " ")).toBe("Takaisin saatu 50,50 € (2 maksua)");
    expect(sentenceOf({ rule: "share.back", cents: 2500, count: 1 }).replace(/\s/g, " ")).toBe("Takaisin saatu 25,00 € (1 maksu)");
    expect(sentenceOf({ rule: "share.back", cents: 7500, count: 3 }).replace(/\s/g, " ")).toBe("Takaisin saatu 75,00 € (3 maksua)");
    expect(why.of("s")).toContainEqual({ rule: "via.service", service: "PayPal" });
    expect(sentenceOf({ rule: "via.service", service: "PayPal" })).toBe("Maksettu palvelun PayPal kautta");
  });
});

describe("what is left is asked once", () => {
  const today = "2026-10-09";
  const asked = (rows: Transaction[], payers?: PayerInput) => buildQuestions(createContext(run(rows, payers), [checking], today), { from: "2026-09-01", to: today }, { ...NO_INPUTS, ...(payers ? { payers } : {}) }).items;

  it("unmatched MobilePay money in is one question with the three answers' roles, never one per row", () => {
    const rows = [friend("a", "2026-09-04", 60), friend("b", "2026-09-15", 70), friend("c", "2026-09-20", 80)];
    const items = asked(rows, { memberId: "m", roles: [] }).filter((i) => i.kind === "payer");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "name:MOBILEPAY", count: 3, cents: 21000, wallet: true, options: ["cost_share", "sales", "gift"] });
  });

  it("matched rows are not in the question, an answered group is not asked again", () => {
    const rows = [dinner("p", "2026-09-03", 400), friend("a", "2026-09-04", 100), friend("b", "2026-09-04", 100), friend("c", "2026-09-04", 100), friend("x", "2026-09-20", 190)];
    expect(asked(rows, { memberId: "m", roles: [] }).filter((i) => i.kind === "payer")).toMatchObject([{ count: 1, cents: 19000 }]);
    const answered: PayerInput = { memberId: "m", roles: [{ scope: "member", userId: "m", counterpartyKey: "name:MOBILEPAY", role: "sales" }] };
    expect(asked(rows, answered).filter((i) => i.kind === "payer")).toEqual([]);
  });
});

describe("one merchant's rows after a change", () => {
  const stored = run([dinner("p", "2026-09-03", 100), friend("a", "2026-09-04", 22), friend("b", "2026-09-04", 24)]);
  const p = stored[0]!;
  const island = (matched: { bookingDate: string; amountCents: number; wallet: boolean }) =>
    enrichIsland({
      rows: [{ ...p, category: "groceries", categorySource: "user" }],
      before: new Map([[p.id, { category: p.category, categorySource: p.categorySource }]]),
      accounts: [checking],
      rules: [],
      oldRules: [],
      industries: new Map(),
      outsideMatches: [{ accountId: p.accountId, ...matched }],
    });

  it("the full run answers when a MobilePay share outside follows the purchase, whatever its sum", () => {
    expect(island({ bookingDate: "2026-09-04", amountCents: 2200, wallet: true }).ok).toBe(false);
    // near misses: the same row of another kind, or a MobilePay share a week and a day later
    expect(island({ bookingDate: "2026-09-04", amountCents: 2200, wallet: false }).ok).toBe(true);
    expect(island({ bookingDate: "2026-09-11", amountCents: 2200, wallet: true }).ok).toBe(true);
  });

  it("the full run answers when a purchase becomes one a share may be set against", () => {
    const rule = { id: 1, field: "merchant_exact" as const, pattern: "Hesburger", category: "housing", priority: 5 };
    const rows = [dinner("p", "2026-09-03", 100)];
    const billed = rows.map((t) => ({ ...t, ...enrichTransactions(rows, [checking], [rule]).find((c) => c.id === t.id) }));
    expect(billed[0]!.category).toBe("housing");
    const result = enrichIsland({ rows: billed, before: new Map(), accounts: [checking], rules: [], oldRules: [rule], industries: new Map(), outsideMatches: [] });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("MobilePay shares") });
  });
});

describe("a lease that ends in a refund and MobilePay shares around a dinner", () => {
  const LESSOR = { merchant: "ESIMERKKI LEASING OY", counterparty: "ESIMERKKI LEASING OY" };
  const lease = (): Transaction[] => [
    tx({ bookingDate: "2024-01-05", amountCents: -300000, category: "leasing", categorySource: "user", ...LESSOR }),
    ...series("2024-02-05", 30.44, 24, -39900, { category: "leasing", categorySource: "user", ...LESSOR }),
  ];
  const refund = tx({ id: "refund", bookingDate: "2026-02-12", amountCents: 180000, category: "income", categorySource: "default", ...LESSOR });
  const day = tx({ bookingDate: "2026-10-08", amountCents: -1500, merchant: "Prisma", category: "groceries" });
  const dinnerRows = () => [dinner("p", "2026-02-10", 100), friend("a", "2026-02-11", 25), friend("b", "2026-02-11", 25), friend("c", "2026-02-13", 25)];
  const totals = (rows: Transaction[]) => {
    const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    const ctx = createContext(rows.map((t) => changed.get(t.id) ?? t), [checking], "2026-10-09");
    const counted = spendRows(ctx, { fromDay: -1e9, toDay: 1e9 });
    const by = (c: string) => categoryTotals(counted).find((x) => x.category === c)?.cents ?? 0;
    return { income: counted.reduce((sum, t) => sum + t.flows.income, 0), leasing: by("leasing"), restaurants: by("restaurants"), changed };
  };

  it("each is netted once and against its own: the refund against the lease, the shares against the dinner", () => {
    const plain = totals([...lease(), day]);
    const both = totals([...lease(), refund, ...dinnerRows(), day]);
    // the refund takes 1800 euros off the lease, the three shares 75 euros off the dinner, and no income is left
    expect([both.leasing, both.restaurants, both.income]).toEqual([plain.leasing - 180000, 2500, 0]);
    expect(both.changed.get("refund")).toMatchObject({ category: "leasing", categorySource: "match" });
    for (const id of ["a", "b", "c"]) expect(both.changed.get(id)).toMatchObject({ category: "restaurants", categorySource: "match" });
    // the same rows one kind at a time give the same figures
    expect(totals([...lease(), refund, day]).leasing).toBe(both.leasing);
    expect(totals([...dinnerRows(), day]).restaurants).toBe(both.restaurants);
  });
});
