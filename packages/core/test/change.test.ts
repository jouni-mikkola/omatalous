import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { categoryRises, type ChangeView, type SpendingChange, spendingChange } from "../src/analysis/change.ts";
import { spendingInsights } from "../src/analysis/insights/spending.ts";
import { spendingChangeReport } from "../src/reports/spending-change.ts";
import { completeMonthsBefore, spendingThrough, usualSpending } from "../src/analysis/usual.ts";
import { addMonths, daysInMonth, monthRange } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { rng } from "./gen.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-11";
const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;
const ctxOf = (txs: Transaction[], now = today) => createContext(txs, [checking], now);

/** An income row on the 1st of each month, so the history covers every month from its first day. */
const pay = (from: string, to: string) => monthRange(from, to).map((m) => tx({ bookingDate: day(m, 1), amountCents: 300000, merchant: "Acme Oy", category: "salary" })).filter((t) => t.bookingDate <= today);

/** The same purchases every month: `amounts` on days 2, 6, 10 and so on. */
function shop(from: string, to: string, merchant: string, category: string, amounts: (month: string) => number[], now = today): Transaction[] {
  return monthRange(from, to).flatMap((m) => amounts(m).map((cents, i) => tx({ bookingDate: day(m, 2 + i * 4), amountCents: -cents, merchant, category }))).filter((t) => t.bookingDate <= now);
}

/** Every identity the analysis promises, in whole cents. */
function expectExact(c: SpendingChange) {
  expect(c.changeCents).toBe(c.nowCents - c.baseCents);
  // causes add up to the total, so do the categories
  expect(sum(c.pieces.map((p) => p.cents))).toBe(c.changeCents);
  expect(sum(c.categories.map((r) => r.changeCents))).toBe(c.changeCents);
  expect(sum(c.categories.map((r) => r.nowCents))).toBe(c.nowCents);
  expect(sum(c.categories.map((r) => r.baseCents))).toBe(c.baseCents);
  for (const r of c.categories) {
    expect(r.changeCents).toBe(r.nowCents - r.baseCents);
    // the shown causes and the small ones together are the change of the category
    expect(sum(r.buckets.map((b) => b.cents)) + r.restCents).toBe(r.changeCents);
    for (const b of r.buckets) expect(Math.abs(b.cents)).toBeGreaterThanOrEqual(c.gateCents);
    if (r.kind === "category") {
      // the merchants, the small ones and the spread are the category
      expect(sum(r.merchants.map((m) => m.changeCents))).toBe(r.changeCents);
      for (const m of r.merchants) expect(sum(m.buckets.map((b) => b.cents))).toBe(m.changeCents);
    }
  }
  for (const p of c.pieces) expect(Number.isInteger(p.cents)).toBe(true);
}

/** A household of a few categories with ordinary months, bills that now and then come twice or not at all, one-offs and new shops. */
function household(seed: number): Transaction[] {
  const r = rng(seed);
  const first = addMonths("2026-10", -(14 + Math.floor(r() * 12)));
  const months = monthRange(first, "2026-10");
  const out: Transaction[] = pay(first, "2026-10");
  const cats: Record<string, string[]> = {
    groceries: ["K-Market", "Lidl", "Prisma"],
    restaurants: ["Ravintola A", "Ravintola B"],
    transport: ["HSL", "Neste"],
    shopping: ["Verkkokauppa", "Zara", "Tokmanni"],
    health: ["Apteekki"],
  };
  for (const [i, m] of months.entries()) {
    for (const [category, names] of Object.entries(cats)) {
      const visits = 1 + Math.floor(r() * 7);
      // a shop that exists only from month 8 on is new in the later windows
      const open = names.filter((_, k) => k === 0 || i >= 6 + k * 2);
      for (let v = 0; v < visits; v++) out.push(tx({ bookingDate: day(m, 2 + Math.floor(r() * 26)), amountCents: -Math.round(400 + r() * (category === "shopping" ? 12000 : 7000)), merchant: open[Math.floor(r() * open.length)]!, category }));
    }
    if (r() < 0.2) out.push(tx({ bookingDate: day(m, 5 + Math.floor(r() * 20)), amountCents: -Math.round(30000 + r() * 60000), merchant: `Kertakauppa ${i}`, category: "shopping" }));
    // rent and the phone bill: a month with two charges, a month with none
    const x = r();
    const rent = x < 0.1 ? 0 : x < 0.2 ? 2 : 1;
    for (let k = 0; k < rent; k++) out.push(tx({ bookingDate: day(m, k ? 20 : 2), amountCents: -95000, merchant: "Sato Oyj", category: "housing" }));
    out.push(tx({ bookingDate: day(m, 11), amountCents: -(2990 + (i % 3) * 100), merchant: "Elisa", category: "telecom" }));
    // a yearly bill
    if (m.endsWith("-03")) out.push(tx({ bookingDate: day(m, 14), amountCents: -48000, merchant: "Vakuutus Oy", category: "insurance" }));
  }
  return out.filter((t) => t.bookingDate <= today);
}

