import { describe, expect, it } from "vitest";
import { type Alert, buildAlerts } from "../src/analysis/alerts.ts";
import { createContext } from "../src/analysis/context.ts";
import { addDays } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const other: Account = { id: "acc-2", name: "Toinen", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const year = { from: "2025-11-01", to: today };

/** A plain household from 1.10.2025: salary, rent and weekly groceries. Nothing here should alert. */
function household(): Transaction[] {
  return [
    ...monthly("2025-10-25", 13, 300000, { merchant: "Acme Oy", category: "salary" }),
    ...monthly("2025-10-02", 13, -95000, { merchant: "Sato", category: "housing" }),
    ...series("2025-10-01", 7, 54, (i) => -(6500 + (i % 5) * 1700), { merchant: "Prisma", category: "groceries" }),
  ].filter((t) => t.bookingDate <= today);
}

/** `count` charges on the same day of each month. */
function monthly(start: string, count: number, amountCents: number, partial: Partial<Transaction>): Transaction[] {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    const date = `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return tx({ ...partial, bookingDate: date, amountCents });
  }).filter((t) => t.bookingDate <= today);
}

const plain = (s: string) => s.replace(/\s/g, " ").replace(/−/g, "-");
const alertsOf = (txs: Transaction[], range = year, accounts = [checking]) =>
  buildAlerts(createContext(txs, accounts, today), range).map((a) => ({ ...a, title: plain(a.title), detail: plain(a.detail) }));
const ofKind = (alerts: Alert[], kind: Alert["kind"]) => alerts.filter((a) => a.kind === kind);

describe("alerts", () => {
  it("a plain household has none", () => {
    expect(alertsOf(household())).toEqual([]);
  });

  describe("double_charge", () => {
    const shop = { merchant: "K-Citymarket", category: "groceries" };
    it("finds the same charge twice on one day", () => {
      const twice = [tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 }), tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 })];
      const [a] = ofKind(alertsOf([...household(), ...twice]), "double_charge");
      expect(a).toMatchObject({ id: `double:${twice[1]!.id}`, tone: "warning", title: "Sama veloitus kahdesti: K-Citymarket 167,43 €", detail: "16.5.2026", merchant: "K-Citymarket" });
    });

    it("is settled when the merchant paid one of them back", () => {
      const twice = [tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 }), tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 })];
      const back = tx({ ...shop, bookingDate: "2026-05-23", amountCents: 16743 });
      expect(ofKind(alertsOf([...household(), ...twice, back]), "double_charge")).toEqual([]);
    });

    it("finds a monthly bill paid twice within a week", () => {
      const bill = monthly("2025-11-25", 11, -11900, { merchant: "Puhtaaksi Oy", category: "home" });
      const again = tx({ merchant: "Puhtaaksi Oy", category: "home", bookingDate: "2026-08-29", amountCents: -11900 });
      const [a] = ofKind(alertsOf([...household(), ...bill, again]), "double_charge");
      expect(a).toMatchObject({ id: `double:${again.id}`, title: "Sama veloitus kahdesti: Puhtaaksi Oy 119,00 €", detail: "25.8.2026 ja 29.8.2026" });
    });

    it("near misses: other account, small amount, a routine pair, outside the range", () => {
      const pair = (date: string, cents: number, accountId = "acc-1") => [
        tx({ ...shop, bookingDate: date, amountCents: cents }),
        tx({ ...shop, bookingDate: date, amountCents: cents, accountId }),
      ];
      expect(ofKind(alertsOf([...household(), ...pair("2026-05-16", -16743, "acc-2")], year, [checking, other]), "double_charge")).toEqual([]);
      expect(ofKind(alertsOf([...household(), ...pair("2026-05-16", -1990)]), "double_charge")).toEqual([]);
      // two cinema tickets every time
      const cinema = ["2026-01-10", "2026-03-14", "2026-06-20"].flatMap((d) => [0, 1].map(() => tx({ merchant: "Finnkino", category: "entertainment", bookingDate: d, amountCents: -2490 })));
      expect(ofKind(alertsOf([...household(), ...cinema]), "double_charge")).toEqual([]);
      expect(ofKind(alertsOf([...household(), ...pair("2026-05-16", -16743)], { from: "2026-06-01", to: today }), "double_charge")).toEqual([]);
    });
  });

  describe("late_fee", () => {
    it("sums reminder fees and late interest", () => {
      const fees = [
        tx({ merchant: "Oomi", counterparty: "OOMI OY", description: "MUISTUTUSMAKSU", category: "fees", bookingDate: "2026-02-03", amountCents: -500 }),
        tx({ merchant: "Oomi", counterparty: "OOMI OY", description: "VIIVÄSTYSKORKO", category: "interest", bookingDate: "2026-02-03", amountCents: -187 }),
      ];
      const [a] = ofKind(alertsOf([...household(), ...fees]), "late_fee");
      expect(a).toMatchObject({ tone: "warning", title: "Myöhästymiskuluja 6,87 €", detail: "Oomi, 3.2.2026", merchant: "Oomi" });
    });

    it("near miss: an ordinary bill or a fee before the range", () => {
      const bill = tx({ merchant: "Oomi", description: "SÄHKÖLASKU", category: "utilities", bookingDate: "2026-02-03", amountCents: -17200 });
      const early = tx({ merchant: "Oomi", description: "MUISTUTUSMAKSU", category: "fees", bookingDate: "2025-10-15", amountCents: -500 });
      expect(ofKind(alertsOf([...household(), bill, early]), "late_fee")).toEqual([]);
    });
  });

  describe("overlap", () => {
    const storytel = monthly("2025-10-07", 13, -1999, { merchant: "Storytel", category: "subscriptions" });
    it("two active audiobook services", () => {
      const bookbeat = monthly("2026-02-23", 8, -1799, { merchant: "BookBeat", category: "subscriptions" });
      const [a] = ofKind(alertsOf([...household(), ...storytel, ...bookbeat]), "overlap");
      expect(a).toMatchObject({ id: "overlap:audiobooks", title: "Kaksi äänikirjapalvelua", detail: "Storytel ja BookBeat, yhteensä 37,98 €/kk", category: "subscriptions" });
    });

    it("three video services", () => {
      const video = [
        ...monthly("2025-10-04", 13, -1599, { merchant: "Netflix", category: "subscriptions" }),
        ...monthly("2025-10-19", 12, -999, { merchant: "Disney+", category: "subscriptions" }),
        ...monthly("2025-11-27", 11, -1099, { merchant: "Max", category: "subscriptions" }),
      ];
      const [a] = ofKind(alertsOf([...household(), ...video]), "overlap");
      expect(a).toMatchObject({ title: "Kolme videopalvelua", detail: "Netflix, Max ja Disney+, yhteensä 36,97 €/kk" });
    });

    it("near misses: a cancelled one, or services of different types", () => {
      const stopped = monthly("2025-11-23", 5, -1799, { merchant: "BookBeat", category: "subscriptions" });
      expect(ofKind(alertsOf([...household(), ...storytel, ...stopped]), "overlap")).toEqual([]);
      const spotify = monthly("2025-10-11", 12, -2399, { merchant: "Spotify", category: "subscriptions" });
      expect(ofKind(alertsOf([...household(), ...storytel, ...spotify]), "overlap")).toEqual([]);
    });
  });

  describe("spike", () => {
    const march = { from: "2026-03-01", to: "2026-03-31" };
    const wolt = (date: string, cents = -3400) => tx({ merchant: "Wolt", category: "food_delivery", bookingDate: date, amountCents: cents });
    const usual = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-04"].flatMap((m) => [5, 14, 23].map((d) => wolt(`${m}-${String(d).padStart(2, "0")}`)));

    it("a category far above its usual months", () => {
      const spike = Array.from({ length: 12 }, (_, i) => wolt(`2026-03-${String(i * 2 + 2).padStart(2, "0")}`));
      const [a] = ofKind(alertsOf([...household(), ...usual, ...spike], march), "spike");
      expect(a).toMatchObject({ id: "spike:food_delivery:2026-03", tone: "warning", title: "Ruokalähetit 408 € maaliskuussa", detail: "Tavallisesti noin 102 €/kk", category: "food_delivery" });
    });

    it("near misses: one big order, too few orders, a small rise, uncategorised", () => {
      const big = [wolt("2026-03-03"), wolt("2026-03-10"), wolt("2026-03-20", -40000)];
      expect(ofKind(alertsOf([...household(), ...usual, ...big], march), "spike")).toEqual([]);
      const two = [wolt("2026-03-03", -20000), wolt("2026-03-10", -20000)];
      expect(ofKind(alertsOf([...household(), ...usual, ...two], march), "spike")).toEqual([]);
      const small = [3, 9, 15, 21, 27].map((d) => wolt(`2026-03-${String(d).padStart(2, "0")}`));
      expect(ofKind(alertsOf([...household(), ...usual, ...small], march), "spike")).toEqual([]);
      const other = [...usual, ...Array.from({ length: 12 }, (_, i) => wolt(`2026-03-${String(i * 2 + 2).padStart(2, "0")}`))].map((t) => ({ ...t, category: "other" }));
      expect(ofKind(alertsOf([...household(), ...other], march), "spike")).toEqual([]);
    });

    it("near miss: a car repair on top of fuel that is as high as some months before", () => {
      const fuel = (m: string, n: number) => Array.from({ length: n }, (_, i) => tx({ merchant: "Neste", category: "car", bookingDate: `${m}-${String(3 + i * 7).padStart(2, "0")}`, amountCents: -6500 }));
      const months = { "2025-12": 1, "2026-01": 4, "2026-02": 2, "2026-03": 2, "2026-04": 5, "2026-05": 2 };
      const usualFuel = Object.entries(months).flatMap(([m, n]) => fuel(m, n));
      const june = [...fuel("2026-06", 4), tx({ merchant: "Autokorjaamo", category: "car", bookingDate: "2026-06-10", amountCents: -61240 })];
      expect(ofKind(alertsOf([...household(), ...usualFuel, ...june], { from: "2026-06-01", to: "2026-06-30" }), "spike")).toEqual([]);
    });

    it("near miss: Christmas presents in the first year of history", () => {
      const shop = (m: string, d: number, cents: number) => tx({ merchant: `Kauppa ${d}`, category: "shopping", bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: cents });
      // the history starts in June 2025: last December is not known
      const usualShops = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11"].flatMap((m) => [shop(m, 4, -4000), shop(m, 18, -5000)]);
      const five = (m: string) => [6, 12, 14, 18, 21].map((d) => shop(m, d, -9000));
      const spikes = (rows: Transaction[], month: string, now: string) =>
        buildAlerts(createContext(rows, [checking], now), { from: `${month}-01`, to: `${month}-31` }).filter((a) => a.kind === "spike");
      expect(spikes([...usualShops, ...five("2025-12")], "2025-12", "2026-01-05")).toEqual([]);
      // the same five purchases in October are a spike
      expect(spikes([...usualShops.filter((t) => t.bookingDate < "2025-10"), ...five("2025-10")], "2025-10", "2025-11-05").map((a) => a.category)).toEqual(["shopping"]);
    });
  });

  describe("fees", () => {
    const fee = monthly("2025-10-01", 13, -1380, { merchant: "Nordea", category: "fees" });
    it("bank fees and interest over 100 € a year", () => {
      const card = tx({ merchant: "Nordea", category: "fees", bookingDate: "2026-02-02", amountCents: -3000 });
      const [a] = ofKind(alertsOf([...household(), ...fee, card]), "fees");
      expect(a).toMatchObject({ kind: "fees", title: "Pankkikuluja 208 € vuodessa", detail: "Nordea", category: "fees" });
    });

    it("a reminder fee is a late fee, not a bank's price", () => {
      const reminder = tx({ merchant: "Oomi", category: "fees", bookingDate: "2026-02-03", amountCents: -500, description: "MUISTUTUSMAKSU" });
      const alerts = alertsOf([...household(), ...fee, reminder]);
      expect(ofKind(alerts, "fees")[0]).toMatchObject({ detail: "Nordea" });
      expect(ofKind(alerts, "late_fee")[0]).toMatchObject({ title: "Myöhästymiskuluja 5,00 €" });
    });

    it("near misses: a short range, small fees", () => {
      expect(ofKind(alertsOf([...household(), ...fee], { from: "2026-06-01", to: today }), "fees")).toEqual([]);
      const small = monthly("2025-10-01", 13, -500, { merchant: "Nordea", category: "fees" });
      expect(ofKind(alertsOf([...household(), ...small]), "fees")).toEqual([]);
    });
  });

  describe("habit", () => {
    const kiosk = (n: number, cents: (i: number) => number) =>
      Array.from({ length: n }, (_, i) => tx({ merchant: "R-Kioski", category: "groceries", bookingDate: addDays("2025-10-01", Math.floor((i * 373) / n)), amountCents: cents(i) })).filter(
        (t) => t.bookingDate <= today,
      );

    it("many small purchases a month", () => {
      const [a] = ofKind(alertsOf([...household(), ...kiosk(130, (i) => -(400 + (i % 4) * 100))]), "habit");
      expect(a).toMatchObject({ id: "habit:R-Kioski", tone: "info", title: "R-Kioski 11 kertaa kuussa", detail: "Noin 700 € vuodessa", merchant: "R-Kioski" });
    });

    it("a short range looks at the last 90 days", () => {
      const [a] = ofKind(alertsOf([...household(), ...kiosk(130, () => -500)], { from: "2026-10-01", to: today }), "habit");
      expect(a?.title).toBe("R-Kioski 10 kertaa kuussa");
    });

    it("near misses: not often enough, not small", () => {
      expect(ofKind(alertsOf([...household(), ...kiosk(70, () => -500)]), "habit")).toEqual([]);
      expect(ofKind(alertsOf([...household(), ...kiosk(130, () => -1200)]), "habit")).toEqual([]);
    });
  });

  describe("forgotten", () => {
    const max = monthly("2025-11-27", 11, -1099, { merchant: "Max", category: "subscriptions" });
    it("a small service running for months", () => {
      const [a] = ofKind(alertsOf([...household(), ...max]), "forgotten");
      expect(a).toMatchObject({ tone: "info", title: "Käytätkö vielä: Max?", detail: "10,99 €/kk, 11 kk", merchant: "Max" });
    });

    it("near misses: a past period, a new service, an expensive one", () => {
      expect(ofKind(alertsOf([...household(), ...max], { from: "2026-08-01", to: "2026-08-31" }), "forgotten")).toEqual([]);
      const fresh = monthly("2026-06-14", 4, -699, { merchant: "Apple", category: "subscriptions" });
      expect(ofKind(alertsOf([...household(), ...fresh]), "forgotten")).toEqual([]);
      const pricey = monthly("2025-10-11", 12, -2399, { merchant: "Spotify", category: "subscriptions" });
      expect(ofKind(alertsOf([...household(), ...pricey]), "forgotten")).toEqual([]);
    });
  });

  it("keeps the order, one of each kind first, at most six", () => {
    const shop = { merchant: "K-Citymarket", category: "groceries" };
    const all = [
      ...household(),
      tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 }),
      tx({ ...shop, bookingDate: "2026-05-16", amountCents: -16743 }),
      tx({ merchant: "Oomi", description: "MUISTUTUSMAKSU", category: "fees", bookingDate: "2026-02-03", amountCents: -500 }),
      ...monthly("2025-10-07", 13, -1999, { merchant: "Storytel", category: "subscriptions" }),
      ...monthly("2026-02-23", 8, -1799, { merchant: "BookBeat", category: "subscriptions" }),
      ...monthly("2025-10-04", 13, -1599, { merchant: "Netflix", category: "subscriptions" }),
      ...monthly("2025-11-27", 11, -1099, { merchant: "Max", category: "subscriptions" }),
      ...monthly("2025-10-19", 12, -899, { merchant: "Lehti", category: "subscriptions" }),
      ...monthly("2025-10-01", 13, -1380, { merchant: "Nordea", category: "fees" }),
      ...Array.from({ length: 130 }, (_, i) => tx({ merchant: "R-Kioski", category: "groceries", bookingDate: addDays("2025-10-01", Math.floor((i * 373) / 130)), amountCents: -450 })),
    ].filter((t) => t.bookingDate <= today);
    const kinds = alertsOf(all).map((a) => a.kind);
    expect(kinds).toEqual(["double_charge", "late_fee", "overlap", "forgotten", "fees", "habit"]);
  });
});
