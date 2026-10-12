import { describe, expect, it } from "vitest";
import { type Alert, buildAlerts } from "../src/analysis/alerts.ts";
import { createContext } from "../src/analysis/context.ts";
import { chargedAfterCancelling, countingMark, coveringMark, marksBySubject, renamedMarkSubject, seriesMarkSubject, seriesOfMarkSubject } from "../src/analysis/subscription-alerts.ts";
import { cancelledSubjects, expectedCharges, fixedMonthlyCents, isCancelled, isSubscription, subscriptionsMonthlyCents } from "../src/commitments.ts";
import type { RecurringSeries } from "../src/recurring.ts";
import type { Account, Transaction, UserInputs, UserMark } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const TODAY = "2026-10-09";
const year = { from: "2025-11-01", to: TODAY };

/** `count` charges on the same day of each month, nothing after `until`. */
function monthly(start: string, count: number, amountCents: number | ((i: number) => number), partial: Partial<Transaction>, until = TODAY): Transaction[] {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    const date = `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return tx({ ...partial, bookingDate: date, amountCents: typeof amountCents === "function" ? amountCents(i) : amountCents });
  }).filter((t) => t.bookingDate <= until);
}

const apple = { merchant: "Apple", category: "subscriptions" };
const pay = () => monthly("2025-10-25", 13, 300000, { merchant: "Acme Oy", category: "salary" });
/** Apple's storage at 7,99 on the 3rd, from November. */
const storage = (until = TODAY) => monthly("2025-11-03", 24, -799, apple, until);
/** Apple's music at 12,99 on the 17th, from October. */
const music = (until = TODAY) => monthly("2025-10-17", 24, -1299, apple, until);
/** Pay, and the two subscriptions Apple charges for on one account. */
const household = (): Transaction[] => [...pay(), ...storage(), ...music()];

const STORAGE = "series:out:acc-1:Apple#799";
const MUSIC = "series:out:acc-1:Apple#1299";

const mark = (subject: string, kind: UserMark["mark"], day: string): UserMark => ({ subject, mark: kind, markedAt: `${day}T08:30:00.000Z` });
const inputs = (...marks: UserMark[]): UserInputs => ({ marks, expectedBills: [] });
const plain = (s: string) => s.replace(/\s/g, " ");
const contextOf = (txs: Transaction[], today = TODAY) => createContext(txs, [checking], today);
const alertsOf = (txs: Transaction[], marks: UserInputs) => buildAlerts(contextOf(txs), year, marks).map((a) => ({ ...a, title: plain(a.title), detail: plain(a.detail) }));
const ofKind = (alerts: Alert[], kind: Alert["kind"]) => alerts.filter((a) => a.kind === kind);
const appleSeries = (txs: Transaction[], today = TODAY) => contextOf(txs, today).recurring.filter((s) => s.merchant === "Apple").sort((a, b) => a.typicalAmountCents - b.typicalAmountCents);
/** The Apple series a list of marks covers today, by price. */
const covered = (rows: RecurringSeries[], ...marks: UserMark[]) => rows.filter((s) => countingMark(marksBySubject(marks), s, TODAY)).map((s) => s.typicalAmountCents);

describe("a mark belongs to one series: its subject", () => {
  it("names the merchant, the account and the price, and a new charge in the series keeps it", () => {
    const [small, large] = appleSeries(household());
    expect([small!.id, large!.id]).toEqual(["out:acc-1:Apple#799", "out:acc-1:Apple#1299"]);
    expect([seriesMarkSubject(small!), seriesMarkSubject(large!)]).toEqual([STORAGE, MUSIC]);

    // a month later both have charged once more
    const later = appleSeries([...pay(), ...storage("2026-11-09"), ...music("2026-11-09")], "2026-11-09");
    expect(later.map((s) => s.occurrences)).toEqual([small!.occurrences + 1, large!.occurrences + 1]);
    expect(later.map(seriesMarkSubject)).toEqual([STORAGE, MUSIC]);
  });

  it("carries the price for a merchant's only series too, so a second series of the merchant does not move the mark", () => {
    // alone the series has an id without a price: the id changes the day Apple charges for something else
    const [alone] = appleSeries([...pay(), ...storage()]);
    expect(alone!.id).toBe("out:acc-1:Apple");
    expect(seriesMarkSubject(alone!)).toBe(STORAGE);

    const both = appleSeries(household());
    expect(both.map((s) => s.id)).toEqual(["out:acc-1:Apple#799", "out:acc-1:Apple#1299"]);
    expect(covered(both, mark(STORAGE, "cancelled", "2026-06-01"))).toEqual([799]);
  });

  it("is read back by one parser, and follows a merchant that got a new name", () => {
    expect(seriesOfMarkSubject(STORAGE)).toEqual({ direction: "out", accountId: "acc-1", merchant: "Apple", product: 799 });
    expect(seriesOfMarkSubject("series:out:acc-1:Helen")).toEqual({ direction: "out", accountId: "acc-1", merchant: "Helen", product: null });
    for (const other of ["merchant:Apple", "alert:forgotten:out:acc-1:Apple", "series:Apple", "series:", "out:acc-1:Apple#799"]) expect(seriesOfMarkSubject(other), other).toBeNull();

    const renames = new Map([["APPLE COM BILL", "Apple"]]);
    expect(renamedMarkSubject("series:out:acc-1:APPLE COM BILL#799", renames)).toBe(STORAGE);
    expect(renamedMarkSubject("merchant:APPLE COM BILL", renames)).toBe("merchant:Apple");
    // "Ei laina" on a proposed loan names its series after a prefix of its own (loan-detect.ts)
    expect(renamedMarkSubject("loan-proposal:out:acc-1:APPLE COM BILL#799", renames)).toBe("loan-proposal:out:acc-1:Apple#799");
    for (const kept of [STORAGE, "merchant:Apple", "alert:forgotten:out:acc-1:APPLE COM BILL", "alert:out:acc-1:APPLE COM BILL", "series:out:acc-1:Netflix", "loan-proposal:out:acc-1:Netflix#799", "loan-proposal:APPLE COM BILL"]) {
      expect(renamedMarkSubject(kept, renames), kept).toBeNull();
    }
  });

  it("a bill of varying size has no price to name: its subject is its id", () => {
    const power = monthly("2025-10-12", 12, (i) => -(6200 + ((i * 37) % 9) * 410), { merchant: "Helen", category: "utilities" });
    const [bill] = contextOf([...pay(), ...power]).recurring.filter((s) => s.merchant === "Helen");
    expect(bill).toMatchObject({ kind: "bill", id: "out:acc-1:Helen" });
    expect(seriesMarkSubject(bill!)).toBe("series:out:acc-1:Helen");
    expect(countingMark(marksBySubject([mark("series:out:acc-1:Helen", "cancelled", "2026-06-01")]), bill!, TODAY)).not.toBeNull();
    // a mark with a price is on a subscription, never on the bill
    expect(countingMark(marksBySubject([mark("series:out:acc-1:Helen#6200", "cancelled", "2026-06-01")]), bill!, TODAY)).toBeNull();
  });
});

describe("a mark belongs to one series: two series of one merchant", () => {
  const ctx = contextOf(household());
  const all = fixedMonthlyCents(ctx.recurring);

  it("one marked as cancelled leaves the totals and the coming charges, the other stays", () => {
    const cancelled = cancelledSubjects(inputs(mark(STORAGE, "cancelled", "2026-09-10")));
    expect(ctx.recurring.filter((s) => isSubscription(s) && isCancelled(cancelled, s)).map((s) => s.typicalAmountCents)).toEqual([799]);
    expect(fixedMonthlyCents(ctx.recurring, cancelled)).toBe(all - 799);
    expect(subscriptionsMonthlyCents(ctx.recurring, cancelled)).toBe(1299);
    expect(expectedCharges(ctx.recurring, TODAY, "2026-11-09", { cancelled }).map((c) => [c.merchant, c.amountCents, c.date])).toEqual([["Apple", 1299, "2026-10-17"]]);
    // marked in use it is not cancelled
    expect(fixedMonthlyCents(ctx.recurring, cancelledSubjects(inputs(mark(STORAGE, "in_use", "2026-09-10"))))).toBe(all);
  });

  it("one answered is not asked about, the other still is", () => {
    const asked = (marks: UserInputs) => ofKind(alertsOf(household(), marks), "forgotten").map((a) => a.title);
    expect(asked(inputs())).toEqual(["Apple 12,99 €/kk, 156 € vuodessa", "Apple 7,99 €/kk, 96 € vuodessa"]);
    expect(asked(inputs(mark(STORAGE, "cancelled", "2026-09-10")))).toEqual(["Apple 12,99 €/kk, 156 € vuodessa"]);
    expect(asked(inputs(mark(MUSIC, "in_use", "2026-09-10")))).toEqual(["Apple 7,99 €/kk, 96 € vuodessa"]);
    // Käytössä answers for twelve months, as it did on a merchant
    expect(asked(inputs(mark(MUSIC, "in_use", "2025-10-08")))).toHaveLength(2);
    expect(asked(inputs(mark(STORAGE, "in_use", "2026-09-10"), mark(MUSIC, "cancelled", "2026-09-10")))).toEqual([]);
  });

  it("the question says which series an answer is stored under", () => {
    const subjects = ofKind(alertsOf(household(), inputs()), "forgotten").map((a) => a.markSubject);
    expect(subjects).toEqual([MUSIC, STORAGE]);
  });

  it("a charge of the cancelled one is a warning, a charge of the other is not", () => {
    // storage charges on 3.10., music on 17.9.: both after the mark and its days of grace
    const [a, ...rest] = ofKind(alertsOf(household(), inputs(mark(STORAGE, "cancelled", "2026-09-10"))), "cancelled");
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ title: "Apple veloitti 3.10.2026, vaikka merkitsit sen lopetetuksi.", detail: "7,99 €", merchant: "Apple" });

    const [b, ...others] = ofKind(alertsOf(household(), inputs(mark(MUSIC, "cancelled", "2026-09-10"))), "cancelled");
    expect(others).toEqual([]);
    expect(b).toMatchObject({ title: "Apple veloitti 17.9.2026, vaikka merkitsit sen lopetetuksi.", detail: "12,99 €" });

    // both cancelled: a warning for each mark
    const two = ofKind(alertsOf(household(), inputs(mark(STORAGE, "cancelled", "2026-09-10"), mark(MUSIC, "cancelled", "2026-09-10"))), "cancelled");
    expect(two.map((w) => w.detail)).toEqual(["7,99 €", "12,99 €"]);
    // in use, or marked after its last charge: nothing to warn about
    expect(ofKind(alertsOf(household(), inputs(mark(STORAGE, "in_use", "2026-09-10"), mark(MUSIC, "cancelled", "2026-09-20"))), "cancelled")).toEqual([]);
  });

  it("an old mark on the merchant covers both, as before", () => {
    const old = inputs(mark("merchant:Apple", "cancelled", "2026-09-10"));
    const cancelled = cancelledSubjects(old);
    expect([...cancelled]).toEqual(["Apple"]);
    expect(fixedMonthlyCents(ctx.recurring, cancelled)).toBe(all - 799 - 1299);
    expect(subscriptionsMonthlyCents(ctx.recurring, cancelled)).toBe(0);
    expect(expectedCharges(ctx.recurring, TODAY, "2026-11-09", { cancelled })).toEqual([]);
    const alerts = alertsOf(household(), old);
    expect(ofKind(alerts, "forgotten")).toEqual([]);
    // one warning for the merchant, every charge after the mark in it
    expect(ofKind(alerts, "cancelled").map((a) => [a.title, a.detail])).toEqual([["Apple veloitti 3.10.2026, vaikka merkitsit sen lopetetuksi.", "2 veloitusta, yhteensä 20,98 €"]]);
    expect(ofKind(alertsOf(household(), inputs(mark("merchant:Apple", "in_use", "2026-09-10"))), "forgotten")).toEqual([]);
  });

  it("a mark on a series that is gone, on another account or of another merchant changes nothing", () => {
    const gone = inputs(
      mark("series:out:acc-1:Apple#299", "cancelled", "2026-09-10"),
      mark("series:out:acc-9:Apple#799", "cancelled", "2026-09-10"),
      mark("series:in:acc-1:Apple#799", "cancelled", "2026-09-10"),
      mark("series:out:acc-1:Apple", "cancelled", "2026-09-10"),
      mark("series:out:acc-1:Apple#habit", "cancelled", "2026-09-10"),
      mark("series:out:acc-1:Netflix#799", "in_use", "2026-09-10"),
    );
    expect(fixedMonthlyCents(ctx.recurring, cancelledSubjects(gone))).toBe(all);
    expect(expectedCharges(ctx.recurring, TODAY, "2026-11-09", { cancelled: cancelledSubjects(gone) })).toHaveLength(2);
    expect(alertsOf(household(), gone)).toEqual(alertsOf(household(), inputs()));
    expect(covered(appleSeries(household()), ...gone.marks)).toEqual([]);
  });

  it("Lopetettu wins over Käytössä, of two alike the later counts, and a mark of another kind is no answer", () => {
    const rows = appleSeries(household());
    const of = (...marks: UserMark[]) => coveringMark(marksBySubject(marks), rows[0]!, (m) => m.markedAt);
    expect(of(mark("merchant:Apple", "cancelled", "2026-01-05"), mark(STORAGE, "in_use", "2026-09-10"))).toMatchObject({ subject: "merchant:Apple", mark: "cancelled" });
    expect(of(mark("merchant:Apple", "in_use", "2026-01-05"), mark(STORAGE, "in_use", "2026-09-10"))).toMatchObject({ subject: STORAGE });
    expect(of(mark("merchant:Apple", "in_use", "2026-09-10"), mark(STORAGE, "in_use", "2026-01-05"))).toMatchObject({ subject: "merchant:Apple" });
    expect(of(mark(MUSIC, "cancelled", "2026-09-10"))).toBeUndefined();
    expect(covered(rows, mark(STORAGE, "dismissed", "2026-09-10"), mark("merchant:Apple", "dismissed", "2026-09-10"))).toEqual([]);
  });
});

describe("a mark belongs to one series: a price that moves", () => {
  it("holds when the price drifts by cents, as a charge in another currency does", () => {
    const drifting = monthly("2025-11-03", 12, (i) => -(2000 + i * 9), { merchant: "Figma", category: "subscriptions" });
    const [s] = contextOf([...pay(), ...drifting]).recurring.filter((r) => r.merchant === "Figma");
    expect(s).toMatchObject({ kind: "subscription", priceChange: null });
    expect(seriesMarkSubject(s!)).not.toBe("series:out:acc-1:Figma#2000");
    expect(countingMark(marksBySubject([mark("series:out:acc-1:Figma#2000", "in_use", "2026-01-10")]), s!, TODAY)).not.toBeNull();
  });

  it("holds through a rise, and a charge at the new price after Lopetettu is a warning", () => {
    // 13,99 until June, 15,99 from July: one series with a price change, and too far apart to be the same price
    const rising = monthly("2025-11-05", 12, (i) => (i < 8 ? -1399 : -1599), { merchant: "Netflix", category: "subscriptions" });
    const ctx = contextOf([...pay(), ...rising]);
    const [s] = ctx.recurring.filter((r) => r.merchant === "Netflix");
    expect(s).toMatchObject({ id: "out:acc-1:Netflix", typicalAmountCents: 1599, priceChange: { fromCents: 1399, toCents: 1599 } });
    const before = marksBySubject([mark("series:out:acc-1:Netflix#1399", "cancelled", "2026-06-20")]);
    expect(countingMark(before, s!, TODAY)).not.toBeNull();
    expect(fixedMonthlyCents(ctx.recurring, cancelledSubjects(inputs(...before.values())))).toBe(0);

    const charges = ctx.txs.filter((t) => t.merchant === "Netflix" && t.bookingDate >= "2026-07-01");
    const warned = chargedAfterCancelling(charges, before, ctx.recurring);
    expect(warned.map((a) => plain(a.detail))).toEqual(["4 veloitusta, yhteensä 63,96 €"]);
    // and so on the overview, which hands the series over
    expect(ofKind(alertsOf([...pay(), ...rising], inputs(...before.values())), "cancelled").map((a) => a.detail)).toEqual(["4 veloitusta, yhteensä 63,96 €"]);
    // without the series only the price says whose charge it is, and 15,99 is not 13,99
    expect(chargedAfterCancelling(charges, before)).toEqual([]);
  });

  it("stays with its series when that ends: the merchant's other series is not covered", () => {
    // storage was cancelled in March and stopped; music goes on
    const rows = appleSeries([...pay(), ...storage("2026-03-09"), ...music()]);
    expect(rows.map((s) => [s.typicalAmountCents, s.active])).toEqual([[799, false], [1299, true]]);
    const old = mark(STORAGE, "cancelled", "2026-03-10");
    expect(covered(rows, old)).toEqual([799]);
    expect(subscriptionsMonthlyCents(rows, cancelledSubjects(inputs(old)))).toBe(1299);
    expect(ofKind(alertsOf([...pay(), ...storage("2026-03-09"), ...music()], inputs(old)), "cancelled")).toEqual([]);
  });
});
