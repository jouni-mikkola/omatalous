/** One-offs have one owner (ADR 0005): the same sofa is struck by the insights, the change report and Optimoi. */
import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { createContext } from "../src/analysis/context.ts";
import { monthRows, purchasesWithoutOneOff } from "../src/analysis/insights/shared.ts";
import { largeIncome, largePurchases } from "../src/analysis/large.ts";
import { LARGE, LEVEL, monthOneOffs, oneOffs, PAY } from "../src/analysis/one-offs.ts";
import { completeMonthsBefore } from "../src/analysis/usual.ts";
import { addMonths, monthRange } from "../src/dates.ts";
import { levelWithoutOneOffs } from "../src/optimise/common.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const months = monthRange("2026-02", "2026-09");
const rows = [
  ...months.map((m) => tx({ bookingDate: `${m}-01`, amountCents: 300000, merchant: "Acme Oy", category: "salary" })),
  ...months.flatMap((m) => [3, 10, 17, 24].map((d) => tx({ bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -4000 - d * 10, merchant: "Sotka", category: "home" }))),
  tx({ id: "sofa", bookingDate: "2026-08-12", amountCents: -89000, merchant: "Sotka", category: "home" }),
];
const ctx = createContext(rows, [checking], "2026-10-11");

describe("one-offs", () => {
  it("the sofa in August is struck by the insights, the change report and Optimoi alike", () => {
    expect(monthOneOffs(ctx, "2026-08", completeMonthsBefore(ctx, "2026-08")).map((t) => t.id)).toEqual(["sofa"]);
    expect(monthRows(ctx, "2026-08").purchases - purchasesWithoutOneOff(ctx, "2026-08")).toBe(89000);
    expect(spendingChange(ctx, "usual", "2026-08")!.pieces.find((p) => p.kind === "oneoff")).toMatchObject({ category: "home", cents: 89000 });
    expect(levelWithoutOneOffs(ctx.txs.filter((t) => t.category === "home"), months).struck).toEqual(["sofa"]);
  });

  it("a sofa in a base month does not move the usual level of the month after", () => {
    const september = spendingChange(ctx, "usual", "2026-09")!;
    // the usual level is the struck months' 165,40 €, so September is no cheaper than usual
    expect(september.baseCents).toBe(16540);
    expect(september.pieces.filter((p) => p.category === "home")).toEqual([]);
  });

  it("bills set the usual ticket and are never struck; pay has its own policy", () => {
    const fixed = new Set(ctx.txs.filter((t) => t.merchant === "Sotka" && t.id !== "sofa").map((t) => t.id));
    expect([...oneOffs(ctx.txs, LEVEL, fixed)]).toEqual(["sofa"]);
    const pay = [1, 2, 3, 4, 5].map((i) => tx({ id: `p${i}`, bookingDate: `2026-0${i}-15`, amountCents: i === 4 ? 450000 : 300000, merchant: "Acme Oy", category: "salary" }));
    expect([...oneOffs(createContext(pay, [checking], "2026-10-11").txs, PAY)]).toEqual(["p4"]);
  });
});

