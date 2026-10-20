/**
 * Puhelin ja tilaukset and Pankkikulut: each finding with its exact euros and wording, every near miss quiet, and the
 * findings named by the same detectors as the overview's alerts and insights (rule 8).
 */
import { describe, expect, it } from "vitest";
import { buildAlerts, overlapGroups } from "../../src/analysis/alerts.ts";
import { formatEur } from "../../src/analysis/format.ts";
import { recurringAt } from "../../src/analysis/context.ts";
import { priceRiseItems } from "../../src/analysis/insights/prices.ts";
import { renewalItems } from "../../src/analysis/insights/renewals.ts";
import { monthRange } from "../../src/dates.ts";
import { bank } from "../../src/optimise/areas/bank.ts";
import { subscriptions } from "../../src/optimise/areas/subscriptions.ts";
import { allFindings, areaInputOf, buildOptimise, type Finding, type OptimiseInput } from "../../src/optimise/index.ts";
import { NO_INPUTS, type Transaction } from "../../src/types.ts";
import { tx } from "../helpers.ts";
import { ACCOUNTS, type Frame, FRAME, householdInput, joinHousehold, type PartHousehold } from "./household.ts";
import * as bankPart from "./parts/bank.ts";
import * as subsPart from "./parts/subscriptions.ts";

