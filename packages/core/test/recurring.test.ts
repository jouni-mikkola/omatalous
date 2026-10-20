import { describe, expect, it } from "vitest";
import { fixedMonthlyCents, fixedSplit, isFixedCost } from "../src/commitments.ts";
import { detectRecurring, projectDates } from "../src/recurring.ts";
import { series, tx } from "./helpers.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
const today = "2026-10-09";

describe("detectRecurring", () => {
  it("finds a fixed monthly subscription and its next charge", () => {
    const txs = series("2026-01-15", 30.44, 9, -1199, { merchant: "Spotify", category: "subscriptions" });
    const [s] = detectRecurring(txs, today);
    expect(s).toMatchObject({ merchant: "Spotify", kind: "subscription", cadence: "monthly", active: true, typicalAmountCents: 1199 });
    expect(s!.monthlyCents).toBe(1199);
    expect(s!.nextDate! > s!.lastDate).toBe(true);
  });

  it("reports a price change", () => {
    const txs = series("2026-01-03", 30.44, 10, (i) => (i < 8 ? -1599 : -1799), { merchant: "Netflix", category: "subscriptions" });
    const [s] = detectRecurring(txs, today);
    expect(s!.kind).toBe("subscription");
    expect(s!.priceChange).toMatchObject({ fromCents: 1599, toCents: 1799 });
  });

  it("classifies a varying monthly amount as a bill", () => {
    const amounts = [-6120, -7480, -5530, -4210, -3890, -4470, -6900, -8120];
    const txs = series("2026-02-20", 30.44, amounts.length, (i) => amounts[i]!, { merchant: "Helen", category: "utilities" });
    const [s] = detectRecurring(txs, today);
    expect(s).toMatchObject({ kind: "bill", cadence: "monthly" });
  });

  it("separates several products from one merchant by amount", () => {
    const txs = [
      ...series("2026-03-02", 30.44, 7, -99, { merchant: "Apple", category: "subscriptions" }),
      ...series("2026-03-11", 30.44, 7, -1299, { merchant: "Apple", category: "subscriptions" }),
    ];
    const found = detectRecurring(txs, today).filter((s) => s.merchant === "Apple");
    expect(found.map((s) => s.typicalAmountCents).sort((a, b) => a - b)).toEqual([99, 1299]);
  });

  it("detects a frequent irregular habit", () => {
    const gaps = [0, 3, 5, 6, 9, 14, 17, 22, 28, 31, 37, 41, 46, 52, 55, 61, 66, 70, 74, 80, 85];
    const txs = gaps.map((g, i) => tx({ bookingDate: addDaysLocal("2026-07-12", g), amountCents: -(1800 + (i % 5) * 450), merchant: "Wolt", category: "food_delivery" }));
    const [s] = detectRecurring(txs, today);
    expect(s).toMatchObject({ merchant: "Wolt", kind: "habit", active: true });
    expect(s!.perMonth).toBeGreaterThan(5);
  });

  it("detects yearly charges and salary", () => {
    const yearly = series("2024-11-20", 365, 2, -4900, { merchant: "Amazon Prime", category: "subscriptions" });
    const salary = series("2026-01-23", 30.44, 9, 320000, { merchant: "Acme Oy", category: "salary" });
    const found = detectRecurring([...yearly, ...salary], today);
    expect(found.find((s) => s.merchant === "Amazon Prime")).toMatchObject({ cadence: "yearly", active: true });
    expect(found.find((s) => s.merchant === "Acme Oy")).toMatchObject({ kind: "income", cadence: "monthly" });
  });

  it("marks a stopped subscription inactive and leaves it out of fixed costs", () => {
    const txs = series("2025-12-01", 30.44, 5, -999, { merchant: "Viaplay", category: "subscriptions" });
    const [s] = detectRecurring(txs, today);
    expect(s!.active).toBe(false);
    expect(fixedMonthlyCents([s!])).toBe(0);
  });

  it("does not turn two different purchases a year apart into a subscription", () => {
    const txs = [
      tx({ bookingDate: "2025-09-20", amountCents: -11282, merchant: "Verkkokauppa.com", category: "home" }),
      tx({ bookingDate: "2026-09-20", amountCents: -16348, merchant: "Verkkokauppa.com", category: "home" }),
    ];
    expect(detectRecurring(txs, today)).toEqual([]);
  });

  it("needs the old price to repeat before calling a change a price increase", () => {
    const txs = series("2026-05-07", 30.44, 3, (i) => (i < 1 ? -1599 : -1799), { merchant: "Kauppa", category: "subscriptions" });
    const [s] = detectRecurring(txs, today);
    expect(s?.kind).not.toBe("subscription");
  });

  it("ignores transfers and random one-offs", () => {
    const txs = [
      ...series("2026-01-01", 30.44, 9, -50000, { merchant: "Oma Säästötili", isTransfer: true, category: "transfer" }),
      tx({ bookingDate: "2026-05-05", amountCents: -12000, merchant: "IKEA", category: "home" }),
      tx({ bookingDate: "2026-08-17", amountCents: -4500, merchant: "IKEA", category: "home" }),
    ];
    expect(detectRecurring(txs, today)).toEqual([]);
  });
});

