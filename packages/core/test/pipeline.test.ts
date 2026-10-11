import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard, merchantStats } from "../src/analysis/dashboard.ts";
import { spendingChange } from "../src/analysis/change.ts";
import { flowsOf } from "../src/analysis/flows.ts";
import { previousRange } from "../src/analysis/period.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { median } from "../src/stats.ts";
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

  describe("money back from a shop", () => {
    // a name no rule knows: the purchase is "other" and the money back would be income
    const shop = { merchant: "Zxq Tmi", counterparty: "ZXQ TMI", mcc: null };
    const bought = (extra: Partial<Transaction> = {}) => tx({ ...shop, bookingDate: "2026-09-03", amountCents: -7900, ...extra });
    const refund = (extra: Partial<Transaction> = {}) => tx({ ...shop, bookingDate: "2026-09-17", amountCents: 7900, ...extra });
    const run = (txs: Transaction[]) => {
      const changed = new Map(enrichTransactions(txs, [checking], []).map((t) => [t.id, t]));
      return txs.map((t) => changed.get(t.id) ?? t);
    };
    const sum = (rows: Transaction[], flow: "consumption" | "income") => rows.reduce((s, t) => s + flowsOf(t, new Set())[flow], 0);

    it("79 € paid and 79 € returned two weeks later cancel out instead of counting as income", () => {
      expect(run([refund()])[0]).toMatchObject({ category: "income", categorySource: "default" });
      const rows = run([bought(), refund()]);
      expect(rows[1]).toMatchObject({ category: rows[0]!.category, categorySource: "match" });
      expect(sum(rows, "consumption")).toBe(0);
      expect(sum(rows, "income")).toBe(0);
    });

    it("a partial refund, one the text calls a refund and one that lands in the next month", () => {
      const rows = run([bought(), refund({ amountCents: 3000, description: "PALAUTUS", bookingDate: "2026-10-02" })]);
      expect(rows[1]!.category).toBe(rows[0]!.category);
      expect(sum(rows, "consumption")).toBe(4900);
    });

    it("a purchase is refunded once: a second refund of the same money stays money in", () => {
      const rows = run([bought(), refund(), refund({ bookingDate: "2026-09-18" })]);
      expect(rows[1]!.categorySource).toBe("match");
      expect(rows[2]).toMatchObject({ category: "income", categorySource: "default" });
    });

    it("an insurer's claim payout, another shop, an old purchase, a hand-set category and an own transfer are left as they were", () => {
      const claim = run([bought({ merchant: "If Vahinkovakuutus Oy", counterparty: "IF VAHINKOVAKUUTUS OY" }), refund({ merchant: "If Vahinkovakuutus Oy", counterparty: "IF VAHINKOVAKUUTUS OY", description: "KORVAUS VAHINKO 123" })]);
      expect(claim[1]!.category).toBe("reimbursements");
      expect(run([bought(), refund({ merchant: "Jokin Toinen", counterparty: "JOKIN TOINEN" })])[1]!.category).toBe("income");
      expect(run([bought({ bookingDate: "2026-04-01" }), refund()])[1]!.category).toBe("income");
      expect(run([bought(), refund({ category: "salary", categorySource: "user" })])[1]).toMatchObject({ category: "salary", categorySource: "user" });
      // money between own accounts stays a transfer, not a refund
      const out = bought({ amountCents: -50000, bookingDate: "2026-09-03" });
      const back = refund({ amountCents: 50000, accountId: "sav", bookingDate: "2026-09-04" });
      const changed = new Map(enrichTransactions([out, back], [checking, savings], []).map((t) => [t.id, t]));
      expect([changed.get(out.id)!.category, changed.get(back.id)!.category]).toEqual(["transfer", "transfer"]);
    });

    it("the purchase leaves the largest purchases and the merchant list once it came back", () => {
      const rows = run([bought({ amountCents: -30000 }), refund({ amountCents: 30000 }), tx({ merchant: "Verkkokauppa", counterparty: "VERKKOKAUPPA.COM", bookingDate: "2026-09-05", amountCents: -25000 })]);
      const ctx = createContext(rows, [checking], "2026-10-09");
      const d = buildDashboard(ctx, { from: "2026-08-01", to: "2026-09-30" });
      expect(merchantStats(ctx.txs, { from: "2026-08-01", to: "2026-09-30" }).map((m) => m.merchant)).toEqual(["Verkkokauppa"]);
      expect(d.totals.consumptionCents).toBe(25000);
    });
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

  it("a single month has no swing and no largest purchase, the spending change tells what moved it", () => {
    const txs = [
      ...base(),
      // two dinners a month at 40 €, then at 90 € in September
      ...[5, 15].flatMap((d) => monthly("2026-03", d, 7, (i) => (i < 6 ? -4000 : -9000), { merchant: "Ravintola", category: "restaurants" })),
      // one bill moving from August to September
      tx({ bookingDate: "2026-08-30", amountCents: -20000, merchant: "Vakuutus", category: "insurance" }),
      tx({ bookingDate: "2026-09-01", amountCents: -60000, merchant: "Vakuutus", category: "insurance" }),
      tx({ bookingDate: "2026-09-20", amountCents: -90000, merchant: "Ikea", category: "home" }),
    ];
    const ctx = createContext(txs, [checking], today);
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.insights.some((i) => i.id.startsWith("swing:") || i.id === "largest")).toBe(false);
    const september = spendingChange(ctx, "usual", "2026-09")!;
    expect(september.categories.find((r) => r.category === "restaurants")).toMatchObject({ nowCents: 18000, baseCents: 8000 });
    expect(september.categories.find((r) => r.category === "home")?.buckets[0]).toMatchObject({ kind: "oneoff", cents: 90000 });
    expect(d.insights.length).toBeLessThanOrEqual(5);
    // the tiles show savings, the insights do not repeat them
    expect(d.insights.some((i) => i.id === "saved" || i.id === "savings-rate")).toBe(false);
    // a running month has none either: the pace chart tells how it goes
    const running = buildDashboard(ctx, { from: "2026-10-01", to: today }).insights;
    expect(running.some((i) => i.id.startsWith("swing:") || i.id === "largest")).toBe(false);
  });

  it("a longer period has no category swing either: the explanation and the reports tell it", () => {
    const txs = [...base(), ...[5, 15].flatMap((d) => monthly("2026-01", d, 9, (i) => (i < 6 ? -4000 : -9000), { merchant: "Ravintola", category: "restaurants" }))];
    const d = buildDashboard(createContext(txs, [checking], today), { from: "2026-07-01", to: "2026-09-30" });
    expect(d.insights.some((i) => i.id.startsWith("swing:"))).toBe(false);
  });

  it("forecasts the running month from spending so far, bills to come and the usual days", () => {
    const ctx = createContext(base(), [checking], today);
    const d = buildDashboard(ctx, { from: "2026-10-01", to: today });
    const f = d.forecast!;
    expect(f.month).toBe("2026-10");
    // rent on 2.10. and groceries on 3.10.
    const spent = ctx.txs.filter((t) => t.bookingDate >= "2026-10-01").reduce((s, t) => s + t.spend, 0);
    expect(f.spentCents).toBe(spent);
    expect(d.ahead!.rows.filter((r) => r.source === "recurring" && r.date <= "2026-10-23")).toEqual([{ date: "2026-10-11", name: "Spotify", category: "subscriptions", cents: -1199, source: "recurring" }]);
    expect(f.forecastCents).toBeGreaterThan(spent + 1199);
    // the usual month is the median of the six complete months before it (April to September)
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => ctx.txs.filter((t) => t.bookingDate.startsWith(m)).reduce((s, t) => s + t.spend, 0));
    expect(f.usualMonthCents).toBe(Math.round(median(months)));
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

  it("a past period shows the fixed costs and insights of its own end", () => {
    const txs = [
      ...base(),
      // a gym from October 2025 to May 2026, then cancelled
      ...monthly("2025-10", 1, 8, -3990, { merchant: "Sali", category: "fitness" }),
      // a price rise in August 2026 (under 30 %: a larger step is a new tier, no rise)
      ...monthly("2025-09", 14, 14, (i) => (i < 11 ? -4499 : -5799), { merchant: "Apple", category: "subscriptions" }),
    ];
    const ctx = createContext(txs, [checking], today);
    const may = buildDashboard(ctx, { from: "2026-05-01", to: "2026-05-31" });
    const now = buildDashboard(ctx, { from: "2026-10-01", to: today });
    expect(may.fixedMonthlyCents - now.fixedMonthlyCents).toBe(3990 - 1300);
    expect(may.insights.some((i) => i.id.startsWith("price:"))).toBe(false);
    const august = buildDashboard(ctx, { from: "2026-08-01", to: "2026-08-31" });
    expect(august.insights.find((i) => i.id.startsWith("price:"))?.title).toMatch(/^Apple: hinta nousi \d+\s€ vuodessa$/);
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
    const quarter = { from: "2026-07-01", to: "2026-09-30" };
    const d = buildDashboard(createContext(rows, [checking], today), quarter);
    expect(d.insights.some((i) => i.id === "largest")).toBe(false);
    // the largest purchase is no insight any more: the month explanation names a one-off
    const bigger = [...rows, tx({ bookingDate: "2026-09-27", amountCents: -21000, merchant: "Gigantti", category: "home" })];
    const ctx = createContext(bigger, [checking], today);
    expect(buildDashboard(ctx, quarter).insights.some((i) => i.id === "largest")).toBe(false);
    // one month leaves it to the month explanation
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }).insights.some((i) => i.id === "largest")).toBe(false);
  });

  it("a subscription is asked about once two charges are missed, a club's summer break is not", () => {
    const stream = monthly("2025-09", 15, 10, -2999, { merchant: "Viaplay", category: "subscriptions" }); // last charge 15.6.2026
    const club = monthly("2025-09", 16, 9, -12000, { merchant: "Iltapäiväkerho", category: "kids" }); // last charge 16.5.2026
    const ctx = createContext([...base(), ...stream, ...club], [checking], today);
    const stopped = (to: string) =>
      buildDashboard(ctx, { from: `${to.slice(0, 7)}-01`, to })
        .insights.filter((i) => i.id.startsWith("stopped:"))
        .map((i) => i.title);
    expect(stopped("2026-07-31")).toEqual([]);
    expect(stopped("2026-08-31")).toEqual(["Viaplay: ei maksuja 15.6.2026 jälkeen"]);
  });

  it("a rise that is one big purchase is not a swing, the purchase is told on its own", () => {
    const usualHome = [3, 4, 5, 6, 7, 8].map((m) => tx({ bookingDate: `2026-0${m}-12`, amountCents: -5000, merchant: "Tokmanni", category: "home" }));
    const sofa = [tx({ bookingDate: "2026-09-11", amountCents: -169000, merchant: "Asko", category: "home" }), tx({ bookingDate: "2026-09-25", amountCents: -4500, merchant: "Tokmanni", category: "home" })];
    const ctx = createContext([...base(), ...usualHome, ...sofa], [checking], today);
    const d = buildDashboard(ctx, { from: "2026-08-01", to: "2026-09-30" });
    expect(d.insights.some((i) => i.id === "swing:home")).toBe(false);
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

describe("the enrichment with its rule memo and pauses", () => {
  it("gives the same rows as the plain version on random histories", async () => {
    const { enrichTransactionsReference } = await import("./pipeline-reference.ts");
    const { enrichTransactionsPausing } = await import("../src/pipeline.ts");
    const { randomHistory } = await import("./gen.ts");
    let changed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { txs, accounts, rules } = randomHistory(seed, 700);
      const industries = new Map([["Qwerty Puoti", "shopping"], ["Aaltonen Konsultointi Oy", "home"]]);
      const expected = enrichTransactionsReference(txs, accounts, rules, industries);
      expect(enrichTransactions(txs, accounts, rules, industries)).toEqual(expected);
      let pauses = 0;
      const paused = await enrichTransactionsPausing(txs, accounts, rules, industries, async () => void pauses++);
      expect(paused).toEqual(expected);
      expect(pauses).toBeGreaterThanOrEqual(4);
      changed += expected.length;
    }
    expect(changed).toBeGreaterThan(1000);
    // a long history is cut into pieces inside the stages too
    const long = randomHistory(9, 20000);
    let pauses = 0;
    await enrichTransactionsPausing(long.txs, long.accounts, long.rules, new Map(), async () => void pauses++);
    expect(pauses).toBeGreaterThan(10);
  }, 30_000);
});