describe("spendingChange", () => {
  it("every cause, category and total adds up exactly in cents on random households, in all three views", () => {
    let views = 0;
    let withPrice = 0;
    let withTiming = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = ctxOf(household(seed));
      for (const [view, month] of [["usual", "2026-10"], ["usual", "2026-07"], ["usual", "2026-03"], ["season", "2026-10"], ["season", "2026-06"], ["year", "2026-09"], ["year", "2026-04"]] as [ChangeView, string][]) {
        const c = spendingChange(ctx, view, month);
        if (!c) continue;
        views++;
        expectExact(c);
        const kinds = new Set(c.pieces.map((p) => p.kind));
        if (kinds.has("price")) withPrice++;
        if (kinds.has("timing")) withTiming++;
      }
    }
    // the households are long enough for most views, and they do produce price and timing causes
    expect(views).toBeGreaterThan(150);
    expect(withPrice).toBeGreaterThan(10);
    expect(withTiming).toBeGreaterThan(10);
  });

  it("the usual view's usual total is the month's usual spending (ADR 0004); the categories keep their own levels and Muut holds the rest", () => {
    let gaps = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const ctx = ctxOf(household(seed));
      for (const month of ["2026-10", "2026-09", "2026-06"]) {
        const c = spendingChange(ctx, "usual", month);
        const months = completeMonthsBefore(ctx, month);
        expect(c === null).toBe(months.length < 3);
        if (!c) continue;
        const day = c.running ? Number(c.target.to.slice(8, 10)) : 31;
        // one usual total: the forecast's and the pace chart's figure, on the same days for a running month
        expect(c.baseCents).toBe(usualSpending(ctx, month, day));
        expect(c.base.months).toEqual(months);
        expect(c.nowCents).toBe(spendingThrough(ctx, month, day));
        // a category's level is its median with one-offs struck; what they leave of the usual month is Muut's spread
        const named = c.categories.filter((r) => r.kind === "category");
        const smaller = c.categories.find((r) => r.kind === "smaller");
        const spread = c.pieces.filter((p) => p.category === null && p.kind === "spread");
        if (spread.length) {
          gaps++;
          expect(smaller).toBeDefined();
          expect(sum(named.map((r) => r.baseCents)) + smaller!.baseCents).toBe(c.baseCents);
        }
        expect(spread.length).toBeLessThanOrEqual(1);
      }
    }
    // medians do not add up, so most months have a gap
    expect(gaps).toBeGreaterThan(10);
  });

  it("the usual total is where a usual month is: two categories bought from now and then lift it over the sum of their medians", () => {
    // groceries 400 € every month; a 100 € dinner in March and April, 100 € of clothes in May and June. Four months of
    // six cost 500 €, so the usual month is 500 €; each sparse category's median is nothing, so the medians add up to 400 €
    const outing = (month: string, merchant: string, category: string) => tx({ bookingDate: day(month, 20), amountCents: -10000, merchant, category });
    const txs = [
      ...pay("2026-03", "2026-10"),
      ...shop("2026-03", "2026-09", "K-Market", "groceries", () => [10000, 10000, 10000, 10000]),
      outing("2026-03", "Ravintola", "restaurants"),
      outing("2026-04", "Ravintola", "restaurants"),
      outing("2026-05", "Vaatekauppa", "shopping"),
      outing("2026-06", "Vaatekauppa", "shopping"),
    ];
    const ctx = ctxOf(txs);
    const c = spendingChange(ctx, "usual", "2026-09")!;
    expectExact(c);
    expect(c).toMatchObject({ nowCents: 40000, baseCents: 50000, changeCents: -10000 });
    expect(c.baseCents).toBe(usualSpending(ctx, "2026-09"));
    // the 100 € a usual month has beyond the medians is Muut's, a spread and no cause: September had no dinner and no
    // clothes, so it was cheaper than a usual month, and the sentence names no category for it
    expect(c.categories.at(-1)).toMatchObject({ kind: "smaller", baseCents: 50000 });
    expect(c.pieces.filter((p) => p.category === null)).toEqual([{ category: null, kind: "spread", cents: -10000, season: false }]);
    // no category stands out, so there is no bar: a lone rest bar would be the whole change, while the table's Muut row
    // (the small categories) has a change of its own
    const usual = spendingChangeReport(ctx, { from: "2026-09-01", to: "2026-09-30" }).views[0]!;
    expect(usual.bars).toEqual([]);
    expect(usual.sentence.replace(/\s/g, " ")).toBe("Syyskuu on 100 € tavallista halvempi.");
  });

  it("a dearer basket is price, more visits is volume, a new shop is mix", () => {
    const base = (merchant: string, amounts: number[]) => shop("2026-03", "2026-08", merchant, "groceries", () => amounts);
    const usual = [4500, 5500, 4800, 5200];
    const run = (target: Transaction[]) => spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...base("K-Market", usual), ...target]), "usual", "2026-09")!;
    const pieces = (c: SpendingChange) => Object.fromEntries(c.pieces.filter((p) => p.category === "groceries").map((p) => [p.kind, p.cents]));

    // every ticket 10 € dearer, as many visits
    const dearer = run(shop("2026-09", "2026-09", "K-Market", "groceries", () => usual.map((c) => c + 1000)));
    expectExact(dearer);
    expect(pieces(dearer)).toEqual({ price: 4000 });

    // two more visits at the usual ticket
    const more = run(shop("2026-09", "2026-09", "K-Market", "groceries", () => [...usual, 5000, 5000]));
    expectExact(more);
    expect(pieces(more)).toEqual({ volume: 10000 });

    // the same visits, and three more at a shop that is not in the base
    const fresh = run([...shop("2026-09", "2026-09", "K-Market", "groceries", () => usual), ...[3, 9, 16].map((d) => tx({ bookingDate: day("2026-09", d), amountCents: -3000, merchant: "Uusi Kauppa", category: "groceries" }))]);
    expectExact(fresh);
    expect(pieces(fresh)).toEqual({ new: 9000 });
    expect(fresh.categories[0]!.buckets[0]).toEqual({ kind: "new", cents: 9000 });
    expect(fresh.categories[0]!.merchants[0]).toMatchObject({ label: "Uusi Kauppa", changeCents: 9000, visitsNow: 3, visitsBase: 0 });

    // a shop that is gone
    const gone = run([]);
    expectExact(gone);
    expect(pieces(gone)).toEqual({ stopped: -20000 });
  });

  it("on fewer than three visits the change is volume, unless it is one charge a period on both sides", () => {
    const rows = shop("2026-03", "2026-08", "Kampaamo", "personal_care", () => [6000]);
    const c = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...rows, ...shop("2026-09", "2026-09", "Kampaamo", "personal_care", () => [9000, 6000])]), "usual", "2026-09")!;
    expectExact(c);
    // six base rows, one visit a month and two now: the change is volume however the ticket moved
    expect(c.pieces.filter((p) => p.category === "personal_care")).toEqual([{ category: "personal_care", kind: "volume", cents: 9000, season: false }]);
  });

  it("one large payment is a one-off, a bill that comes twice or not at all is timing", () => {
    const groceries = shop("2026-03", "2026-10", "Prisma", "groceries", () => [4500, 5500, 4800, 5200]);
    const rent = (months: string[]) => months.flatMap((m) => [tx({ bookingDate: day(m, 2), amountCents: -95000, merchant: "Sato Oyj", category: "housing" })]);
    const months = monthRange("2026-03", "2026-10");
    const oneoff = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...groceries, ...rent(months), tx({ bookingDate: "2026-09-12", amountCents: -40000, merchant: "Verkkokauppa", category: "shopping" })]), "usual", "2026-09")!;
    expectExact(oneoff);
    expect(oneoff.pieces).toEqual([{ category: "shopping", kind: "oneoff", cents: 40000, season: false }]);

    const twice = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...groceries, ...rent(months), tx({ bookingDate: "2026-09-20", amountCents: -95000, merchant: "Sato Oyj", category: "housing" })]), "usual", "2026-09")!;
    expectExact(twice);
    expect(twice.pieces).toEqual([{ category: "housing", kind: "timing", cents: 95000, season: false }]);

    const none = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...groceries, ...rent(months.filter((m) => m !== "2026-09"))]), "usual", "2026-09")!;
    expectExact(none);
    expect(none.pieces).toEqual([{ category: "housing", kind: "timing", cents: -95000, season: false }]);
  });

  it("the total does not stand out on a move against the sentence: one-offs in most base months lift the raw usual, not the struck one", () => {
    const groceries = shop("2026-03", "2026-09", "Prisma", "groceries", (m) => (m === "2026-09" ? [10200, 10200, 10200, 10200] : [10000, 10000, 10000, 10000]));
    // one 300 € purchase in each of four base months, each in its own category, so each is struck as a one-off
    const oneOffs = ([["2026-03", "home"], ["2026-04", "shopping"], ["2026-05", "fitness"], ["2026-06", "entertainment"]] as const).map(([m, category]) =>
      tx({ bookingDate: day(m, 15), amountCents: -30000, merchant: `Kauppa ${category}`, category }),
    );
    const dinner = tx({ bookingDate: "2026-09-18", amountCents: -12000, merchant: "Ravintola Oy", category: "restaurants" });
    const c = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...groceries, ...oneOffs, dinner]), "usual", "2026-09")!;
    expectExact(c);
    // cheaper than the raw usual month, dearer than the struck one: the two disagree, so the total says nothing
    expect(c.changeCents).toBeLessThan(0);
    expect(c.standsOut).toBe(false);
  });

  it("a yearly bill in the month is timing, not a new merchant", () => {
    const rows = [...shop("2026-03", "2026-10", "Prisma", "groceries", () => [4500, 5500, 4800, 5200]), tx({ bookingDate: "2025-09-14", amountCents: -48000, merchant: "Vakuutus Oy", category: "insurance" }), tx({ bookingDate: "2026-09-14", amountCents: -49000, merchant: "Vakuutus Oy", category: "insurance" })];
    const c = spendingChange(ctxOf([...pay("2025-03", "2026-10"), ...rows]), "usual", "2026-09")!;
    expectExact(c);
    expect(c.pieces.filter((p) => p.category === "insurance")).toEqual([{ category: "insurance", kind: "timing", cents: 49000, season: true }]);
  });

  it("a season repeat is marked: the same month a year ago moved as far", () => {
    // electricity 60 € in summer and autumn and 120 € in December, both years; groceries the same all year
    const power = (m: string) => [m.endsWith("-12") ? 12000 : 6000];
    const rows = [
      ...pay("2025-06", "2026-12"),
      ...shop("2025-06", "2026-12", "Helen", "utilities", power, "2026-12-20").map((t) => ({ ...t, bookingDate: t.bookingDate.slice(0, 8) + "10" })),
      ...shop("2025-06", "2026-12", "Prisma", "groceries", () => [4500, 5500, 4800, 5200], "2026-12-20"),
    ];
    const c = spendingChange(ctxOf(rows, "2026-12-20"), "usual", "2026-12")!;
    expectExact(c);
    const power_ = c.categories.find((r) => r.category === "utilities")!;
    expect(power_).toMatchObject({ changeCents: 6000, yearAgoCents: 12000, season: true });
    expect(c.pieces.find((p) => p.category === "utilities")!.season).toBe(true);
    expect(c.categories.find((r) => r.category === "groceries")?.season ?? false).toBe(false);

    // a December that is dear this year only is not a season
    const once = rows.filter((t) => !(t.merchant === "Helen" && t.bookingDate.startsWith("2025-12")));
    const noSeason = spendingChange(ctxOf([...once, tx({ bookingDate: "2025-12-10", amountCents: -6000, merchant: "Helen", category: "utilities" })], "2026-12-20"), "usual", "2026-12")!;
    expect(noSeason.categories.find((r) => r.category === "utilities")!.season).toBe(false);

    // the season view sets December against December
    const yoy = spendingChange(ctxOf(rows, "2026-12-20"), "season", "2026-12")!;
    expectExact(yoy);
    expect(yoy.changeCents).toBe(0);
  });

  it("the year view sets the last months against the same months a year earlier", () => {
    const rows = [...pay("2024-10", "2026-09"), ...shop("2024-10", "2025-09", "K-Market", "groceries", () => [4500, 5500, 4800, 5200]), ...shop("2025-10", "2026-09", "K-Market", "groceries", () => [4950, 6050, 5280, 5720])];
    const c = spendingChange(ctxOf(rows), "year", "2026-09")!;
    expectExact(c);
    expect(c.target.months).toHaveLength(12);
    expect(c.target).toMatchObject({ from: "2025-10-01", to: "2026-09-30" });
    expect(c.base).toMatchObject({ from: "2024-10-01", to: "2025-09-30" });
    // ten per cent dearer tickets, as many visits: all of the change is price
    expect(c.changeCents).toBe(sum(c.pieces.map((p) => p.cents)));
    expect(c.pieces).toEqual([{ category: "groceries", kind: "price", cents: c.changeCents, season: false }]);
    expect(c.changeCents).toBe(12 * 2000);
    // fewer months of history: only the months a year earlier covers are compared, down to three
    const short = spendingChange(ctxOf(rows.filter((t) => t.bookingDate >= "2025-03-01")), "year", "2026-09")!;
    expect(short.target.months).toHaveLength(7);
    expect(spendingChange(ctxOf(rows.filter((t) => t.bookingDate >= "2025-08-01")), "year", "2026-09")).toBeNull();
  });

  it("shows nothing under the gates: a change under 10 € is the small rest, and a thin history says nothing", () => {
    const quiet = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-08", "Prisma", "groceries", () => [4500, 5500, 4800, 5200]), ...shop("2026-09", "2026-09", "Prisma", "groceries", () => [4500, 5500, 4800, 5700])]), "usual", "2026-09")!;
    expectExact(quiet);
    expect(quiet.changeCents).toBe(500);
    expect(quiet.gateCents).toBeGreaterThan(500);
    const row = quiet.categories.find((r) => r.category === "groceries")!;
    expect(row.buckets).toEqual([]);
    expect(row.restCents).toBe(500);
    expect(row.merchants.map((m) => m.kind)).toEqual(["smaller"]);

    expect(spendingChange(ctxOf([...pay("2026-08", "2026-10"), ...shop("2026-08", "2026-10", "Prisma", "groceries", () => [5000])]), "usual", "2026-10")).toBeNull();
    expect(spendingChange(ctxOf(household(3)), "usual", "2026-11")).toBeNull();
  });

  it("a category with under four rows in the base has only one-off and timing, the rest is other", () => {
    const rows = [...pay("2026-03", "2026-10"), ...[3, 4, 5].map((i) => tx({ bookingDate: day(`2026-0${i}`, 8), amountCents: -2000, merchant: "Kirjakauppa", category: "education" })), ...[2, 3].map((i) => tx({ bookingDate: day("2026-09", 8 + i), amountCents: -3000, merchant: "Uusi kirjakauppa", category: "education" }))];
    const c = spendingChange(ctxOf(rows), "usual", "2026-09")!;
    expectExact(c);
    const kinds = c.pieces.filter((p) => p.category === "education").map((p) => p.kind);
    expect(kinds.every((k) => k === "other" || k === "oneoff" || k === "timing" || k === "spread")).toBe(true);
    expect(kinds).not.toContain("new");
  });

  it("a card that stops while the purchases go on elsewhere is closed, no lag; one that stops with them lags; one connected late starts the comparison", () => {
    const buys = (from: string, to: string, account: (date: string) => string) =>
      monthRange(from, to).flatMap((m) => Array.from({ length: 28 }, (_, i) => tx({ bookingDate: day(m, 1 + i), amountCents: -3000, merchant: "Prisma", category: "groceries", accountId: account(day(m, 1 + i)) }))).filter((t) => t.bookingDate <= today);
    const card = (date: string) => (date < "2026-08-15" ? "card" : "acc-1");
    expect(spendingChange(ctxOf([...pay("2025-09", "2026-10"), ...buys("2025-09", "2026-10", card)]), "usual", "2026-10")).not.toBeNull();
    // the same card rows simply stop: the household's purchases fell short, so the rows reach mid-August only
    const lag = [...pay("2025-09", "2026-10"), ...buys("2025-09", "2026-10", () => "card").filter((t) => t.bookingDate < "2026-08-15"), ...buys("2025-09", "2026-10", () => "acc-1").filter((t) => t.bookingDate.endsWith("-01"))];
    expect(spendingChange(ctxOf(lag), "usual", "2026-10")).toBeNull();
    // a card connected in May: the months before it are no base
    const late = [...pay("2025-09", "2026-10"), ...buys("2025-09", "2026-10", () => "acc-1").filter((t) => t.bookingDate.endsWith("-01")), ...buys("2026-05", "2026-10", () => "card")];
    expect(spendingChange(ctxOf(late), "usual", "2026-10")!.base.months[0]).toBe("2026-05");
  });

  it("a card connected in June has no year-ago month: fewer deliveries in October get no season mark", () => {
    const shop = monthRange("2025-09", "2026-10").map((m) => tx({ bookingDate: day(m, 2), amountCents: -2000, merchant: "Prisma", category: "groceries" }));
    const card = monthRange("2026-06", "2026-10").flatMap((m) => [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27].map((d) => tx({ bookingDate: day(m, d), amountCents: -2500, merchant: "Wolt", category: "food_delivery", accountId: "card" })));
    const rows = [...pay("2025-09", "2026-10"), ...shop, ...card.filter((t) => t.bookingDate >= "2026-06-15" && t.bookingDate <= "2026-10-03")];
    const c = spendingChange(ctxOf(rows), "usual", "2026-10")!;
    expect(c.base.months[0]).toBe("2026-07");
    expect(c.categories.filter((r) => r.yearAgoCents !== null || r.season)).toEqual([]);
  });

  it("a running month is compared on the days it has had", () => {
    const c = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-10", "Prisma", "groceries", () => [4500, 5500, 4800, 5200])]), "usual", "2026-10")!;
    expectExact(c);
    expect(c.running).toBe(true);
    expect(c.target).toMatchObject({ from: "2026-10-01", to: today });
    // the purchases of days 2, 6 and 10 against the same days of every usual month
    expect(c.nowCents).toBe(14800);
    expect(c.baseCents).toBe(14800);
    expect(daysInMonth("2026-10")).toBe(31);
  });

  it("the report has at most five bars that add up to the change, and the grocery insight tells price from visits", () => {
    const visits = (from: string, to: string, factor: number) =>
      monthRange(from, to).flatMap((m) => Array.from({ length: 10 }, (_, i) => tx({ bookingDate: day(m, 2 + i * 3), amountCents: -Math.round((4000 + (i % 3) * 500) * factor), merchant: "K-Market", category: "groceries" })));
    const rows = [...pay("2024-10", "2026-10"), ...visits("2024-10", "2025-10", 1), ...visits("2025-11", "2026-10", 1.14)].filter((t) => t.bookingDate <= today);
    const ctx = ctxOf(rows);
    const range = { from: "2026-10-01", to: today };
    const report = spendingChangeReport(ctx, range);
    expect(report.views.map((v) => v.view)).toEqual(["usual", "year", "season"]);
    for (const v of report.views) {
      expect(v.bars.length).toBeLessThanOrEqual(5);
      if (v.bars.length) expect(sum(v.bars.map((b) => b.cents))).toBe(v.change.changeCents);
    }
    expect(report.views[2]!.sentence).toMatch(/^Lokakuu 2026: menot .* suuremmat kuin lokakuu 2025: Ruokakauppa \+.* \(kalliimpi ostoskerta\)\.$/);
    expect(report.views[1]!.periodLabel).toBe("Lokakuu 2025–syyskuu 2026");
    const insights = spendingInsights(ctx, range);
    expect(insights[0]).toMatchObject({ id: "spending-groceries", title: expect.stringMatching(/^Ruokakaupan ostoskerta 1\d % kalliimpi$/) });
    expect(insights[0]!.yearlyCents).toBeGreaterThan(0);
    // fewer than eight visits a month: the insight keeps quiet
    expect(spendingInsights(ctxOf(rows.filter((t) => Number(t.bookingDate.slice(8)) < 12)), range).find((i) => i.id === "spending-groceries")).toBeUndefined();
    // bars add up to the change, or there are none: a rest bar never stands alone
    for (let seed = 1; seed <= 10; seed++)
      for (const v of spendingChangeReport(ctxOf(household(seed)), range).views) {
        if (v.bars.length) expect(sum(v.bars.map((b) => b.cents))).toBe(v.change.changeCents);
        expect(v.bars.length === 0 || v.bars.some((b) => b.kind !== "rest")).toBe(true);
      }
  });

  it("a bar and the sentence give the whole change of a category, the causes under the gate included", () => {
    // IKEA once in six months (a usual level of nothing, a mean of 10 €) and 400 € this September: 390 € with no named
    // cause and 10 € of the mean against the median, under the gate. The table says +400 €, so does the sentence.
    const rows = [
      ...pay("2026-03", "2026-10"),
      ...shop("2026-03", "2026-09", "Prisma", "groceries", () => [25000, 25000, 25000, 25000]),
      ...shop("2026-04", "2026-04", "IKEA", "home", () => [6000]),
      ...shop("2026-09", "2026-09", "IKEA", "home", () => [10000, 10000, 10000, 10000]),
    ];
    const usual = spendingChangeReport(ctxOf(rows), { from: "2026-09-01", to: "2026-09-30" }).views.find((v) => v.view === "usual")!;
    expect(usual.change.categories.find((c) => c.category === "home")).toMatchObject({ changeCents: 40000, restCents: 1000 });
    expect(usual.bars).toEqual([{ category: "home", label: "Koti ja elektroniikka", kind: "other", cents: 40000, season: false, cause: "ei eriteltyä syytä" }]);
    expect(usual.sentence).toBe("Syyskuu on 400 € tavallista kalliimpi: Koti ja elektroniikka +400 € (ei eriteltyä syytä).");
  });

  it("what the named bars leave is Muut muutokset, not the table's Muut", () => {
    // the same IKEA September, and 10 € more at Prisma: under the gate, so it is the rest
    const rows = [
      ...pay("2026-03", "2026-10"),
      ...shop("2026-03", "2026-08", "Prisma", "groceries", () => [25000, 25000, 25000, 25000]),
      ...shop("2026-09", "2026-09", "Prisma", "groceries", () => [25000, 25000, 25000, 26000]),
      ...shop("2026-04", "2026-04", "IKEA", "home", () => [6000]),
      ...shop("2026-09", "2026-09", "IKEA", "home", () => [10000, 10000, 10000, 10000]),
    ];
    const usual = spendingChangeReport(ctxOf(rows), { from: "2026-09-01", to: "2026-09-30" }).views.find((v) => v.view === "usual")!;
    expect(usual.bars.map((b) => [b.label, b.cents])).toEqual([["Koti ja elektroniikka", 40000], ["Muut muutokset", 1000]]);
    expect(usual.sentence.replace(/\s/g, " ")).toBe("Syyskuu on 410 € tavallista kalliimpi: Koti ja elektroniikka +400 € (ei eriteltyä syytä), muut muutokset +10 €.");
  });

  it("causes that cancel inside a category are no bars, and the usual-level gap is never a bar", () => {
    const names = [4500, 5500, 4800, 5200];
    // a renamed shop: the category did not move, the shop looks new and the old one gone
    const rows = [...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-08", "Prisma", "groceries", () => names), ...shop("2026-09", "2026-09", "Prisma Kamppi", "groceries", () => names)];
    const report = spendingChangeReport(ctxOf(rows), { from: "2026-09-01", to: "2026-09-30" });
    const usual = report.views.find((v) => v.view === "usual")!;
    expect(usual.change.changeCents).toBe(0);
    expect(usual.change.pieces.map((p) => p.kind).sort()).toEqual(["new", "stopped"]);
    expect(usual.bars).toEqual([]);
    for (let seed = 1; seed <= 20; seed++) for (const v of spendingChangeReport(ctxOf(household(seed)), { from: "2026-10-01", to: today }).views) expect(v.bars.some((b) => b.kind === "spread")).toBe(false);
  });

  it("the bars are the four categories that moved most with a cause over the gate, each with its row's change and its causes by name", () => {
    const september = (m: string) => m === "2026-09";
    // a usual month of 764,90 €, so the gate is 15,30 €
    const steady = [
      ...pay("2026-03", "2026-10"),
      ...shop("2026-03", "2026-09", "Prisma", "groceries", () => [25000, 25000]),
      ...shop("2026-03", "2026-09", "Tokmanni", "shopping", () => [3000]),
      ...shop("2026-03", "2026-09", "Apteekki", "health", () => [2000]),
    ];
    // September: restaurants 150 € for 50 €, pet shop 150 € for 60 €, a phone bill of 89,90 € for 29,90 €, no bus pass of 60 €, a film 5 € dearer
    const moved = [
      ...shop("2026-03", "2026-09", "Ravintola A", "restaurants", (m) => Array.from({ length: september(m) ? 6 : 2 }, () => 2500)),
      ...shop("2026-03", "2026-09", "Musti ja Mirri", "pets", (m) => Array.from({ length: september(m) ? 5 : 2 }, () => 3000)),
      ...monthRange("2026-03", "2026-09").map((m) => tx({ bookingDate: day(m, 11), amountCents: september(m) ? -8990 : -2990, merchant: "Elisa", category: "telecom" })),
      ...shop("2026-03", "2026-08", "HSL", "transport", () => [6000]),
      ...shop("2026-03", "2026-09", "Finnkino", "entertainment", (m) => [september(m) ? 2000 : 1500]),
    ];
    const usualOf = (rows: Transaction[]) => spendingChangeReport(ctxOf([...steady, ...moved, ...rows]), { from: "2026-09-01", to: "2026-09-30" }).views.find((v) => v.view === "usual")!;
    const bar = (category: string | null, label: string, kind: string, cents: number, cause: string) => ({ category, label, kind, cents, season: false, cause });
    // four categories over the gate, largest first and a tie by name; the film's 5 € is under the gate and stays in the rest
    const four = usualOf([]);
    expect(four.change).toMatchObject({ baseCents: 76490, gateCents: 1530, changeCents: 19500 });
    expect(four.bars).toEqual([
      bar("restaurants", "Ravintolat ja kahvilat", "volume", 10000, "useammin"),
      bar("pets", "Lemmikit", "volume", 9000, "useammin"),
      bar("telecom", "Puhelin ja netti", "price", 6000, "suurempi lasku"),
      bar("transport", "Joukkoliikenne ja taksit", "stopped", -6000, "ostot jääneet pois"),
      bar(null, "Muut muutokset", "rest", 500, ""),
    ]);
    // a dentist of 600 € and three purchases of 135 € at a new shop push the phone bill and the bus pass into the rest
    const six = usualOf([...shop("2026-09", "2026-09", "Hammaslääkäri", "health", () => [60000]), ...shop("2026-09", "2026-09", "Zara", "shopping", () => [4000, 4500, 5000])]);
    expect(six.bars).toEqual([
      bar("health", "Terveys ja apteekki", "oneoff", 60000, "kertaosto"),
      bar("shopping", "Vaatteet ja ostokset", "new", 13500, "uudet kaupat"),
      bar("restaurants", "Ravintolat ja kahvilat", "volume", 10000, "useammin"),
      bar("pets", "Lemmikit", "volume", 9000, "useammin"),
      bar(null, "Muut muutokset", "rest", 500, ""),
    ]);

    // on seeded households: at most four, largest first, each the change of its row in the table
    let bars = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxOf(household(seed));
      for (const month of monthRange("2025-11", "2026-10")) {
        const usual = spendingChangeReport(ctx, { from: `${month}-01`, to: month === "2026-10" ? today : day(month, 28) }).views.find((v) => v.view === "usual");
        if (!usual) continue;
        const shown = usual.bars.filter((b) => b.kind !== "rest");
        expect(shown.length).toBeLessThanOrEqual(4);
        expect(shown.map((b) => Math.abs(b.cents))).toEqual(shown.map((b) => Math.abs(b.cents)).sort((a, b) => b - a));
        for (const b of shown) expect(usual.change.categories.find((r) => r.category === b.category)).toMatchObject({ kind: "category", changeCents: b.cents, standsOut: true });
        bars += shown.length;
      }
    }
    expect(bars).toBeGreaterThan(10);
  });

  it("a rise is the report's row with the part that is more purchases: no one-off, no bill or subscription of a month or longer", () => {
    const elisa = (cents: (m: string) => number) => monthRange("2026-03", "2026-09").map((m) => tx({ bookingDate: day(m, 11), amountCents: -cents(m), merchant: "Elisa", category: "telecom" }));
    const cases = shop("2026-09", "2026-09", "Kuorikauppa", "telecom", () => [4000, 4500, 5000]);
    const rest = [...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-09", "Prisma", "groceries", () => [25000, 25000])];
    const month = (rows: Transaction[]) => categoryRises(ctxOf([...rest, ...rows]), "2026-09")!;
    // three phone cases on top of the phone bill: the row is the whole category, the rise the cases
    const bought = month([...elisa(() => 2990), ...cases]);
    expect(bought).toMatchObject({ running: false, through: "2026-09-30", gateCents: 1060 });
    expect(bought.rises).toEqual([{ category: "telecom", label: "Puhelin ja netti", nowCents: 16490, usualCents: 2990, changeCents: 13500, moreCents: 13500, purchases: 3, peak: true, season: false, yearAgoCents: null }]);
    // with a bill that also grew by 60 €, the rise in purchases is still the cases
    expect(month([...elisa((m) => (m === "2026-09" ? 8990 : 2990)), ...cases]).rises).toMatchObject([{ nowCents: 22490, usualCents: 2990, changeCents: 19500, moreCents: 13500, purchases: 3 }]);
    // the bigger bill alone, a phone bought once, or a category that fell: no rise
    expect(month(elisa((m) => (m === "2026-09" ? 8990 : 2990))).rises).toEqual([]);
    expect(month([...elisa(() => 2990), ...shop("2026-09", "2026-09", "Gigantti", "telecom", () => [69900])]).rises).toEqual([]);
    expect(month([...elisa(() => 2990), ...shop("2026-03", "2026-08", "Kuorikauppa", "telecom", () => [4000, 4500, 5000])]).rises).toEqual([]);
    // a view the history does not support has no rises
    expect(categoryRises(ctxOf([...pay("2026-08", "2026-10"), ...cases]), "2026-09")).toBeNull();
  });

  it("a purchase and its return in the same period are no cause; a part that stays is", () => {
    const usualTicket = [3, 4, 5, 6, 7, 8].map((i) => tx({ bookingDate: day(`2026-0${i}`, 12), amountCents: -5000, merchant: "Verkkokauppa", category: "shopping" }));
    const base = [...pay("2026-03", "2026-10"), ...usualTicket, ...[4, 5, 6].map((i) => tx({ bookingDate: day(`2026-0${i}`, 22), amountCents: -5200, merchant: "Verkkokauppa", category: "shopping" }))];
    const tv = tx({ bookingDate: "2026-09-12", amountCents: -80000, merchant: "Verkkokauppa", category: "shopping" });
    // the month's own usual visits
    base.push(tx({ bookingDate: "2026-09-13", amountCents: -5000, merchant: "Verkkokauppa", category: "shopping" }), tx({ bookingDate: "2026-09-23", amountCents: -5200, merchant: "Verkkokauppa", category: "shopping" }));
    const back = (cents: number) => tx({ bookingDate: "2026-09-20", amountCents: cents, merchant: "Verkkokauppa", category: "shopping" });
    const kinds = (c: SpendingChange) => c.pieces.map((p) => [p.kind, p.cents]);
    const whole = spendingChange(ctxOf([...base, tv, back(80000)]), "usual", "2026-09")!;
    expectExact(whole);
    expect(kinds(whole).every(([, cents]) => Math.abs(cents as number) < 20000)).toBe(true);
    const part = spendingChange(ctxOf([...base, tv, back(30000)]), "usual", "2026-09")!;
    expectExact(part);
    expect(kinds(part)).toContainEqual(["oneoff", 50000]);
  });

  it("a single bill that changes its amount is price, and debt is not split into price and volume", () => {
    const power = (cents: number) => [...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-08", "Helen", "utilities", () => [8000]), ...shop("2026-09", "2026-09", "Helen", "utilities", () => [cents])];
    const bill = spendingChange(ctxOf(power(20000)), "usual", "2026-09")!;
    expectExact(bill);
    expect(bill.pieces).toEqual([{ category: "utilities", kind: "price", cents: 12000, season: false }]);

    const loan = (visits: number) => shop("2026-09", "2026-09", "Resurs", "loans", () => Array.from({ length: visits }, () => 5000));
    const debt = spendingChange(ctxOf([...pay("2026-03", "2026-10"), ...shop("2026-03", "2026-08", "Resurs", "loans", () => [5000, 5000, 5000, 5000]), ...loan(6)]), "usual", "2026-09")!;
    expectExact(debt);
    expect(debt.pieces.map((p) => [p.kind, p.cents])).toEqual([["other", 10000]]);
  });

  describe("insights", () => {
    const visits = (merchant: string, from: string, to: string, count: number, cents = 4000) =>
      monthRange(from, to).flatMap((m) => Array.from({ length: count }, (_, i) => tx({ bookingDate: day(m, 2 + i * 3), amountCents: -(cents + (i % 3) * 500), merchant, category: "groceries" })));
    const range = { from: "2026-10-01", to: today };

    it("a year-on-year change is told by the report, not as an insight", () => {
      // K-Market is replaced by Lidl at a ticket 400 cents higher: the year view shows it, the insights stay quiet
      const rows = [...pay("2024-10", "2026-10"), ...visits("K-Market", "2024-10", "2025-09", 10), ...visits("Lidl", "2025-10", "2026-09", 10, 4400)];
      expect(spendingInsights(ctxOf(rows), range).map((i) => i.id)).not.toContain("spending-year-cause");
    });

    it("the grocery insight reads visits and ticket from the shops visited in both periods, and says so", () => {
      // Prisma 10 visits a month before, 8 now, and 2 visits at Lidl: as many visits in all, fewer at the shop kept
      const rows = [...pay("2024-10", "2026-10"), ...visits("Prisma", "2024-10", "2025-09", 10), ...visits("Prisma", "2025-10", "2026-09", 8), ...visits("Lidl", "2025-10", "2026-09", 2)];
      const found = spendingInsights(ctxOf(rows), range).find((i) => i.id === "spending-groceries")!;
      expect(found.title).toBe("Ruokakaupassa käyntejä 20 % vähemmän");
      expect(found.detail).toMatch(/^8 käyntiä kuussa, vuotta aiemmin 10, samoissa kaupoissa\./);
    });

    it("the grocery insight splits the change into ticket and visits as the sentence states them, and gives the year with its sign", () => {
      // a September ago Prisma 10 × 40 € and Alepa 2 × 30 €, this September Prisma 9 × 45 € and Alepa 1 × 10 €. At those
      // shops 12 visits at 38,33 € became 10 at 41,50 €: ticket 10 × 3,17 € = +32 €, visits −2 × 38,33 € = −77 €. Split
      // shop by shop, Alepa's single visit would put its cheaper ticket into the visits (−90 €) and one visit fewer
      // would read as 90 €. The months between are as a September ago, so two visits fewer stand out of the noise.
      const buy = (month: string, merchant: string, count: number, cents: number) =>
        Array.from({ length: count }, (_, i) => tx({ bookingDate: day(month, 2 + i * 2), amountCents: -cents, merchant, category: "groceries" }));
      const before = monthRange("2025-09", "2026-08").flatMap((m) => [...buy(m, "Prisma", 10, 4000), ...buy(m, "Alepa", 2, 3000)]);
      const rows = [...pay("2025-08", "2026-10"), ...before, ...buy("2026-09", "Prisma", 9, 4500), ...buy("2026-09", "Alepa", 1, 1000)];
      const found = spendingInsights(ctxOf(rows), range).find((i) => i.id === "spending-groceries")!;
      expect(found).toMatchObject({
        title: "Ruokakaupassa käyntejä 17 % vähemmän",
        detail: "10 käyntiä kuussa, vuotta aiemmin 12, samoissa kaupoissa. Ostoskerta +32 €, käyntien määrä −77 € kuussa.",
        yearlyCents: 54000,
        direction: -1,
      });
    });
  });
});