const plain = (s: string) => s.replace(/[  ]/g, " ");
const inputOf = (...parts: PartHousehold[]) => householdInput(joinHousehold(parts));
const shown = (input: OptimiseInput) => allFindings(buildOptimise(input));
const one = (findings: readonly Finding[], kind: string) => {
  const hits = findings.filter((f) => f.kind === kind);
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

/** A monthly charge on the checking account on `day`, `cents(month)` each month, from `from` to the judging day. */
function monthly(merchant: string, from: string, day: number, cents: (month: string) => number): Transaction[] {
  return monthRange(from, "2026-10")
    .map((m) => `${m}-${String(day).padStart(2, "0")}`)
    .filter((d) => d <= FRAME.today)
    .map((d) => tx({ bookingDate: d, amountCents: -cents(d.slice(0, 7)), merchant, description: merchant.toUpperCase(), accountId: "h-chk" }));
}

const SUBS = inputOf(subsPart.hit(FRAME));
const SUBS_SHOWN = shown(SUBS);
const BANK = inputOf(bankPart.hit(FRAME));
const BANK_SHOWN = shown(BANK);

describe("Puhelin ja tilaukset", () => {
  it("a phone bill that rose: the rise over a year of charges, korkea, the dates and prices only", () => {
    const f = one(SUBS_SHOWN, "rise");
    expect(f.id).toBe("subscriptions:rise:out:h-chk:Elisa");
    expect(plain(f.title)).toBe("Elisa: hinta nousi 44,90 € → 56,90 € 12.3.2026. Nousu on 144 € vuodessa.");
    expect(f.euros).toEqual({ lowCents: 14400, midCents: 14400, highCents: 14400 });
    expect(f.claims).toEqual(["series:out:h-chk:Elisa"]);
    expect(f.certainty.level).toBe("korkea");
    expect(f.action).toBe("Neuvottele hinnasta tai kilpailuta liittymä.");
  });

  it("steps down when fewer than six charges came before the rise", () => {
    const f = one(shown(inputOf({ txs: monthly("Elisa", "2025-10", 12, (m) => (m < "2026-03" ? 4490 : 5690)) })), "rise");
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Vanhaa hintaa on veloitettu vain 5 kertaa." });
    expect(f.euros?.midCents).toBe(14400);
  });

  it("two music services: the cheaper one a year, keskitaso as who uses which is not in the data", () => {
    const f = one(SUBS_SHOWN, "overlap");
    expect(f.id).toBe("subscriptions:overlap:music");
    expect(plain(f.title)).toBe("Kaksi musiikkipalvelua yhteensä 22,98 € kuussa: Spotify ja Tidal.");
    expect(f.euros).toEqual({ lowCents: 13188, midCents: 13188, highCents: 13188 });
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Tiedoista ei näy, kuka käyttää mitäkin palvelua." });
    expect(f.action.startsWith("Irtisano")).toBe(true);
  });

  it("three video services: from the cheapest to all but the dearest a year", () => {
    const txs = [...monthly("Netflix", "2025-09", 12, () => 1599), ...monthly("Viaplay", "2025-09", 14, () => 1299), ...monthly("Disney+", "2025-09", 16, () => 999)];
    const f = one(shown(inputOf({ txs })), "overlap");
    expect(plain(f.title)).toBe("Kolme videopalvelua yhteensä 38,97 € kuussa: Netflix, Viaplay ja Disney+.");
    expect(f.euros).toMatchObject({ lowCents: 11988, midCents: 19782, highCents: 27576 });
    expect(f.calc.map((c) => plain(c.value)).slice(-3)).toEqual(["120 €", "276 €", "198 €"]);
  });

  it("a yearly subscription renewing in 30 days: a deadline the day before, no euros, in Seuraavat 60 päivää", () => {
    const f = one(SUBS_SHOWN, "renewal");
    expect(plain(f.title)).toBe("Storytel: vuositilaus uusiutuu 14.11.2026, 189 €. Edellinen veloitus 14.11.2025.");
    expect(f.euros).toBeNull();
    expect(f.decideBy).toBe("2026-11-13");
    expect(f.certainty.level).toBe("korkea");
    expect(buildOptimise(SUBS).soon.map((s) => s.id)).toEqual([f.id]);
  });

  it("each near miss is one step from a finding and stays quiet", () => {
    const [rise, family, line, video, small, later, cancelled, under, kept, both, renewing] = subsPart.nearMiss(FRAME).map((p) => inputOf(p));
    // the 4 % rise is a price change, under the insight's 5 %
    expect(recurringAt(rise!.ctx, "2026-09-30").find((s) => s.merchant === "Elisa")?.priceChange).toMatchObject({ fromCents: 2500, toCents: 2600 });
    // the insight still names a step over 30 % (a line added); Optimoi does not read it as a price
    expect(priceRiseItems(family!.ctx, "2026-09-30").map((i) => i.series.merchant)).toEqual(["DNA"]);
    expect(priceRiseItems(line!.ctx, "2026-09-30").map((i) => i.series.merchant)).toEqual(["Elisa"]);
    expect(video!.ctx.recurring.filter((s) => s.merchant === "Netflix")).toHaveLength(1);
    // the alert's music group, 59,88 € a year to drop one: under the gate
    expect(overlapGroups(small!.ctx.recurring).map((g) => g.type)).toEqual(["music"]);
    expect(renewalItems(later!.ctx, NO_INPUTS, 61).map((s) => s.merchant)).toEqual(["Storytel"]);
    expect(subscriptions.assess(areaInputOf({ ...cancelled!, inputs: NO_INPUTS })).findings.map((f) => f.kind)).toEqual(["renewal"]);
    // the gate reads the series' own year, 119,95 €
    expect(renewalItems(under!.ctx, NO_INPUTS, 60).map((s) => s.yearlyCents)).toEqual([11995]);
    // answered on Laskut: each would be a finding without its mark
    expect(subscriptions.assess(areaInputOf({ ...kept!, inputs: NO_INPUTS })).findings.map((f) => f.kind)).toEqual(["rise"]);
    expect(subscriptions.assess(areaInputOf({ ...both!, inputs: NO_INPUTS })).findings.map((f) => f.kind)).toEqual(["overlap"]);
    expect(subscriptions.assess(areaInputOf({ ...renewing!, inputs: NO_INPUTS })).findings.map((f) => f.kind)).toEqual(["renewal"]);
    for (const input of [rise, family, line, video, small, later, cancelled, under, kept, both, renewing]) expect(shown(input!)).toEqual([]);
  });

  it("leaves out a series nobody recognised, such as one leg of a move between accounts", () => {
    const leg = [tx({ bookingDate: "2025-05-18", amountCents: -10000, merchant: "Siirto", description: "SIIRTO", accountId: "h-chk" }), tx({ bookingDate: "2025-11-18", amountCents: -10000, merchant: "Siirto", description: "SIIRTO", accountId: "h-chk" }), tx({ bookingDate: "2026-05-18", amountCents: -10000, merchant: "Siirto", description: "SIIRTO", accountId: "h-chk" })];
    const input = inputOf({ txs: leg });
    expect(renewalItems(input.ctx, NO_INPUTS, 60).map((s) => s.merchant)).toEqual(["Siirto"]);
    expect(shown(input)).toEqual([]);
  });
});

describe("Pankkikulut", () => {
  it("a Platinum card in use: the difference to the Credit card from the price list, keskitaso", () => {
    const f = one(BANK_SHOWN, "card_tier");
    expect(f.id).toBe("bank:card_tier:out:h-card:Nordea");
    expect(plain(f.title)).toBe("Nordea Platinum -kortti: 16,99 € kuussa, Nordea Credit -kortti 2,99 €. Ero on 168 € vuodessa.");
    expect(f.euros).toEqual({ lowCents: 16800, midCents: 16800, highCents: 16800 });
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Kortin lisäetujen arvoa ei ole tiedoissa." });
    expect(f.facts).toEqual(["nordea_price:platinum", "nordea_price:credit"]);
    expect(f.action).toBe("Vaihda kortti Nordea Credit -korttiin.");
  });

  it("late fees: their sum over 12 complete months, korkea", () => {
    const f = one(BANK_SHOWN, "late_fees");
    expect(f.id).toBe("bank:late_fees");
    expect(plain(f.title)).toBe("Myöhästymiskuluja 140 € vuodessa, 4 veloitusta. Viimeisin 20.8.2026.");
    expect(f.euros).toEqual({ lowCents: 14000, midCents: 14000, highCents: 14000 });
    expect(f.certainty.level).toBe("korkea");
    expect(f.action.startsWith("Maksa")).toBe(true);
  });

  it("counts a late fee alone: a row that also pays the bill, or over 100 €, is struck", () => {
    const collector = (bookingDate: string, cents: number, description: string) => tx({ bookingDate, amountCents: -cents, merchant: "Intrum Oy", counterparty: "INTRUM OY", description, accountId: "h-chk" });
    const mixed = collector("2026-04-20", 24500, "LASKU 4471 JA PERINTAKULU");
    const large = collector("2026-06-20", 12000, "PERINTAKULU");
    const f = one(shown(inputOf(bankPart.hit(FRAME), { txs: [mixed, large] })), "late_fees");
    expect(f.euros?.midCents).toBe(14000);
    expect(plain(f.title)).toBe("Myöhästymiskuluja 140 € vuodessa, 4 veloitusta. Viimeisin 20.8.2026.");
    expect(f.struck).toEqual([mixed.id, large.id]);
    expect(f.calc.find((c) => c.struck)).toEqual({ label: "Jätetty pois: lasku mukana tai yli 100 €", value: "365,00\u00a0€", struck: true });
    expect(f.claims.every((c) => c.startsWith("row:")) && f.claims.length === 4).toBe(true);
  });

  it("sums 12 months of bank fees by price list line", () => {
    expect(bank.assess(areaInputOf(BANK)).summary).toEqual({
      title: "Pankkikulut 1.10.2025–30.9.2026",
      lines: [
        { label: "Nordea Platinum -kortti", value: "204 €" },
        { label: "Yhteensä", value: "204 €" },
      ],
    });
    // one merchant on the checking account: the account, banking id and card fees, a 5,99 fee without card text, a withdrawal fee
    const fee = (cents: number, description: string) => monthly("Nordea", "2024-10", 2, () => cents).map((t) => ({ ...t, description }));
    const txs = [...fee(260, "PALVELUMAKSU"), ...fee(99, "PALVELUMAKSU"), ...fee(299, "KORTTIMAKSU"), ...fee(599, "PALVELUMAKSU"), tx({ bookingDate: "2026-07-03", amountCents: -500, merchant: "Nordea", description: "NOSTOMAKSU", accountId: "h-chk" })];
    const lines = bank.assess(areaInputOf(inputOf({ txs }))).summary!.lines.map((l) => `${l.label} ${plain(l.value)}`);
    expect(lines).toEqual(["Käyttötili 31 €", "Pankkitunnukset 12 €", "Nordea Debit- tai Credit-kortti 36 €", "Muut pankkikulut 77 €", "Yhteensä 156 €"]);
  });

  it("hides the card comparison once the price list has expired", () => {
    const frame: Frame = { today: "2027-06-15", start: "2025-06-01", end: "2027-05-31", months: monthRange("2025-06", "2027-05"), accounts: ACCOUNTS };
    const input = householdInput(joinHousehold([bankPart.hit(frame)], frame));
    const result = bank.assess(areaInputOf(input));
    expect(result.findings.filter((f) => f.kind === "card_tier")).toEqual([]);
    expect(result.checks.find((c) => c.id === "bank:card_tier")).toMatchObject({ status: "no_data" });
    expect(result.summary?.lines.map((l) => l.label)).toEqual(["Muut pankkikulut", "Yhteensä"]);
  });

  it("each near miss stays quiet; the Gold card matches its line and stays under the gate", () => {
    const misses = bankPart.nearMiss(FRAME).map((p) => inputOf(p));
    expect(bank.assess(areaInputOf(misses[0]!)).summary?.lines[0]?.label).toBe("Nordea Gold -kortti");
    for (const input of misses) expect(shown(input)).toEqual([]);
  });
});

describe("the same detectors as the overview", () => {
  const year = { from: "2025-10-01", to: "2026-09-30" };

  it("the rise and the renewal are the insight's items", () => {
    expect(priceRiseItems(SUBS.ctx, "2026-09-30").map((i) => `subscriptions:rise:${i.series.id}`)).toContain(one(SUBS_SHOWN, "rise").id);
    expect(renewalItems(SUBS.ctx, NO_INPUTS, 60).map((s) => `subscriptions:renewal:${s.id}`)).toEqual([one(SUBS_SHOWN, "renewal").id]);
  });

  it("the overlap is the alert's group with the same services", () => {
    const alert = buildAlerts(SUBS.ctx, { from: "2026-10-01", to: FRAME.today }).find((a) => a.kind === "overlap")!;
    expect(alert.id).toBe("overlap:music");
    expect(plain(alert.detail)).toBe("Spotify ja Tidal, yhteensä 22,98 € kuussa");
    expect(one(SUBS_SHOWN, "overlap").subject).toBe("music");
  });

  it("counts a late fee and a rise of the same merchant both in the headline", () => {
    // on another account, so the reminders do not join the bill series of the same merchant
    const reminders = ["2025-11-25", "2026-02-25", "2026-05-25", "2026-08-25"].map((d) => tx({ bookingDate: d, amountCents: -3500, merchant: "Elisa", description: "MUISTUTUSMAKSU", accountId: "h-sav" }));
    const data = buildOptimise(inputOf(subsPart.hit(FRAME), { txs: reminders }));
    const counted = allFindings(data).filter((f) => f.euros && f.certainty.level !== "matala");
    expect(counted.map((f) => f.kind).sort()).toEqual(["late_fees", "overlap", "rise"]);
    expect(data.headline).toMatchObject({ count: 3, midCents: 14400 + 13188 + 14000 });
  });

  it("every euro figure shown is a calc line", () => {
    for (const f of [...SUBS_SHOWN, ...BANK_SHOWN].filter((x) => x.euros)) {
      const values = new Set(f.calc.map((c) => plain(c.value)));
      for (const cents of [f.euros!.lowCents, f.euros!.midCents, f.euros!.highCents]) expect(values.has(plain(formatEur(cents, false))), `${f.id} ${cents}`).toBe(true);
    }
  });

  it("the late fees are the alert's rows over the same months", () => {
    const alert = buildAlerts(BANK.ctx, year).find((a) => a.kind === "late_fee")!;
    expect(plain(alert.title)).toBe("Myöhästymiskuluja 140,00 €");
    expect(one(BANK_SHOWN, "late_fees").euros?.midCents).toBe(14000);
  });
});
