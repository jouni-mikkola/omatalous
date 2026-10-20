import { describe, expect, it } from "vitest";
import { contextOf, seededHousehold } from "../../../tools/findings/households.ts";
import { type Alert, buildAlerts } from "../src/analysis/alerts.ts";
import { createContext } from "../src/analysis/context.ts";
import { formatEur, monthInessive } from "../src/analysis/format.ts";
import { addDays, addMonths, monthEnd, monthOf, monthRange } from "../src/dates.ts";
import { spendingChangeReport } from "../src/reports/spending-change.ts";
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
      expect(a).toMatchObject({ id: "overlap:audiobooks", title: "Kaksi äänikirjapalvelua", detail: "Storytel ja BookBeat, yhteensä 37,98 € kuussa", category: "subscriptions" });
    });

    it("three video services", () => {
      const video = [
        ...monthly("2025-10-04", 13, -1599, { merchant: "Netflix", category: "subscriptions" }),
        ...monthly("2025-10-19", 12, -999, { merchant: "Disney+", category: "subscriptions" }),
        ...monthly("2025-11-27", 11, -1099, { merchant: "Max", category: "subscriptions" }),
      ];
      const [a] = ofKind(alertsOf([...household(), ...video]), "overlap");
      expect(a).toMatchObject({ title: "Kolme videopalvelua", detail: "Netflix, Max ja Disney+, yhteensä 36,97 € kuussa" });
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
    /** Three orders on the 5th, 14th and 23rd, or more on every second day from the 2nd. */
    const orders = (month: string, n: number) => Array.from({ length: n }, (_, i) => wolt(`${month}-${String(n > 3 ? i * 2 + 2 : 5 + i * 9).padStart(2, "0")}`));
    const usual = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-04"].flatMap((m) => orders(m, 3));
    /** The usual view of the change report for the same rows and period: the alert may only repeat it (ADR 0013). */
    const reportOf = (rows: Transaction[], range: { from: string; to: string }, now = today) => spendingChangeReport(createContext(rows, [checking], now), range).views.find((v) => v.view === "usual")!;

    it("a category far above its usual months", () => {
      const [a] = ofKind(alertsOf([...household(), ...usual, ...orders("2026-03", 12)], march), "spike");
      expect(a).toMatchObject({ id: "spike:food_delivery:2026-03", tone: "warning", title: "Ruoan kotiinkuljetus 408 € maaliskuussa", detail: "Tavallisesti noin 102 €/kk", category: "food_delivery" });
    });

    it("the amount and the usual level are the change report's: one-offs struck from the usual months, a returned order counted at nothing", () => {
      // a party order in three of the five usual months lifts their median to 252 €; struck, the usual level is 102 €
      const catering = (merchant: string, date: string, cents: number) => tx({ merchant, category: "food_delivery", bookingDate: date, amountCents: cents });
      const parties = ["2025-11", "2025-12", "2026-01"].map((m) => catering(`Pitopalvelu ${m}`, `${m}-18`, -15000));
      // an order of 300 € cancelled and paid back in March
      const returned = [catering("Kotipizza", "2026-03-07", -30000), catering("Kotipizza", "2026-03-09", 30000)];
      const rows = [...household(), ...usual, ...parties, ...orders("2026-03", 12), ...returned];
      const report = reportOf(rows, march);
      expect(report.change.categories.find((c) => c.category === "food_delivery")).toMatchObject({ nowCents: 40800, baseCents: 10200 });
      expect(plain(report.sentence)).toContain("Ruoan kotiinkuljetus +306 € (useammin)");
      expect(ofKind(alertsOf(rows, march), "spike")).toMatchObject([{ title: "Ruoan kotiinkuljetus 408 € maaliskuussa", detail: "Tavallisesti noin 102 €/kk" }]);
    });

    it("on seeded households every spike is a row of the report that rose over the gate and stands out, with the row's amount and usual level", () => {
      let spikes = 0;
      for (const h of [seededHousehold(1, true), seededHousehold(2, true), seededHousehold(4, true)]) {
        const ctx = contextOf(h);
        for (let m = monthOf(ctx.dataFrom!); m < monthOf(h.today); m = addMonths(m, 1)) {
          const range = { from: `${m}-01`, to: monthEnd(m) };
          const found = buildAlerts(ctx, range).filter((a) => a.kind === "spike");
          if (!found.length) continue;
          const { change } = spendingChangeReport(ctx, range).views.find((v) => v.view === "usual")!;
          for (const a of found) {
            const row = change.categories.find((c) => c.category === a.category)!;
            expect(row).toMatchObject({ kind: "category", standsOut: true });
            expect(row.changeCents).toBeGreaterThanOrEqual(change.gateCents);
            expect(a.title).toBe(`${row.label} ${formatEur(row.nowCents, false)} ${monthInessive(m)}`);
            expect(a.detail).toBe(row.baseCents >= 100 ? `Tavallisesti noin ${formatEur(Math.round(row.baseCents / 100) * 100, false)}/kk` : "Tavallisesti ei lainkaan");
            spikes++;
          }
        }
      }
      expect(spikes).toBeGreaterThanOrEqual(5);
    });

    it("near misses: one big order, too few orders, a small rise, uncategorised", () => {
      const big = [wolt("2026-03-03"), wolt("2026-03-10"), wolt("2026-03-20", -40000)];
      expect(ofKind(alertsOf([...household(), ...usual, ...big], march), "spike")).toEqual([]);
      const two = [wolt("2026-03-03", -20000), wolt("2026-03-10", -20000)];
      expect(ofKind(alertsOf([...household(), ...usual, ...two], march), "spike")).toEqual([]);
      // four orders are 34 € over the usual three: under 50 €
      const small = [3, 9, 15, 21].map((d) => wolt(`2026-03-${String(d).padStart(2, "0")}`));
      expect(ofKind(alertsOf([...household(), ...usual, ...small], march), "spike")).toEqual([]);
      const other = [...usual, ...orders("2026-03", 12)].map((t) => ({ ...t, category: "other" }));
      expect(ofKind(alertsOf([...household(), ...other], march), "spike")).toEqual([]);
    });

    it("near miss: the same twelve orders after months that swing from none to seven, which the report does not name either", () => {
      const counts: [string, number][] = [["2025-10", 0], ["2025-11", 7], ["2025-12", 1], ["2026-01", 6], ["2026-02", 2]];
      const swinging = counts.flatMap(([m, n]) => Array.from({ length: n }, (_, i) => wolt(`${m}-${String(2 + i * 4).padStart(2, "0")}`)));
      const rows = [...household(), ...swinging, ...orders("2026-03", 12)];
      expect(ofKind(alertsOf(rows, march), "spike")).toEqual([]);
      expect(reportOf(rows, march).bars.map((b) => b.category)).not.toContain("food_delivery");
    });

    it("near miss: a car repair on top of fuel that is as high as some months before", () => {
      const fuel = (m: string, n: number) => Array.from({ length: n }, (_, i) => tx({ merchant: "Neste", category: "car", bookingDate: `${m}-${String(3 + i * 7).padStart(2, "0")}`, amountCents: -6500 }));
      const months = { "2025-12": 1, "2026-01": 4, "2026-02": 2, "2026-03": 2, "2026-04": 5, "2026-05": 2 };
      const usualFuel = Object.entries(months).flatMap(([m, n]) => fuel(m, n));
      const june = [...fuel("2026-06", 4), tx({ merchant: "Autokorjaamo", category: "car", bookingDate: "2026-06-10", amountCents: -61240 })];
      expect(ofKind(alertsOf([...household(), ...usualFuel, ...june], { from: "2026-06-01", to: "2026-06-30" }), "spike")).toEqual([]);
    });

    it("near miss: new subscriptions and bigger bills are the report's to tell, with no spike on top", () => {
      const charge = (merchant: string, category: string, start: string, cents: number) => monthly(start, 13, cents, { merchant, category });
      const old = [charge("Netflix", "subscriptions", "2025-10-04", -1599), charge("Spotify", "subscriptions", "2025-10-11", -1199), charge("HBO Max", "subscriptions", "2025-10-19", -999)].flat();
      const started: [string, string, number][] = [["Disney+", "2026-03-06", -1399], ["Viaplay", "2026-03-13", -1799], ["Ruutu", "2026-03-20", -2999]];
      const subscribed = [...household(), ...old, ...started.flatMap(([name, start, cents]) => charge(name, "subscriptions", start, cents))];
      expect(reportOf(subscribed, march).bars[0]).toMatchObject({ category: "subscriptions", cents: 6197, cause: "uudet kaupat" });
      expect(ofKind(alertsOf(subscribed, march), "spike")).toEqual([]);
      // the same three charges once, with no contract behind them, are more purchases
      const once = [...household(), ...old, ...started.map(([name, start, cents]) => tx({ merchant: name, category: "subscriptions", bookingDate: start, amountCents: cents }))];
      expect(ofKind(alertsOf(once, march), "spike")).toMatchObject([{ title: "Tilaukset ja suoratoisto 100 € maaliskuussa", detail: "Tavallisesti noin 38 €/kk" }]);

      // three bills that double for a month
      const bills: [string, string, number][] = [["Helen", "2025-10-08", -6000], ["HSY", "2025-10-15", -4000], ["Fortum", "2025-10-22", -5000]];
      const dearer = [...household(), ...bills.flatMap(([name, start, cents]) => charge(name, "utilities", start, cents).map((t, i) => ({ ...t, amountCents: t.bookingDate.startsWith("2026-03") ? 2 * cents : cents - (i % 3) * 200 })))];
      expect(reportOf(dearer, march).bars[0]).toMatchObject({ category: "utilities", cause: "suurempi lasku" });
      expect(ofKind(alertsOf(dearer, march), "spike")).toEqual([]);
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

    it("near miss: a month that moved as far a year ago is a season", () => {
      const visits = (m: string, n: number) => Array.from({ length: n }, (_, i) => tx({ merchant: "Puuilo", category: "home", bookingDate: `${m}-${String(3 + i * 3).padStart(2, "0")}`, amountCents: -4500 }));
      const july = { from: "2026-07-01", to: "2026-07-31" };
      const spikes = (lastJuly: number) => ofKind(alertsOf(monthRange("2025-05", "2026-09").flatMap((m) => visits(m, m === "2026-07" ? 8 : m === "2025-07" ? lastJuly : 2)), july), "spike");
      expect(spikes(6)).toEqual([]);
      expect(spikes(2)).toMatchObject([{ title: "Koti ja elektroniikka 360 € heinäkuussa", detail: "Tavallisesti noin 90 €/kk" }]);
    });

    it("a new level is a spike in its first month, and the report's to tell after that", () => {
      const rows = [...household(), ...["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].flatMap((m) => orders(m, 3)), ...orders("2026-04", 12), ...orders("2026-05", 12)];
      expect(ofKind(alertsOf(rows, { from: "2026-04-01", to: "2026-04-30" }), "spike").map((a) => a.id)).toEqual(["spike:food_delivery:2026-04"]);
      const may = { from: "2026-05-01", to: "2026-05-31" };
      expect(ofKind(alertsOf(rows, may), "spike")).toEqual([]);
      expect(reportOf(rows, may).bars.map((b) => b.category)).toContain("food_delivery");
    });

    it("a running month is set against the same days of its usual months, and says nothing in its first week", () => {
      const at = (now: string) => {
        const rows = [...household(), ...usual, ...orders("2026-03", 12)].filter((t) => t.bookingDate <= now);
        const range = { from: "2026-03-01", to: now };
        const row = reportOf(rows, range, now).change.categories.find((c) => c.category === "food_delivery")!;
        return { row: [row.nowCents, row.baseCents], spikes: buildAlerts(createContext(rows, [checking], now), range).filter((a) => a.kind === "spike").map((a) => [plain(a.title), plain(a.detail)]) };
      };
      // ten orders by the 20th against the two a usual month has had by then
      expect(at("2026-03-20")).toEqual({ row: [34000, 6800], spikes: [["Ruoan kotiinkuljetus 340 € maaliskuussa", "Tavallisesti tähän mennessä noin 68 €"]] });
      expect(at("2026-03-06").spikes).toEqual([]);
    });

    it("the month is the report's: a period that ends today shows the running month's alert, last month's spike shows when that month is selected", () => {
      const spikesAt = (now: string, range: { from: string; to: string }) => {
        const rows = [...household(), ...usual, ...orders("2026-03", 12)].filter((t) => t.bookingDate <= now);
        expect(reportOf(rows, range, now).periodLabel).toBe(now < "2026-04" || range.to < "2026-04" ? "Maaliskuu" : "Huhtikuu");
        return buildAlerts(createContext(rows, [checking], now), range).filter((a) => a.kind === "spike").map((a) => [plain(a.title), plain(a.detail)]);
      };
      // on 20.3. the month, 3 kk and Vuosi all end in the running March
      const running = [["Ruoan kotiinkuljetus 340 € maaliskuussa", "Tavallisesti tähän mennessä noin 68 €"]];
      expect(spikesAt("2026-03-20", { from: "2026-03-01", to: "2026-03-31" })).toEqual(running);
      expect(spikesAt("2026-03-20", { from: "2026-01-01", to: "2026-03-31" })).toEqual(running);
      expect(spikesAt("2026-03-20", { from: "2025-04-01", to: "2026-03-20" })).toEqual(running);
      // on 10.4. the same periods end in April, which has one order so far; March tells its spike when it is selected
      expect(spikesAt("2026-04-10", { from: "2026-02-01", to: "2026-04-30" })).toEqual([]);
      expect(spikesAt("2026-04-10", { from: "2025-05-01", to: "2026-04-10" })).toEqual([]);
      expect(spikesAt("2026-04-10", march)).toEqual([["Ruoan kotiinkuljetus 408 € maaliskuussa", "Tavallisesti noin 102 €/kk"]]);
      // a period that ended in March before today reads March as well
      expect(spikesAt("2026-04-10", { from: "2026-01-01", to: "2026-03-31" })).toEqual([["Ruoan kotiinkuljetus 408 € maaliskuussa", "Tavallisesti noin 102 €/kk"]]);
    });

    it("a rise whose causes each stay under the gate still alerts, with the row's figures", () => {
      // usual spending 2 612 €/kk makes the gate 52 €. Restaurants are 50 € kuussa, then September is 150 €:
      // 50 € at a new restaurant and 50 € from two more visits to the old one
      const now = "2026-10-12";
      const months = monthRange("2025-10", "2026-10");
      const eat = (merchant: string, date: string, cents = 2500) => tx({ merchant, category: "restaurants", bookingDate: date, amountCents: -cents });
      const rows = [
        ...months.map((m) => tx({ merchant: "Acme Oy", category: "salary", bookingDate: `${m}-25`, amountCents: 400000 })),
        ...months.map((m) => tx({ merchant: "Sato", category: "housing", bookingDate: `${m}-02`, amountCents: -180000 })),
        ...series("2025-10-01", 7, 54, (i) => -(15000 + (i % 5) * 1700), { merchant: "Prisma", category: "groceries" }),
        ...months.filter((m) => m < "2026-09").flatMap((m, i) => [eat("Sea Horse", `${m}-0${5 + (i % 3)}`, 2400 + (i % 3) * 100), eat("Sea Horse", `${m}-${19 + (i % 4)}`, 2600 - (i % 3) * 100)]),
        ...["05", "12", "19", "26"].map((d) => eat("Sea Horse", `2026-09-${d}`)),
        ...["09", "23"].map((d) => eat("Kuu", `2026-09-${d}`)),
      ].filter((t) => t.bookingDate <= now);
      const september = { from: "2026-09-01", to: "2026-09-30" };
      const { change } = reportOf(rows, september, now);
      expect(change).toMatchObject({ baseCents: 261150, gateCents: 5223 });
      expect(change.categories.find((c) => c.category === "restaurants")).toMatchObject({ nowCents: 15000, baseCents: 5000, changeCents: 10000, standsOut: true, buckets: [], restCents: 10000 });
      const spikes = buildAlerts(createContext(rows, [checking], now), september).filter((a) => a.kind === "spike");
      expect(spikes.map((a) => [plain(a.title), plain(a.detail)])).toEqual([["Ravintolat ja kahvilat 150 € syyskuussa", "Tavallisesti noin 50 €/kk"]]);
    });

    it("a rise ranked ninth, under the eight rows of the report's table, still alerts", () => {
      // one larger purchase in each of eight categories fills the table; restaurants rise from two visits to six
      const eat = (m: string, days: number[]) => days.map((d) => tx({ merchant: "Sea Horse", category: "restaurants", bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -2500 }));
      const larger = ["home", "health", "shopping", "kids", "pets", "entertainment", "travel", "education"];
      const rows = [
        ...household(),
        ...monthRange("2025-10", "2026-08").flatMap((m) => eat(m, [6, 20])),
        ...eat("2026-09", [4, 8, 12, 18, 22, 26]),
        ...larger.map((category, i) => tx({ merchant: `Kauppa ${i}`, category, bookingDate: `2026-09-${String(3 + i * 3).padStart(2, "0")}`, amountCents: -(40000 + i * 5000) })),
      ];
      const september = { from: "2026-09-01", to: "2026-09-30" };
      expect(reportOf(rows, september).change.categories.map((c) => c.category)).toEqual([...larger.reverse(), null]);
      expect(ofKind(alertsOf(rows, september), "spike")).toMatchObject([{ title: "Ravintolat ja kahvilat 150 € syyskuussa", detail: "Tavallisesti noin 50 €/kk", category: "restaurants" }]);
    });

    it("when a card's rows lag, the alert names the day its figures are cut at", () => {
      // the card's rows end on 10.10. and today is the 20th: the report compares the first ten days of the month
      const now = "2026-10-20";
      const card: Account = { id: "acc-2", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
      const pad = (n: number) => String(n).padStart(2, "0");
      const rows = monthRange("2025-10", "2026-10")
        .flatMap((m, i) => [
          tx({ merchant: "Acme Oy", category: "salary", bookingDate: `${m}-25`, amountCents: 400000 }),
          tx({ merchant: "Sato", category: "housing", bookingDate: `${m}-02`, amountCents: -120000 }),
          // groceries on the card nearly every day
          ...Array.from({ length: 27 }, (_, d) => tx({ accountId: "acc-2", merchant: "Prisma", category: "groceries", bookingDate: `${m}-${pad(d + 1)}`, amountCents: -(1800 + ((d + i) % 5) * 300) })).filter((t) => t.bookingDate <= "2026-10-10"),
          // restaurants from the checking account: two visits in a usual month, in October eight by the 10th and four after it
          ...(m === "2026-10" ? [1, 2, 4, 5, 6, 8, 9, 10, 12, 14, 16, 18] : [6 + (i % 3), 20 + (i % 4)]).map((d) => tx({ merchant: "Sea Horse", category: "restaurants", bookingDate: `${m}-${pad(d)}`, amountCents: -(2400 + (d % 3) * 100) })),
        ])
        .filter((t) => t.bookingDate <= now);
      const ctx = createContext(rows, [checking, card], now);
      const october = { from: "2026-10-01", to: "2026-10-31" };
      const { change, sentence } = spendingChangeReport(ctx, october).views.find((v) => v.view === "usual")!;
      expect(change).toMatchObject({ running: true, target: { to: "2026-10-10" } });
      // the report's lead says the same words as the alert, not "tähän asti"
      expect(sentence.replace(/\s/g, " ")).toBe("Lokakuu: menot 10.10. mennessä 176 € tavallista suuremmat. Ravintolat ja kahvilat +176 € (useammin).");
      expect(change.categories.find((c) => c.category === "restaurants")).toMatchObject({ nowCents: 20100, baseCents: 2500 });
      // the page's rows of the category add up to 300 € by the 20th, so neither figure may read as today's
      const spikes = buildAlerts(ctx, october).filter((a) => a.kind === "spike");
      expect(spikes.map((a) => [plain(a.title), plain(a.detail)])).toEqual([["Ravintolat ja kahvilat 201 € 10.10. mennessä", "Tavallisesti siihen mennessä noin 25 €"]]);
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
      expect(a).toMatchObject({ tone: "info", title: "Max 10,99 € kuussa, 132 € vuodessa", detail: expect.stringMatching(/^Maksettu \d+ kuukautta\.$/), merchant: "Max" });
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

describe("a large payment that is still Muut menot", () => {
  const big = (id: string, cents: number, over: Partial<Transaction> = {}) => tx({ id, bookingDate: "2025-10-12", amountCents: -cents, merchant: "Esimerkki Oy", ...over });
  const found = (rows: Transaction[], range = year) => ofKind(alertsOf([...household(), ...rows], range), "uncategorised");

  it("is one row from 1 000 € on with the payee, the day and the sum, and none at 999,99 €", () => {
    expect(found([big("a", 125000)])).toEqual([
      { id: "uncategorised:a", kind: "uncategorised", tone: "info", title: "Luokittelematon maksu", detail: "Esimerkki Oy 12.10. 1 250,00 €", row: { merchant: "Esimerkki Oy", date: "2025-10-12" } },
    ]);
    expect(found([big("a", 100000)]).map((a) => a.detail)).toEqual(["Esimerkki Oy 12.10. 1 000,00 €"]);
    expect(found([big("a", 99999)])).toEqual([]);
  });

  it("goes when the payment has a category, whoever gave it", () => {
    expect(found([big("a", 125000, { category: "home", categorySource: "rule" })])).toEqual([]);
    // Muut menot the user chose, or a rule of the user gave, is a category too
    expect(found([big("a", 125000, { categorySource: "user" })])).toEqual([]);
    expect(found([big("a", 125000, { categorySource: "rule" })])).toEqual([]);
  });

  it("is three rows at most, the largest first", () => {
    const rows = [100000, 500000, 200000, 300000, 150000].map((cents, i) => big(`r${i}`, cents, { bookingDate: `2026-0${i + 1}-15` }));
    expect(found(rows).map((a) => a.id)).toEqual(["uncategorised:r1", "uncategorised:r3", "uncategorised:r2"]);
    // a row set aside gives its place to the next one
    const marks = [{ subject: "alert:uncategorised:r1", mark: "dismissed" as const, markedAt: "2026-10-01T10:00:00" }];
    const left = buildAlerts(createContext([...household(), ...rows], [checking], today), year, { marks, expectedBills: [], loans: [] });
    expect(ofKind(left, "uncategorised").map((a) => a.id)).toEqual(["uncategorised:r3", "uncategorised:r2", "uncategorised:r4"]);
  });

  it("counts the payment by what it cost in the end, and money in is no payment", () => {
    const back = (cents: number) => tx({ bookingDate: "2025-10-20", amountCents: cents, merchant: "Esimerkki Oy" });
    // 1 250 € paid and 250 € back is a payment of 1 000 €; one cent more back and it is under the bound
    expect(found([big("a", 125000), back(25000)]).map((a) => a.detail)).toEqual(["Esimerkki Oy 12.10. 1 000,00 €"]);
    expect(found([big("a", 125000), back(25001)])).toEqual([]);
    expect(found([tx({ bookingDate: "2025-10-12", amountCents: 125000, merchant: "Esimerkki Oy" })])).toEqual([]);
  });

  it("is no transfer and no row the bank has not booked, and reads the year up to the period's end", () => {
    expect(found([big("a", 125000, { isTransfer: true, category: "transfer" })])).toEqual([]);
    expect(found([big("a", 125000, { status: "pending" })])).toEqual([]);
    // 10.10.2025 is the first day of the year that ends on 9.10.2026
    expect(found([big("a", 125000, { bookingDate: "2025-10-10" })])).toHaveLength(1);
    expect(found([big("a", 125000, { bookingDate: "2025-10-09" })])).toEqual([]);
    // a period that ends before the payment does not show it
    expect(found([big("a", 125000, { bookingDate: "2026-09-12" })], { from: "2026-08-01", to: "2026-08-31" })).toEqual([]);
    expect(found([big("a", 125000, { bookingDate: "2026-09-12" })], { from: "2026-10-01", to: today })).toHaveLength(1);
  });
});