function addDaysLocal(start: string, d: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
}

describe("review regressions", () => {
  it("two similar grocery baskets a year apart are not a yearly subscription", () => {
    const shop = { merchant: "K-Supermarket", category: "groceries" };
    const txs = [
      tx({ ...shop, bookingDate: "2025-09-06", amountCents: -6580 }),
      tx({ ...shop, bookingDate: "2026-09-05", amountCents: -6593 }),
      ...[12, 40, 75, 110, 150, 190, 230, 270].map((d, i) => tx({ ...shop, bookingDate: addDays("2025-10-01", d), amountCents: -(1200 + i * 731) })),
    ];
    const found = detectRecurring(txs, "2026-10-09");
    expect(found.some((s) => s.kind === "subscription")).toBe(false);
  });

  it("the monthly amount follows a price increase", () => {
    const txs = series("2026-04-07", 30.4, 6, (i) => (i < 5 ? -1199 : -1399), { merchant: "Netflix", category: "subscriptions" });
    const [netflix] = detectRecurring(txs, "2026-10-09");
    expect(netflix?.priceChange).toBeTruthy();
    expect(netflix?.typicalAmountCents).toBe(1399);
    expect(netflix?.monthlyCents).toBe(1399);
  });

  it("fixed costs split into spending, debt service and saving", () => {
    const txs = [
      ...series("2026-04-05", 30.4, 6, -15000, { merchant: "Nordnet", category: "investments" }),
      ...series("2026-04-05", 30.4, 6, -28900, { merchant: "Nordea Rahoitus", category: "loans" }),
      ...series("2026-04-07", 30.4, 6, -1199, { merchant: "Spotify", category: "subscriptions" }),
    ];
    const found = detectRecurring(txs, "2026-10-09");
    expect(found).toHaveLength(3);
    expect(fixedSplit(found)).toEqual({ consumptionCents: 1199, debtCents: 28900, savingsCents: 15000 });
    // the overview tile and the recurring page show the same number: spending + debt, no savings
    expect(fixedMonthlyCents(found)).toBe(1199 + 28900);
  });
});

