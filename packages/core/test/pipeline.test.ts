import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { flowsOf } from "../src/analysis/flows.ts";
import { previousRange } from "../src/analysis/period.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { addDays, addMonths } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "savings" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

describe("enrichTransactions", () => {
  it("does not double count a credit card bill when the card account is connected", () => {
    const txs = [
      tx({ accountId: "card", bookingDate: "2026-09-03", amountCents: -4200, merchant: "Wolt", description: "WOLT" }),
      tx({ accountId: "card", bookingDate: "2026-09-10", amountCents: -8000, merchant: "Prisma", description: "PRISMA" }),
      tx({ accountId: "chk", bookingDate: "2026-09-20", amountCents: -12200, merchant: "Nordea", description: "LUOTTOKORTIN LASKU" }),
      tx({ accountId: "card", bookingDate: "2026-09-21", amountCents: 12200, merchant: "Nordea", description: "MAKSU KIITOS" }),
    ];
    const changed = new Map(enrichTransactions(txs, [checking, card], []).map((t) => [t.id, t]));
    const final = txs.map((t) => changed.get(t.id) ?? t);
    expect(final.map((t) => t.category)).toEqual(["food_delivery", "groceries", "transfer", "transfer"]);
    expect(final.reduce((s, t) => s + flowsOf(t, new Set()).consumption, 0)).toBe(12200);
  });

  it("counts the card bill as spending when the card account is not connected", () => {
    const bill = tx({ accountId: "chk", bookingDate: "2026-09-20", amountCents: -12200, description: "LUOTTOKORTIN LASKU" });
    const [enriched] = enrichTransactions([bill], [checking], []);
    expect(enriched).toMatchObject({ category: "card_bill", isTransfer: false });
  });

  it("pairs transfers between own accounts and by IBAN", () => {
    const txs = [
      tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -50000, counterparty: "Matti Meikäläinen", merchant: "Matti Meikäläinen" }),
      tx({ accountId: "sav", bookingDate: "2026-09-02", amountCents: 50000, counterparty: "Matti Meikäläinen", merchant: "Matti Meikäläinen" }),
      tx({ accountId: "chk", bookingDate: "2026-09-05", amountCents: -10000, counterpartyIban: "FI1410093000123458", merchant: "X" }),
    ];
    const changed = enrichTransactions(txs, [checking, savings], []);
    expect(changed.every((t) => t.isTransfer)).toBe(true);
    expect(changed).toHaveLength(3);
  });

  it("never overrides a category the user chose", () => {
    const t = tx({ bookingDate: "2026-09-01", amountCents: -2000, merchant: "Wolt", category: "restaurants", categorySource: "user" });
    expect(enrichTransactions([t], [checking], [])).toEqual([]);
  });
});

describe("buildDashboard", () => {
  it("summarises a period against the previous one", () => {
    const txs = [
      tx({ bookingDate: "2026-08-25", amountCents: 300000, category: "salary", merchant: "Acme" }),
      tx({ bookingDate: "2026-08-10", amountCents: -40000, category: "groceries", merchant: "Prisma" }),
      tx({ bookingDate: "2026-09-25", amountCents: 300000, category: "salary", merchant: "Acme" }),
      tx({ bookingDate: "2026-09-10", amountCents: -60000, category: "groceries", merchant: "Prisma" }),
      tx({ bookingDate: "2026-09-12", amountCents: -20000, category: "restaurants", merchant: "Ravintola" }),
      tx({ bookingDate: "2026-09-14", amountCents: -99000, category: "transfer", merchant: "Säästö", isTransfer: true }),
    ];
    const d = buildDashboard(createContext(txs, [checking], "2026-10-09"), { from: "2026-09-01", to: "2026-09-30" });
    expect(d.totals).toMatchObject({ incomeCents: 300000, expenseCents: 80000, netCents: 220000 });
    expect(d.previousTotals.expenseCents).toBe(40000);
    expect(d.categories[0]).toMatchObject({ category: "groceries", cents: 60000, previousCents: 40000 });
    expect(d.trend.months).toHaveLength(12);
    expect(d.trend.expenses.at(-1)).toBe(80000);
    // August starts mid-month in the history, September has ended and is fully covered
    expect(d.trend.complete.slice(-2)).toEqual([false, true]);
    expect(d.pace.currentTotal).toBe(80000);
    // the history starts on 10.8., so August is not a full previous period
    expect(d).toMatchObject({ comparable: false, dataFrom: "2026-08-10" });
    expect(d.insights.some((i: { id: string }) => i.id.startsWith("swing:"))).toBe(false);
  });
});