describe("the large policy: a purchase made once, apart from the spending of the months", () => {
  const all = monthRange("2025-01", "2026-09");
  const pay = all.map((m) => tx({ bookingDate: `${m}-01`, amountCents: 300000, merchant: "Acme Oy", category: "salary" }));
  /** Eight purchases of `cents` in Koti ja elektroniikka, one a month from `from` on: up to July 2026 as it stands. */
  const rest = (cents: number, from = "2025-12") => monthRange(from, addMonths(from, 7)).map((m) => tx({ bookingDate: `${m}-09`, amountCents: -cents, merchant: "Sotka", category: "home" }));
  const sofa = (cents: number, over: Partial<Transaction> = {}) => tx({ id: "sofa", bookingDate: "2026-08-12", amountCents: -cents, merchant: "Esimerkki Oy", category: "home", ...over });
  const context = (rows: Transaction[]) => createContext([...pay, ...rows], [checking], "2026-10-11");
  const large = (rows: Transaction[]) => [...largePurchases(context(rows))];

  it("is at least 500 €: one cent under it is not large, whatever the category took", () => {
    expect(large([...rest(12500), sofa(50000)])).toEqual(["sofa"]);
    expect(large([...rest(12500), sofa(49999)])).toEqual([]);
  });

  it("is over a quarter of what the rest of its category took in the twelve months around it", () => {
    // the rest took 2 000 €: 500 € is a quarter of it and not over
    expect(large([...rest(25000), sofa(50000)])).toEqual([]);
    expect(large([...rest(25000), sofa(50001)])).toEqual(["sofa"]);
    // the spending of another category is no part of the rest
    expect(large([...rest(25000).map((t) => ({ ...t, category: "shopping" })), sofa(50000)])).toEqual(["sofa"]);
  });

  it("reads the rest from the twelve months around the row, and a year earlier says nothing", () => {
    // the same 2 000 € in January to August 2025: over a year before the row
    expect(large([...rest(25000, "2025-01"), sofa(50000)])).toEqual(["sofa"]);
    // a row in the first month of the history is set against the twelve months from it
    const early = sofa(50000, { bookingDate: "2025-01-12" });
    expect(large([...rest(25000, "2025-02"), early])).toEqual([]);
    expect(large([...rest(25000, "2026-01"), early])).toEqual(["sofa"]);
  });

  it("is never a row of a series: a 600 € subscription four times a year stays out, and would be large without its series", () => {
    const paper = ["2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05", "2026-08"].map((m) => tx({ bookingDate: `${m}-15`, amountCents: -60000, merchant: "Esimerkkilehti Oy", category: "subscriptions" }));
    const ctx = context(paper);
    expect(paper.every((t) => ctx.fixedIds.has(t.id))).toBe(true);
    expect([...largePurchases(ctx)]).toEqual([]);
    expect(oneOffs(ctx.txs, LARGE).size).toBe(paper.length);
    // the same holds for one row given as fixed
    expect([...oneOffs(context([...rest(12500), sofa(50000)]).txs, LARGE, new Set(["sofa"]))]).toEqual([]);
  });

  it("is never a loan payment, a card bill or a transfer, and a row of Auton osto always is one", () => {
    const never = [sofa(500000, { id: "loan", category: "loans" }), sofa(500000, { id: "bill", category: "card_bill" }), sofa(500000, { id: "move", category: "transfer", isTransfer: true })];
    expect(large(never)).toEqual([]);
    // 300 € a user put there, among eight payments of 18 900 € a month apart
    const car = context([sofa(30000, { id: "car", category: "vehicle_purchase", categorySource: "user" }), ...rest(1890000).map((t) => ({ ...t, category: "vehicle_purchase" }))]);
    expect(largePurchases(car).size).toBe(9);
    expect([...oneOffs(car.txs, LARGE, new Set(["car"]))]).toContain("car");
  });

  it("counts a purchase by what it cost in the end: money back takes it under the bound, and money in is no purchase", () => {
    const back = tx({ bookingDate: "2026-08-20", amountCents: 40000, merchant: "Esimerkki Oy", category: "home" });
    expect(large([...rest(12500), sofa(90000)])).toEqual(["sofa"]);
    // 900 € paid and 400 € back is a purchase of 500 €; one cent more back and it is under 500 €
    expect(large([...rest(12500), sofa(90000), back])).toEqual(["sofa"]);
    expect(large([...rest(12500), sofa(90000), { ...back, amountCents: 40001 }])).toEqual([]);
    expect(large([...rest(12500), { ...back, id: "in", amountCents: 500000, merchant: "Toinen Oy" }])).toEqual([]);
  });
});

describe("large income: a single row over the usual income of a month", () => {
  const all = monthRange("2025-01", "2026-09");
  const pay = (cents = 300000) => all.map((m) => tx({ bookingDate: `${m}-01`, amountCents: cents, merchant: "Acme Oy", category: "salary" }));
  const single = (cents: number, over: Partial<Transaction> = {}) => tx({ id: "single", bookingDate: "2026-08-12", amountCents: cents, merchant: "Esimerkki Oy", category: "income", ...over });
  const large = (rows: Transaction[]) => [...largeIncome(createContext(rows, [checking], "2026-10-11"))];

  it("is over the usual income of a month: the sum of a month of pay is not", () => {
    expect(large([...pay(), single(300001)])).toEqual(["single"]);
    expect(large([...pay(), single(300000)])).toEqual([]);
  });

  it("is never pay: not in its series, and not from a payer who pays on uneven days either", () => {
    expect(large(pay())).toEqual([]);
    // nine payments of 3 500 € from one payer on days no series holds: each is under a quarter of the others around it
    const days = ["2025-11-03", "2025-11-28", "2026-01-19", "2026-02-02", "2026-03-27", "2026-04-08", "2026-06-19", "2026-07-01", "2026-08-12"];
    const uneven = days.map((d, i) => single(350000, { id: `u${i}`, bookingDate: d }));
    const ctx = createContext([...pay(), ...uneven], [checking], "2026-10-11");
    expect(ctx.recurring.flatMap((s) => s.transactionIds).filter((id) => id.startsWith("u"))).toEqual([]);
    expect([...largeIncome(ctx)]).toEqual([]);
    // one of them alone is a single row
    expect(large([...pay(), uneven[8]!])).toEqual(["u8"]);
  });

  it("needs three complete months before it: earlier the usual income is not known", () => {
    expect(large([...pay(), single(900000, { bookingDate: "2025-03-12" })])).toEqual([]);
    expect(large([...pay(), single(900000, { bookingDate: "2025-04-12" })])).toEqual(["single"]);
  });

  it("is at least 500 € in a household with no income of its own", () => {
    const rent = all.map((m) => tx({ bookingDate: `${m}-02`, amountCents: -70000, merchant: "Sato", category: "housing" }));
    expect(large([...rent, single(50000)])).toEqual(["single"]);
    expect(large([...rent, single(49999)])).toEqual([]);
  });

  it("is no row of money back and no money out", () => {
    const bought = tx({ id: "bought", bookingDate: "2026-08-02", amountCents: -400000, merchant: "Esimerkki Oy", category: "home" });
    const ctx = createContext([...pay(), bought, single(400000, { category: "home" })], [checking], "2026-10-11");
    expect([...largeIncome(ctx)]).toEqual([]);
    // the purchase came back whole, so it is no large purchase either
    expect([...largePurchases(ctx)]).toEqual([]);
    expect(large([...pay(), bought])).toEqual([]);
  });
});