describe("next-level series fields", () => {
  it("monthly charges land on the same day of month (rent on the 1st → the 1st)", () => {
    const dates = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];
    const txs = dates.map((d) => tx({ bookingDate: d, amountCents: -95000, merchant: "Sato", category: "housing" }));
    const [s] = detectRecurring(txs, today);
    expect(s!.nextDate).toBe("2026-11-01");
    // 31.1. → 28.2.: clamped to the month's length
    const end = ["2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"].map((d) => tx({ bookingDate: d, amountCents: -999, merchant: "Kauppa", category: "subscriptions" }));
    expect(detectRecurring(end, "2026-02-05")[0]!.nextDate).toBe("2026-02-28");
    // weekly stays +7 days
    const weekly = series("2026-08-03", 7, 9, -500, { merchant: "Lehti", category: "subscriptions" });
    const w = detectRecurring(weekly, today)[0]!;
    expect(w.cadence).toBe("weekly");
    expect(w.nextDate).toBe(addDays(w.lastDate, 7));
  });

  it("a quarterly charge keeps its day of month", () => {
    const txs = ["2025-10-08", "2026-01-08", "2026-04-08", "2026-07-08"].map((d) => tx({ bookingDate: d, amountCents: -9640, merchant: "If", category: "insurance" }));
    const [s] = detectRecurring(txs, "2026-08-01");
    expect(s).toMatchObject({ cadence: "quarterly", nextDate: "2026-10-08" });
  });

  it("two payments a month on fixed days are semimonthly, not biweekly", () => {
    const days = [] as string[];
    for (const m of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) days.push(`${m}-15`, `${m}-${m === "2026-04" || m === "2026-06" || m === "2026-09" ? "30" : "31"}`);
    const txs = days.map((d, i) => tx({ bookingDate: d, amountCents: 178400 + (i % 3) * 1500, merchant: "Rakennus Oy", category: "salary" }));
    const [s] = detectRecurring(txs, today);
    expect(s).toMatchObject({ kind: "income", cadence: "semimonthly", nextDate: "2026-10-15" });
    expect(s!.monthlyCents).toBe(2 * s!.typicalAmountCents);
    // a real biweekly series drifts through the month
    const bi = series("2026-03-06", 14, 15, 150000, { merchant: "Vuokratyö Oy", category: "salary" });
    expect(detectRecurring(bi, today)[0]!.cadence).toBe("biweekly");
  });

  it("each series takes its category from its own rows", () => {
    const txs = [
      ...series("2025-10-20", 30.44, 12, -95120, { merchant: "Nordea", category: "mortgage" }),
      ...series("2025-10-01", 30.44, 12, -1380, { merchant: "Nordea", category: "fees" }),
      ...series("2025-10-02", 30.44, 14, -1380, { merchant: "Nordea", category: "fees" }).slice(12),
    ];
    const found = detectRecurring(txs, today).filter((s) => s.merchant === "Nordea");
    expect(found.find((s) => s.typicalAmountCents === 95120)?.category).toBe("mortgage");
    expect(found.find((s) => s.typicalAmountCents === 1380)?.category).toBe("fees");
  });

  it("payments to people, cash and transfers never form subscriptions or bills", () => {
    const txs = [
      ...series("2026-01-05", 30.44, 9, -5000, { merchant: "Laura Korhonen", category: "p2p" }),
      ...series("2026-01-06", 30.44, 9, 5000, { merchant: "Laura Korhonen", category: "p2p_in" }),
      ...series("2026-01-07", 30.44, 9, -6000, { merchant: "Otto", category: "cash" }),
      ...series("2026-01-08", 30.44, 9, -30000, { merchant: "Oma tili", category: "transfer" }),
    ];
    expect(detectRecurring(txs, today)).toEqual([]);
  });

  it("the same service on two accounts on the same day is two series, not a price change", () => {
    const txs = [
      ...series("2026-01-11", 30.44, 9, -1199, { merchant: "Spotify", category: "subscriptions", accountId: "a" }),
      ...series("2026-05-11", 30.44, 5, -1199, { merchant: "Spotify", category: "subscriptions", accountId: "b" }),
    ];
    const found = detectRecurring(txs, today);
    expect(found).toHaveLength(2);
    expect(found.every((s) => s.typicalAmountCents === 1199 && s.priceChange === null)).toBe(true);
    expect(new Set(found.map((s) => s.id)).size).toBe(2);
  });

  it("months active, yearly cost and an overdue charge", () => {
    const months = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
    const txs = months.map((m) => tx({ bookingDate: `${m}-04`, amountCents: -1599, merchant: "Netflix", category: "subscriptions" }));
    const [s] = detectRecurring(txs, "2026-09-06");
    expect(s).toMatchObject({ monthsActive: 9, yearlyCents: 1599 * 12, active: true, overdue: false, nextDate: "2026-09-04" });
    // the September charge (due 4.9.) has not come after more than 5 days
    expect(detectRecurring(txs, "2026-09-12")[0]).toMatchObject({ active: true, overdue: true });
  });

  it("marks a small long-running service for review, not a need or a new one", () => {
    const found = detectRecurring(
      [
        ...series("2025-11-27", 30.44, 11, -1099, { merchant: "Max", category: "subscriptions" }),
        ...series("2026-06-14", 30.44, 4, -699, { merchant: "Apple", category: "subscriptions" }),
        ...series("2025-10-14", 30.44, 12, -1299, { merchant: "Elisa", category: "telecom" }),
        ...series("2025-10-02", 30.44, 12, -199, { merchant: "Google One", category: "subscriptions" }),
        ...series("2025-10-05", 30.44, 12, -2399, { merchant: "Spotify", category: "subscriptions" }),
      ],
      today,
    );
    const review = (m: string) => found.find((s) => s.merchant === m)?.review;
    expect(review("Max")).toBe(true);
    expect(review("Apple")).toBe(false); // four months
    expect(review("Elisa")).toBe(false); // a phone is a need
    expect(review("Google One")).toBe(false); // storage
    expect(review("Spotify")).toBe(false); // over 15 €
  });

  it("an unused gym is reviewed at a gym's price, a gym with other purchases is not", () => {
    const gym = series("2026-01-01", 30.44, 10, -3290, { merchant: "Fitness24Seven", category: "fitness" });
    expect(detectRecurring(gym, today)[0]!.review).toBe(true);
    const used = [...gym, tx({ bookingDate: "2026-08-12", amountCents: -450, merchant: "Fitness24Seven", category: "fitness" })];
    expect(detectRecurring(used, today).find((s) => s.kind === "subscription")!.review).toBe(false);
  });

  it("projects the next charges of a series", () => {
    const apple = ["2026-05-14", "2026-06-14", "2026-07-14", "2026-08-14", "2026-09-14"].map((d) => tx({ bookingDate: d, amountCents: -699, merchant: "Apple", category: "subscriptions" }));
    const [s] = detectRecurring(apple, today);
    expect(projectDates(s!, "2026-12-31")).toEqual(["2026-10-14", "2026-11-14", "2026-12-14"]);
  });
});