describe("dashboard, next level", () => {
  const today = "2026-10-09";
  /** Insight texts with ordinary spaces: euro amounts carry no-break spaces. */
  const plain = <T extends { title: string; detail: string }>(i: T | undefined) => i && { ...i, title: i.title.replace(/\s/g, " "), detail: i.detail.replace(/\s/g, " ") };
  /** `count` rows on day `day` of consecutive months from `firstMonth`. */
  const monthly = (firstMonth: string, day: number, count: number, cents: number | ((i: number) => number), partial: Partial<Transaction>) =>
    Array.from({ length: count }, (_, i) =>
      tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: typeof cents === "number" ? cents : cents(i) }),
    ).filter((t) => t.bookingDate <= today);
  const base = () => [
    ...monthly("2025-09", 25, 14, 300000, { merchant: "Acme", category: "salary" }),
    ...monthly("2025-09", 2, 14, -95000, { merchant: "Sato", category: "housing" }),
    ...monthly("2025-09", 11, 14, -1199, { merchant: "Spotify", category: "subscriptions" }),
    ...[3, 10, 17, 24].flatMap((d) => monthly("2025-09", d, 14, (i) => -(7000 + ((i + d) % 4) * 1500), { merchant: "Prisma", category: "groceries" })),
  ];

  it("a month swings only outside its usual months, never uncategorised or a moved bill", () => {
    const txs = [
      ...base(),
      // two dinners a month at 40 €, then at 90 € in September
      ...[5, 15].flatMap((d) => monthly("2026-03", d, 7, (i) => (i < 6 ? -4000 : -9000), { merchant: "Ravintola", category: "restaurants" })),
      // one bill moving from August to September
      tx({ bookingDate: "2026-08-30", amountCents: -20000, merchant: "Vakuutus", category: "insurance" }),
      tx({ bookingDate: "2026-09-01", amountCents: -60000, merchant: "Vakuutus", category: "insurance" }),
      tx({ bookingDate: "2026-08-06", amountCents: -5000, merchant: "X", category: "other" }),
      tx({ bookingDate: "2026-08-07", amountCents: -5000, merchant: "Y", category: "other" }),
      tx({ bookingDate: "2026-09-06", amountCents: -50000, merchant: "X", category: "other" }),
      tx({ bookingDate: "2026-09-07", amountCents: -50000, merchant: "Y", category: "other" }),
    ];
    const ctx = createContext(txs, [checking], today);
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.insights.filter((i) => i.id.startsWith("swing:")).map(plain)).toEqual([
      { id: "swing:restaurants", tone: "warning", title: "Ravintolat ja kahvilat +125 %", detail: "180 €, tavallisesti noin 80 € kuussa." },
    ]);
    // groceries vary from week to week, but September is inside the months before it
    expect(d.insights.some((i) => i.id === "swing:groceries")).toBe(false);
    expect(d.insights.length).toBeLessThanOrEqual(5);
    // the tiles show savings, the insights do not repeat them
    expect(d.insights.some((i) => i.id === "saved" || i.id === "savings-rate")).toBe(false);
    // a running month is not over: no swings, the pace chart tells how it goes
    expect(buildDashboard(ctx, { from: "2026-10-01", to: today }).insights.some((i) => i.id.startsWith("swing:"))).toBe(false);
  });

  it("a longer period swings against the previous one", () => {
    const txs = [...base(), ...[5, 15].flatMap((d) => monthly("2026-01", d, 9, (i) => (i < 6 ? -4000 : -9000), { merchant: "Ravintola", category: "restaurants" }))];
    const d = buildDashboard(createContext(txs, [checking], today), { from: "2026-07-01", to: "2026-09-30" });
    expect(plain(d.insights.find((i) => i.id === "swing:restaurants"))).toMatchObject({ title: "Ravintolat ja kahvilat +125 %", detail: "Nyt 540 €, edellisellä jaksolla 240 €." });
  });

  it("forecasts the running month from spending so far, bills to come and the usual days", () => {
    const ctx = createContext(base(), [checking], today);
    const d = buildDashboard(ctx, { from: "2026-10-01", to: today });
    const f = d.forecast!;
    expect(f.month).toBe("2026-10");
    // rent on 2.10. and groceries on 3.10.
    const spent = ctx.txs.filter((t) => t.bookingDate >= "2026-10-01").reduce((s, t) => s + t.spend, 0);
    expect(f.spentCents).toBe(spent);
    expect(f.upcoming).toEqual([{ merchant: "Spotify", category: "subscriptions", amountCents: 1199, date: "2026-10-11" }]);
    expect(f.forecastCents).toBeGreaterThan(spent + 1199);
    const full = d.trend.expenses.filter((_, i) => d.trend.complete[i]);
    expect(f.averageMonthCents).toBe(Math.round(full.reduce((s, v) => s + v, 0) / full.length));
    // a past period has no forecast
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }).forecast).toBeNull();
  });

  it("a running month is compared with the same days of the previous month", () => {
    const txs = [
      tx({ bookingDate: "2026-09-05", amountCents: -10000, category: "groceries", merchant: "Prisma" }),
      tx({ bookingDate: "2026-09-20", amountCents: -50000, category: "groceries", merchant: "Prisma" }),
      tx({ bookingDate: "2026-09-15", amountCents: 300000, category: "salary", merchant: "Acme" }),
      tx({ bookingDate: "2026-10-05", amountCents: -20000, category: "groceries", merchant: "Prisma" }),
    ];
    const ctx = createContext([...base(), ...txs], [checking], today);
    const d = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" });
    expect(d.running).toBe(true);
    expect(d.range).toMatchObject({ previousFrom: "2026-09-01", previousTo: "2026-09-09" });
    expect(d.previousTotals.incomeCents).toBe(0);
    expect(d.categories.find((c) => c.category === "groceries")!.previousCents).toBe(
      ctx.txs.filter((t) => t.category === "groceries" && t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-09").reduce((s, t) => s + t.spend, 0),
    );
    // the overview sends to = today; that runs too, with the same cut
    const toToday = buildDashboard(ctx, { from: "2026-10-01", to: today });
    expect(toToday.running).toBe(true);
    expect(toToday.range.previousTo).toBe("2026-09-09");
  });

  it("a complete month is compared with the whole previous month and is not running", () => {
    const ctx = createContext(base(), [checking], today);
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.running).toBe(false);
    expect(d.range).toMatchObject({ previousFrom: "2026-08-01", previousTo: "2026-08-31" });
    expect(buildDashboard(ctx, { from: "2026-05-01", to: "2026-05-31" }).running).toBe(false);
    expect(buildDashboard(ctx, { from: "2026-11-01", to: "2026-11-30" }).running).toBe(false);
  });

  it("the trend carries the same months a year earlier", () => {
    const d = buildDashboard(createContext(base(), [checking], today), { from: "2026-10-01", to: today });
    expect(d.trend.months[0]).toBe("2025-11");
    const sept = d.trend.months.indexOf("2026-09");
    const lastSept = base().filter((t) => t.bookingDate.startsWith("2025-09")).reduce((s, t) => s + Math.max(0, -t.amountCents), 0);
    expect(d.trend.lastYear.expenses[sept]).toBe(lastSept);
    expect(d.trend.lastYear.expenses[0]).toBe(0); // November 2024: no data
    expect(Object.keys(d.trend.lastYear.series)).toEqual(expect.arrayContaining(d.trend.series.map((s) => s.category)));
    expect(d.trend.lastYear.series.housing![sept]).toBe(95000);
  });

  it("a past period shows the fixed costs and insights of its own end", () => {
    const txs = [
      ...base(),
      // a gym from October 2025 to May 2026, then cancelled
      ...monthly("2025-10", 1, 8, -3990, { merchant: "Sali", category: "fitness" }),
      // a price rise in August 2026
      ...monthly("2025-09", 14, 14, (i) => (i < 11 ? -699 : -899), { merchant: "Apple", category: "subscriptions" }),
    ];
    const ctx = createContext(txs, [checking], today);
    const may = buildDashboard(ctx, { from: "2026-05-01", to: "2026-05-31" });
    const now = buildDashboard(ctx, { from: "2026-10-01", to: today });
    expect(may.fixedMonthlyCents - now.fixedMonthlyCents).toBe(3990 - 200);
    expect(may.insights.some((i) => i.id.startsWith("price:"))).toBe(false);
    const august = buildDashboard(ctx, { from: "2026-08-01", to: "2026-08-31" });
    expect(august.insights.find((i) => i.id.startsWith("price:"))?.title).toBe("Apple: hinta nousi");
  });

  it("the heatmap and the merchant list show everyday spending, without rent, subscriptions or payments to people", () => {
    const friend = tx({ bookingDate: "2026-09-12", amountCents: -2500, merchant: "Laura Korhonen", category: "p2p" });
    const d = buildDashboard(createContext([...base(), friend], [checking], today), { from: "2026-09-01", to: "2026-09-30" });
    expect(d.merchants.map((m) => m.merchant)).toEqual(["Prisma"]);
    // rent on the 2nd is a bill: the day shows no everyday spending
    expect(d.daily.find((x) => x.date === "2026-09-02")).toMatchObject({ cents: 0, count: 0 });
    expect(d.daily.find((x) => x.date === "2026-09-03")!.cents).toBeGreaterThan(0);
  });

  it("the heatmap starts where the history starts", () => {
    const d = buildDashboard(createContext(base(), [checking], today), { from: "2025-08-01", to: "2025-12-31" });
    expect(d.daily[0]!.date).toBe("2025-09-02");
    expect(d.daily.at(-1)!.date).toBe("2025-12-31");
  });

  it("insights are about the period: no standing subscription total, habit or ordinary mortgage share", () => {
    const visits = Array.from({ length: 40 }, (_, i) => tx({ bookingDate: addDays("2026-07-12", Math.floor(i * 2.2)), amountCents: -(1800 + ((i * 337) % 2000)), merchant: "Wolt", category: "food_delivery" }));
    const mortgage = monthly("2025-09", 20, 14, -45000, { merchant: "Nordea", category: "mortgage" });
    const d = buildDashboard(createContext([...base(), ...visits, ...mortgage], [checking], today), { from: "2026-09-01", to: "2026-09-30" });
    expect(d.insights.map((i) => i.id.split(":")[0])).not.toEqual(expect.arrayContaining(["subscriptions"]));
    expect(d.insights.some((i) => ["subscriptions", "habit", "debt"].includes(i.id.split(":")[0]!))).toBe(false);
    // debt service over a third of income is worth saying
    const heavy = monthly("2025-09", 21, 14, -70000, { merchant: "Autolaina", category: "loans" });
    const h = buildDashboard(createContext([...base(), ...mortgage, ...heavy], [checking], today), { from: "2026-09-01", to: "2026-09-30" });
    expect(h.insights.find((i) => i.id === "debt")).toMatchObject({ tone: "warning", title: "Velanhoitoon 38 % tuloista" });
  });

  it("the largest purchase is news from 200 €, and the weekly food shop is not a purchase", () => {
    const rows = [
      ...base(),
      tx({ bookingDate: "2026-09-19", amountCents: -16000, merchant: "Gigantti", category: "home" }),
      tx({ bookingDate: "2026-09-26", amountCents: -24000, merchant: "Prisma", category: "groceries" }),
    ];
    const d = buildDashboard(createContext(rows, [checking], today), { from: "2026-09-01", to: "2026-09-30" });
    expect(d.insights.some((i) => i.id === "largest")).toBe(false);
    const bigger = [...rows, tx({ bookingDate: "2026-09-27", amountCents: -21000, merchant: "Gigantti", category: "home" })];
    expect(plain(buildDashboard(createContext(bigger, [checking], today), { from: "2026-09-01", to: "2026-09-30" }).insights.find((i) => i.id === "largest"))).toMatchObject({
      title: "Suurin ostos: 210 €",
      detail: "Gigantti, 27.9.2026.",
    });
  });

  it("a subscription is asked about once two charges are missed, a club's summer break is not", () => {
    const stream = monthly("2025-09", 15, 10, -1299, { merchant: "Viaplay", category: "subscriptions" }); // last charge 15.6.2026
    const club = monthly("2025-09", 16, 9, -12000, { merchant: "Iltapäiväkerho", category: "kids" }); // last charge 16.5.2026
    const ctx = createContext([...base(), ...stream, ...club], [checking], today);
    const stopped = (to: string) =>
      buildDashboard(ctx, { from: `${to.slice(0, 7)}-01`, to })
        .insights.filter((i) => i.id.startsWith("stopped:"))
        .map((i) => i.title);
    expect(stopped("2026-07-31")).toEqual([]);
    expect(stopped("2026-08-31")).toEqual(["Viaplay: maksut loppuneet?"]);
  });

  it("a rise that is one big purchase is not a swing, the purchase is told on its own", () => {
    const usualHome = [3, 4, 5, 6, 7, 8].map((m) => tx({ bookingDate: `2026-0${m}-12`, amountCents: -5000, merchant: "Tokmanni", category: "home" }));
    const sofa = [tx({ bookingDate: "2026-09-11", amountCents: -169000, merchant: "Asko", category: "home" }), tx({ bookingDate: "2026-09-25", amountCents: -4500, merchant: "Tokmanni", category: "home" })];
    const d = buildDashboard(createContext([...base(), ...usualHome, ...sofa], [checking], today), { from: "2026-09-01", to: "2026-09-30" });
    expect(d.insights.some((i) => i.id === "swing:home")).toBe(false);
    expect(d.insights.find((i) => i.id === "largest")?.detail).toBe("Asko, 11.9.2026.");
  });
});

describe("previousRange", () => {
  it.each([
    ["2026-10-01", "2026-10-09", "2026-09-01", "2026-09-09"],
    ["2026-09-01", "2026-09-30", "2026-08-01", "2026-08-31"],
    ["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"],
    ["2026-08-01", "2026-10-09", "2026-05-01", "2026-07-09"],
    ["2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31"],
    ["2026-01-01", "2026-10-09", "2025-01-01", "2025-10-09"],
    ["2028-01-01", "2028-02-29", "2027-01-01", "2027-02-28"],
    ["2026-01-01", "2026-01-09", "2025-01-01", "2025-01-09"],
    ["2026-09-10", "2026-10-09", "2026-08-11", "2026-09-09"],
  ])("%s…%s → %s…%s", (from, to, pf, pt) => {
    expect(previousRange(from, to)).toEqual([pf, pt]);
  });
});
