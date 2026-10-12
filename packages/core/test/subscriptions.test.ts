import { describe, expect, it } from "vitest";
import { type Alert, buildAlerts } from "../src/analysis/alerts.ts";
import { createContext } from "../src/analysis/context.ts";
import { inUseQuietsQuestion } from "../src/analysis/subscription-alerts.ts";
import { fixedMonthlyCents, fixedSplit, isSubscription, subscriptionsMonthlyCents } from "../src/commitments.ts";
import type { Account, Transaction, UserInputs, UserMark } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const year = { from: "2025-11-01", to: today };

/** `count` charges on the same day of each month, nothing after today. */
function monthly(start: string, count: number, amountCents: number, partial: Partial<Transaction>): Transaction[] {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    const date = `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return tx({ ...partial, bookingDate: date, amountCents });
  }).filter((t) => t.bookingDate <= today);
}

/** Salary, rent and groceries, then a gym at 59 €, a design suite, a small app and an insurance. */
function household(): Transaction[] {
  return [
    ...monthly("2025-10-25", 13, 300000, { merchant: "Acme Oy", category: "salary" }),
    ...monthly("2025-10-02", 13, -95000, { merchant: "Sato", category: "housing" }),
    ...series("2025-10-01", 7, 54, (i) => -(6500 + (i % 5) * 1700), { merchant: "Prisma", category: "groceries" }),
    ...monthly("2025-10-01", 13, -5900, { merchant: "Elixia", category: "fitness" }),
    ...monthly("2025-10-04", 13, -2399, { merchant: "Adobe", category: "subscriptions" }),
    ...monthly("2025-11-27", 11, -1099, { merchant: "Max", category: "subscriptions" }),
    ...monthly("2025-10-15", 12, -4500, { merchant: "If", category: "insurance" }),
  ].filter((t) => t.bookingDate <= today);
}

const mark = (subject: string, kind: UserMark["mark"], day: string): UserMark => ({ subject, mark: kind, markedAt: `${day}T08:30:00.000Z` });
const inputs = (...marks: UserMark[]): UserInputs => ({ marks, expectedBills: [] });
const plain = (s: string) => s.replace(/\s/g, " ");
const alertsOf = (txs: Transaction[], marks: UserInputs, range = year) =>
  buildAlerts(createContext(txs, [checking], today), range, marks).map((a) => ({ ...a, title: plain(a.title), detail: plain(a.detail) }));
const ofKind = (alerts: Alert[], kind: Alert["kind"]) => alerts.filter((a) => a.kind === kind);

describe("subscriptions total", () => {
  const ctx = createContext(household(), [checking], today);
  const cancelled = new Set(["Elixia"]);

  it("counts the three subscriptions and not the insurance, and leaves a cancelled merchant out", () => {
    const rows = ctx.recurring.filter(isSubscription);
    expect(rows.map((s) => s.merchant).sort()).toEqual(["Adobe", "Elixia", "Max"]);
    expect(ctx.recurring.find((s) => s.merchant === "If")?.kind).toBe("subscription");

    const all = subscriptionsMonthlyCents(ctx.recurring);
    expect(all).toBe(rows.reduce((sum, s) => sum + s.monthlyCents, 0));
    expect(subscriptionsMonthlyCents(ctx.recurring, cancelled)).toBe(all - 5900);
  });

  it("equals the rows the recurring page lists: the same two predicates, so tile, section and rows cannot differ", () => {
    // the page lists isSubscription series that are not marked cancelled, and writes subscriptionsMonthlyCents above them
    const rows = ctx.recurring.filter((s) => isSubscription(s) && !cancelled.has(s.merchant));
    expect(rows.map((s) => s.merchant).sort()).toEqual(["Adobe", "Max"]);
    expect(rows.reduce((sum, s) => sum + s.monthlyCents, 0)).toBe(subscriptionsMonthlyCents(ctx.recurring, cancelled));
    // the review list is part of the same rows: the gym and the app are asked about, the dearer design suite is not
    expect(ctx.recurring.filter((s) => s.review).map((s) => s.merchant).sort()).toEqual(["Elixia", "Max"]);
    expect(ctx.recurring.filter((s) => s.review).every(isSubscription)).toBe(true);
  });
});

describe("fixed costs and a cancelled subscription", () => {
  const ctx = createContext(household(), [checking], today);

  it("a merchant marked as cancelled is out of the split and the total when the caller passes it", () => {
    const all = fixedSplit(ctx.recurring);
    const without = fixedSplit(ctx.recurring, new Set(["Elixia"]));
    expect(all.consumptionCents - without.consumptionCents).toBe(5900);
    expect(without.debtCents).toBe(all.debtCents);
    expect(fixedMonthlyCents(ctx.recurring) - fixedMonthlyCents(ctx.recurring, new Set(["Elixia"]))).toBe(5900);
    // a merchant that is income, or not there, changes nothing; so does the default
    expect(fixedMonthlyCents(ctx.recurring, new Set(["Acme Oy", "Nobody"]))).toBe(fixedMonthlyCents(ctx.recurring));
    expect(fixedSplit(ctx.recurring, new Set())).toEqual(all);
  });

  it("series without a merchant (a caller that passes only the cost fields) are counted as before", () => {
    const bare = ctx.recurring.map(({ active, kind, category, monthlyCents }) => ({ active, kind, category, monthlyCents }));
    expect(fixedSplit(bare)).toEqual(fixedSplit(ctx.recurring));
  });
});

describe("the forgotten question", () => {
  it("names the cost per month and per year, then asks", () => {
    const a = ofKind(alertsOf(household(), inputs()), "forgotten");
    expect(a.map((x) => [x.title, x.detail])).toEqual([
      ["Elixia 59 €/kk, 708 € vuodessa", expect.stringMatching(/^Maksettu \d+ kuukautta\.$/)],
      ["Max 10,99 €/kk, 132 € vuodessa", expect.stringMatching(/^Maksettu \d+ kuukautta\.$/)],
    ]);
    expect(a[0]).toMatchObject({ tone: "info", merchant: "Elixia" });
  });

  it("in use quiets the question for twelve months, then it comes back", () => {
    const merchants = (marks: UserInputs) => ofKind(alertsOf(household(), marks), "forgotten").map((a) => a.merchant);
    expect(merchants(inputs(mark("merchant:Elixia", "in_use", "2026-03-10")))).toEqual(["Max"]);
    // exactly twelve months ago still counts, a day more does not
    expect(merchants(inputs(mark("merchant:Elixia", "in_use", "2025-10-09")))).toEqual(["Max"]);
    expect(merchants(inputs(mark("merchant:Elixia", "in_use", "2025-10-08")))).toEqual(["Elixia", "Max"]);
    // a mark on another merchant, or another kind of mark, changes nothing for this one
    expect(merchants(inputs(mark("merchant:Adobe", "in_use", "2026-03-10"), mark("alert:forgotten:x", "in_use", "2026-03-10")))).toEqual(["Elixia", "Max"]);
  });

  it("a cancelled merchant is not asked about", () => {
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Elixia", "cancelled", "2025-12-01"))), "forgotten").map((a) => a.merchant)).toEqual(["Max"]);
  });

  it("the rule is one function the page shares", () => {
    const m = (kind: UserMark["mark"], day: string) => mark("merchant:X", kind, day);
    expect(inUseQuietsQuestion(m("in_use", "2026-10-09"), today)).toBe(true);
    expect(inUseQuietsQuestion(m("in_use", "2025-10-09"), today)).toBe(true);
    expect(inUseQuietsQuestion(m("in_use", "2025-10-08"), today)).toBe(false);
    expect(inUseQuietsQuestion(m("cancelled", "2026-10-09"), today)).toBe(false);
    expect(inUseQuietsQuestion(m("dismissed", "2026-10-09"), today)).toBe(false);
    // a leap day does not break the month arithmetic
    expect(inUseQuietsQuestion(m("in_use", "2027-03-01"), "2028-02-29")).toBe(true);
    expect(inUseQuietsQuestion(m("in_use", "2027-02-27"), "2028-02-29")).toBe(false);
  });
});

describe("a charge after cancelling", () => {
  const cancelledGym = inputs(mark("merchant:Elixia", "cancelled", "2026-09-15"));

  it("is a warning with the merchant link", () => {
    const [a, ...rest] = ofKind(alertsOf(household(), cancelledGym), "cancelled");
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      tone: "warning",
      title: "Elixia veloitti 1.10.2026, vaikka merkitsit sen lopetetuksi.",
      detail: "59,00 €",
      merchant: "Elixia",
    });
    expect(a!.id).toMatch(/^cancelled:/);
  });

  it("counts every charge after the mark, not the ones before it or on its day", () => {
    const more = [...household(), tx({ merchant: "Elixia", category: "fitness", bookingDate: "2026-10-05", amountCents: -2500 })];
    const [a] = ofKind(alertsOf(more, cancelledGym), "cancelled");
    expect(a).toMatchObject({ title: "Elixia veloitti 5.10.2026, vaikka merkitsit sen lopetetuksi.", detail: "2 veloitusta, yhteensä 84,00 €" });
    // marked on the day of the last charge: nothing came after it
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Elixia", "cancelled", "2026-10-01"))), "cancelled")).toEqual([]);
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Elixia", "cancelled", "2026-10-02"))), "cancelled")).toEqual([]);
  });

  it("leaves out a charge booked within three days of the mark: it was pending when the user marked it", () => {
    const warned = (day: string) => ofKind(alertsOf(household(), inputs(mark("merchant:Elixia", "cancelled", day))), "cancelled").length;
    // the charge is booked on 1.10.
    expect(warned("2026-09-30")).toBe(0);
    expect(warned("2026-09-28")).toBe(0);
    // four days is a charge the cancellation did not stop
    expect(warned("2026-09-27")).toBe(1);
    // a mark with the instance's offset counts by its local day
    expect(ofKind(alertsOf(household(), inputs({ subject: "merchant:Elixia", mark: "cancelled", markedAt: "2026-09-27T01:30:00+03:00" })), "cancelled")).toHaveLength(1);
  });

  it("needs the merchant to be marked cancelled, and the charge to fall in the period", () => {
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Elixia", "in_use", "2026-09-15"))), "cancelled")).toEqual([]);
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Adobe", "cancelled", "2026-10-05"))), "cancelled")).toEqual([]);
    expect(ofKind(alertsOf(household(), cancelledGym, { from: "2026-08-01", to: "2026-09-30" }), "cancelled")).toEqual([]);
    expect(ofKind(alertsOf(household(), inputs()), "cancelled")).toEqual([]);
  });

  it("a charge the merchant paid back is settled", () => {
    const back = tx({ merchant: "Elixia", category: "fitness", bookingDate: "2026-10-03", amountCents: 5900 });
    expect(ofKind(alertsOf([...household(), back], cancelledGym), "cancelled")).toEqual([]);
  });
});

describe("a dismissed alert", () => {
  it("is gone, and only that one", () => {
    const before = alertsOf(household(), inputs());
    const forgotten = ofKind(before, "forgotten");
    expect(forgotten.map((a) => a.merchant)).toEqual(["Elixia", "Max"]);

    const after = alertsOf(household(), inputs(mark(`alert:${forgotten[0]!.id}`, "dismissed", "2026-10-09")));
    expect(ofKind(after, "forgotten").map((a) => a.merchant)).toEqual(["Max"]);
    expect(after.filter((a) => a.kind !== "forgotten")).toEqual(before.filter((a) => a.kind !== "forgotten"));
  });

  it("a double charge goes the same way, and a mark of another kind on an alert id does nothing", () => {
    const twice = [tx({ merchant: "K-Citymarket", category: "groceries", bookingDate: "2026-05-16", amountCents: -16743 }), tx({ merchant: "K-Citymarket", category: "groceries", bookingDate: "2026-05-16", amountCents: -16743 })];
    const all = [...household(), ...twice];
    const [double] = ofKind(alertsOf(all, inputs()), "double_charge");
    expect(double).toBeDefined();
    expect(ofKind(alertsOf(all, inputs(mark(`alert:${double!.id}`, "in_use", "2026-10-09"))), "double_charge")).toHaveLength(1);
    expect(ofKind(alertsOf(all, inputs(mark(`merchant:${double!.id}`, "dismissed", "2026-10-09"))), "double_charge")).toHaveLength(1);
    expect(ofKind(alertsOf(all, inputs(mark(`alert:${double!.id}`, "dismissed", "2026-10-09"))), "double_charge")).toEqual([]);
  });

  it("only two services are asked about: marking one in use lets the next in, dismissing its alert only removes it", () => {
    const course = monthly("2025-10-20", 12, -899, { merchant: "Duolingo", category: "education" });
    const all = [...household(), ...course];
    const asked = ofKind(alertsOf(all, inputs()), "forgotten");
    expect(asked.map((a) => a.merchant)).toEqual(["Elixia", "Max"]);
    const merchants = (marks: UserInputs) => ofKind(alertsOf(all, marks), "forgotten").map((a) => a.merchant);
    expect(merchants(inputs(mark("merchant:Elixia", "in_use", "2026-10-09")))).toEqual(["Max", "Duolingo"]);
    expect(merchants(inputs(mark(`alert:${asked[0]!.id}`, "dismissed", "2026-10-09")))).toEqual(["Max"]);
  });
});