/** A charge on `day` of every month from `from` to `to`, skipping the months in `skip` (1–12). */
function monthly(from: string, to: string, day: number, cents: number, partial: Partial<Transaction>, skip: number[] = []): Transaction[] {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    if (skip.includes(Number(m.slice(5, 7)))) continue;
    out.push(tx({ ...partial, bookingDate: `${m}-${String(day).padStart(2, "0")}`, amountCents: cents }));
  }
  return out;
}

describe("yearly cost and fixed costs", () => {
  it("a monthly fee with a summer break costs what its charges of the last twelve months cost", () => {
    const found = detectRecurring(
      [
        // day care is free in July, after-school care pauses from June to August
        ...monthly("2025-08", "2026-09", 15, -31100, { merchant: "Vantaan kaupunki päivähoito", category: "kids" }, [7]),
        ...monthly("2025-09", "2026-09", 16, -12000, { merchant: "Iltapäivätoiminta", category: "kids" }, [6, 7, 8]),
        ...monthly("2025-08", "2026-09", 4, -1599, { merchant: "Netflix", category: "subscriptions" }),
      ],
      today,
    );
    const by = (m: string) => found.find((s) => s.merchant === m)!;
    expect(by("Vantaan kaupunki päivähoito")).toMatchObject({ typicalAmountCents: 31100, yearlyCents: 11 * 31100, perMonth: 11 / 12 });
    expect(by("Iltapäivätoiminta")).toMatchObject({ yearlyCents: 9 * 12000, monthlyCents: 9000 });
    expect(by("Netflix")).toMatchObject({ yearlyCents: 12 * 1599, monthlyCents: 1599 });
  });

  it("an electricity bill costs a year what its winter and summer bills came to, not the summer times twelve", () => {
    const season = [172, 158, 131, 104, 78, 62, 58, 61, 79, 102, 136, 168];
    const charges = monthly("2025-08", "2026-09", 12, 0, { merchant: "Oomi", category: "utilities" }).map((t) => ({
      ...t,
      amountCents: -season[Number(t.bookingDate.slice(5, 7)) - 1]! * 100,
    }));
    const [s] = detectRecurring(charges, today);
    expect(s).toMatchObject({ kind: "bill", yearlyCents: season.reduce((a, v) => a + v, 0) * 100 });
    // the next charge is still expected near the recent ones
    expect(s!.typicalAmountCents).toBe(6100);
  });

  it("a bill paid late into the next month still counts twelve charges", () => {
    const charges = monthly("2025-09", "2026-09", 12, -6800, { merchant: "Oomi", category: "utilities" }).map((t) =>
      t.bookingDate === "2026-01-12" ? { ...t, bookingDate: "2026-02-03" } : t,
    );
    expect(detectRecurring(charges, today)[0]).toMatchObject({ yearlyCents: 12 * 6800 });
  });

  it("two payments a month of different sizes add up to their monthly total", () => {
    // housing allowance on the 8th (cut in April), child benefits on the 20th
    const kela = [
      ...monthly("2025-10", "2026-09", 8, 0, { merchant: "Kela", category: "benefits" }).map((t) => ({ ...t, amountCents: t.bookingDate < "2026-04" ? 18730 : 17420 })),
      ...monthly("2025-10", "2026-09", 20, 33002, { merchant: "Kela", category: "benefits" }),
    ];
    const found = detectRecurring(kela, today);
    expect(found.every((s) => s.kind === "income")).toBe(true);
    // one semimonthly series or one per payment: either way the month adds up
    const monthlyTotal = found.reduce((sum, s) => sum + s.monthlyCents, 0);
    expect(Math.abs(monthlyTotal - (17420 + 33002))).toBeLessThanOrEqual(1);
  });

  it("the credit card bill is expected every month but is not a fixed cost", () => {
    const found = detectRecurring(
      [
        ...series("2026-04-10", 30.44, 6, (i) => -(40000 + i * 3700), { merchant: "Nordea Rahoitus", category: "card_bill" }),
        ...series("2026-04-05", 30.44, 6, -51380, { merchant: "As Oy Helmipolku", category: "housing" }),
      ],
      today,
    );
    expect(found.find((s) => s.category === "card_bill")).toMatchObject({ kind: "bill", active: true });
    expect(found.filter(isFixedCost).map((s) => s.category)).toEqual(["housing"]);
    expect(fixedMonthlyCents(found)).toBe(51380);
  });

  it("two equal repair bills half a year apart are not a schedule, two insurance premiums are", () => {
    const found = detectRecurring(
      [
        tx({ bookingDate: "2025-11-27", amountCents: -61240, merchant: "Tikkurilan Autopalvelu Oy", category: "car" }),
        tx({ bookingDate: "2026-06-10", amountCents: -61240, merchant: "Tikkurilan Autopalvelu Oy", category: "car" }),
        tx({ bookingDate: "2026-01-09", amountCents: -21900, merchant: "If", category: "insurance" }),
        tx({ bookingDate: "2026-07-09", amountCents: -21900, merchant: "If", category: "insurance" }),
      ],
      today,
    );
    expect(found.map((s) => [s.merchant, s.cadence])).toEqual([["If", "semiannual"]]);
  });

  it("a 2,99 € storage tier is not asked about", () => {
    const apple = series("2025-10-12", 30.44, 12, -299, { merchant: "Apple", category: "subscriptions" });
    expect(detectRecurring(apple, today)[0]!.review).toBe(false);
    const bigger = series("2025-10-12", 30.44, 12, -699, { merchant: "Apple", category: "subscriptions" });
    expect(detectRecurring(bigger, today)[0]!.review).toBe(true);
  });
});

describe("a subscription paid with MobilePay", () => {
  const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
  const row = (bookingDate: string, cents: number, description: string) =>
    tx({ accountId: "chk", bookingDate, amountCents: cents, description, merchant: normalizeMerchant(null, description) });
  /** Bank rows through the enrichment, as the server stores them. */
  const enriched = (rows: Transaction[]) => {
    const changed = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
    return rows.map((t) => changed.get(t.id) ?? t);
  };

  it("two charges a month apart are a subscription among the fixed costs", () => {
    const rows = enriched([row("2026-08-12", -2499, "MOB.PAY*STORYTEL OY 7Q2K9X HELSINKI"), row("2026-09-12", -2499, "MOB.PAY*STORYTEL OY 3H8LW2 HELSINKI")]);
    expect(rows.map((t) => [t.merchant, t.category, t.isTransfer])).toEqual([
      ["Storytel", "subscriptions", false],
      ["Storytel", "subscriptions", false],
    ]);
    const found = detectRecurring(rows, today);
    expect(found).toMatchObject([{ merchant: "Storytel", kind: "subscription", cadence: "monthly", nextDate: "2026-10-12", monthlyCents: 2499, active: true }]);
    expect(found.filter(isFixedCost)).toHaveLength(1);
  });

  it("two charges a month apart with a refund after the first wait for a third charge", () => {
    const rows = enriched([
      row("2026-08-12", -2499, "MOB.PAY*STORYTEL OY 7Q2K9X HELSINKI"),
      row("2026-09-12", -2499, "MOB.PAY*STORYTEL OY 3H8LW2 HELSINKI"),
      row("2026-09-14", 2499, "MOB.PAY*STORYTEL OY 3H8LW2 HELSINKI"),
    ]);
    expect(detectRecurring(rows, today)).toEqual([]);
  });

  it("the same service paid by card before is one series with the MobilePay charges", () => {
    const rows = enriched([
      row("2026-06-12", -2499, "KORTTIOSTO 4581XXXXXXXX2241 STORYTEL OY HELSINKI"),
      row("2026-07-12", -2499, "KORTTIOSTO 4581XXXXXXXX2241 STORYTEL OY HELSINKI"),
      row("2026-08-12", -2499, "MOB.PAY*STORYTEL OY 7Q2K9X HELSINKI"),
      row("2026-09-12", -2499, "MOB.PAY*STORYTEL OY 3H8LW2 HELSINKI"),
    ]);
    expect(detectRecurring(rows, today)).toMatchObject([{ merchant: "Storytel", cadence: "monthly", occurrences: 4 }]);
  });

  it("a MobilePay payment to a person is never a series", () => {
    const rows = enriched(
      ["2026-07-03", "2026-08-03", "2026-09-03"].map((d) => tx({ accountId: "chk", bookingDate: d, amountCents: -3500, counterparty: "EMMA KORHONEN", description: "MOBILEPAY", merchant: normalizeMerchant("EMMA KORHONEN", "MOBILEPAY") })),
    );
    expect(rows[0]).toMatchObject({ merchant: "Emma Korhonen", category: "p2p" });
    expect(detectRecurring(rows, today)).toEqual([]);
  });

  // a third charge is still asked of everything else: two equal shop visits, school fees or app purchases a month
  // apart happen by chance, while a service in the subscriptions category bills one price every month
  it("two charges a month apart are not enough for a shop, a different price or two months apart", () => {
    const pair = (merchant: string, category: string, first: string, second: string, a: number, b = a) => [
      tx({ bookingDate: first, amountCents: a, merchant, category }),
      tx({ bookingDate: second, amountCents: b, merchant, category }),
    ];
    const found = detectRecurring(
      [
        ...pair("Lindex", "shopping", "2026-08-05", "2026-09-05", -2499),
        ...pair("Kansalaisopisto", "education", "2026-08-20", "2026-09-20", -4500),
        ...pair("Apple", "subscriptions", "2026-08-14", "2026-09-14", -499, -1299),
        ...pair("Nextory", "subscriptions", "2026-06-02", "2026-08-02", -1999),
        ...pair("Viaplay", "subscriptions", "2026-08-01", "2026-08-15", -1499),
      ],
      today,
    );
    expect(found).toEqual([]);
  });

  it("a service that moved from another card waits for its third charge there", () => {
    const found = detectRecurring(
      [
        ...series("2026-03-04", 30.44, 5, -1599, { accountId: "card", merchant: "Netflix", category: "subscriptions" }),
        ...series("2026-08-04", 30.44, 2, -1599, { accountId: "chk", merchant: "Netflix", category: "subscriptions" }),
      ],
      today,
    );
    expect(found.map((s) => s.id)).toEqual(["out:card:Netflix"]);
  });

  it("two charges a month apart long ago are a series that stopped", () => {
    const found = detectRecurring(series("2025-03-10", 30.44, 2, -1499, { merchant: "Viaplay", category: "subscriptions" }), today);
    expect(found).toMatchObject([{ merchant: "Viaplay", active: false }]);
    expect(found.filter(isFixedCost)).toEqual([]);
  });
});

describe("the usual day of a monthly series", () => {
  const on = (dates: readonly string[], cents = -4200, extra: Partial<Transaction> = {}) => dates.map((d) => tx({ bookingDate: d, amountCents: cents, merchant: "Sähkö Esimerkki Oy", category: "utilities", ...extra }));
  const next = (rows: Transaction[], day = "2026-10-25") => detectRecurring(rows, day).find((s) => s.merchant === "Sähkö Esimerkki Oy")!;

  it("a bill paid on the 15th in five months and on the 9th once keeps the 15th, wherever the odd payment is", () => {
    expect(next(on(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-09"])).nextDate).toBe("2026-11-15");
    expect(next(on(["2026-05-15", "2026-06-09", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"])).nextDate).toBe("2026-11-15");
    // a late one: paid on the 21st, and the next is still the 15th
    expect(next(on(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-21"])).nextDate).toBe("2026-11-15");
    // the seventh charge back is not read: six on the 9th outvote the older 15ths
    expect(next(on(["2026-02-15", "2026-03-15", "2026-04-15", "2026-05-09", "2026-06-09", "2026-07-09", "2026-08-09", "2026-09-09", "2026-10-09"])).nextDate).toBe("2026-11-09");
  });

  it("a charge every four weeks drifts through the month and keeps the day of the last one", () => {
    // 20.4., 18.5., 15.6., 13.7., 10.8., 7.9., 5.10.
    const drifting = series("2026-04-20", 28, 7, -4200, { merchant: "Sähkö Esimerkki Oy", category: "utilities" });
    expect(next(drifting)).toMatchObject({ cadence: "monthly", lastDate: "2026-10-05", nextDate: "2026-11-05" });
    // two odd payments of six are one too many for a usual day; one was not (the test above)
    expect(next(on(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-21", "2026-09-15", "2026-10-09"])).nextDate).toBe("2026-11-09");
  });

  it("two charges keep the day of the last one, three have a usual day", () => {
    const yearly = (dates: readonly string[]) => next(on(dates, -31_250, { category: "insurance" }), "2026-04-01").nextDate;
    expect(yearly(["2025-03-14", "2026-03-12"])).toBe("2027-03-12");
    expect(yearly(["2024-03-14", "2025-03-14", "2026-03-12"])).toBe("2027-03-14");
  });

  it("money in has a usual day too, and a refund from the payee does not move the day of a bill", () => {
    // the pay of the 25th came on Friday the 23rd: the next one is expected on the 25th, not on the 23rd
    const pay = on(["2026-05-25", "2026-06-25", "2026-07-24", "2026-08-25", "2026-09-25", "2026-10-23"], 250_000, { category: "salary" });
    expect(next(pay)).toMatchObject({ kind: "income", nextDate: "2026-11-25" });
    const bill = on(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-09"]);
    const refund = tx({ bookingDate: "2026-10-12", amountCents: 1500, merchant: "Sähkö Esimerkki Oy", category: "utilities" });
    expect(detectRecurring([...bill, refund], "2026-10-25").map((s) => [s.kind, s.nextDate])).toEqual([["subscription", "2026-11-15"]]);
  });

  it("a series at the turn of the month comes on the 1st, and one on the last day stays on the last day", () => {
    // rent on the 1st, or on the Friday before when the 1st is closed: after 30.10. the next is 1.12., not 30.11.
    expect(next(on(["2026-06-01", "2026-07-01", "2026-07-31", "2026-09-01", "2026-10-01", "2026-10-30"]), "2026-11-05").nextDate).toBe("2026-12-01");
    // half before the turn and half after it: the 1st, and not the middle of the month
    expect(next(on(["2026-04-30", "2026-06-01", "2026-06-30", "2026-07-31", "2026-09-01", "2026-10-01"])).nextDate).toBe("2026-11-01");
    const last = next(on(["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]), "2026-10-09");
    expect(last.nextDate).toBe("2026-10-31");
    expect(projectDates(last, "2027-02-28")).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  it("a quarterly bill keeps its usual day through an early payment", () => {
    const s = next(on(["2025-10-08", "2026-01-08", "2026-04-08", "2026-07-03"], -9640, { category: "insurance" }), "2026-08-01");
    expect(s).toMatchObject({ cadence: "quarterly", nextDate: "2026-10-08" });
    expect(projectDates(s, "2027-04-30")).toEqual(["2026-10-08", "2027-01-08", "2027-04-08"]);
  });
});
