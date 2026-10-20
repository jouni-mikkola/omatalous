import { describe, expect, it } from "vitest";
import { type AnalysisContext, createContext } from "../../src/analysis/context.ts";
import { addDays, monthRange } from "../../src/dates.ts";
import { type Area, buildOptimise, findingId, type FindingDraft, type FindingState, type Measure } from "../../src/optimise/index.ts";
import {
  changesSince,
  followUpOf,
  outcomeOf,
  parseSnapshot,
  proposalOf,
  type SnapshotEntry,
  snapshotOf,
} from "../../src/optimise/outcome.ts";
import type { Account, Transaction } from "../../src/types.ts";

const TODAY = "2026-10-15";
const ACCOUNTS: Account[] = [
  { id: "o-chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" },
  { id: "o-card", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" },
];

let seq = 0;
function row(bookingDate: string, amountCents: number, merchant: string, category: string, accountId = "o-chk"): Transaction {
  seq += 1;
  return {
    id: `o${String(seq).padStart(5, "0")}`,
    accountId,
    currency: "EUR",
    status: "booked",
    counterparty: null,
    counterpartyIban: null,
    description: merchant.toUpperCase(),
    mcc: null,
    merchant,
    category,
    categorySource: "user",
    isTransfer: false,
    bookingDate,
    amountCents,
  };
}

const day = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

/** A charge on `d` of every month from `from` to `to`, priced by month. */
function monthly(merchant: string, category: string, from: string, to: string, d: number, cents: (month: string) => number, accountId = "o-chk"): Transaction[] {
  return monthRange(from, to)
    .filter((m) => day(m, d) <= TODAY && cents(m) > 0)
    .map((m) => row(day(m, d), -cents(m), merchant, category, accountId));
}

/** Pay and groceries from 1.10.2024 to the judging day, so the checking account is never stale. */
function base(): Transaction[] {
  return [...monthly("Työnantaja Oy", "salary", "2024-10", "2026-10", 1, () => -300000), ...monthly("K-Market", "groceries", "2024-10", "2026-10", 3, () => 40000)].map((t) =>
    t.merchant === "Työnantaja Oy" ? { ...t, amountCents: 300000 } : t,
  );
}

const ctxOf = (rows: Transaction[]) => createContext([...base(), ...rows], ACCOUNTS, TODAY);
const seriesId = (ctx: AnalysisContext, merchant: string) => ctx.recurring.find((s) => s.merchant === merchant)!.id;

function done(id: string, effectiveDate: string, midCents: number | null): FindingState {
  return { findingId: id, status: "done", reason: null, until: null, effectiveDate, midCents, baseline: null, decidedAt: `${effectiveDate}T12:00:00+03:00` };
}

const measured = (measure: Measure) => ({ measure });

describe("outcomeOf: a monthly item", () => {
  // Viaplay 20 € a month, cancelled in July 2026: August and September are the months after
  const cancelled = () => ctxOf(monthly("Viaplay", "subscriptions", "2024-10", "2026-07", 5, () => 2000));

  it("vahvistui: the after median is lower by 80 % of mid / 12 and every after month is below the baseline", () => {
    const ctx = cancelled();
    const id = findingId("subscriptions", "unused", seriesId(ctx, "Viaplay"));
    // the finding no longer shows once the subscription stopped: its measure is read from the id
    const o = outcomeOf(ctx, done(id, "2026-07-10", 24000), null);
    expect(o).toMatchObject({ verdict: "vahvistui", monthlyCents: 2000, reason: "20 € vähemmän kuussa: muutoksen jälkeen ei maksuja 2 kuukauteen, ennen 20 € kuussa." });
    // the table of Seuranta reads the two levels the verdict compared and the months, the changeover month left out
    expect(o.detail?.before).toEqual({ cents: 2000, months: 21 });
    expect(o.detail?.after).toEqual({ cents: 0, months: 2 });
    expect(o.detail?.changeMonth).toBe("2026-07");
    expect(o.detail?.sums.map((s) => s.month)).toEqual([...monthRange("2025-07", "2026-06"), "2026-08", "2026-09"]);
    expect(o.detail?.sums.at(-1)?.cents).toBe(0);
  });

  it("detail: spending at a merchant is the medians of complete months before and after, as the reason says", () => {
    const ctx = ctxOf(monthly("Hesburger", "restaurants", "2024-10", "2026-10", 12, (m) => (m >= "2026-06" ? 3000 : 9000)));
    const o = outcomeOf(ctx, done(findingId("habits", "fast_food", "Hesburger"), "2026-06-01", 72000), measured({ kind: "merchants", keys: ["Hesburger"] }));
    expect(o.reason).toMatch(/muutoksen jälkeen yleensä 30.€ kuussa \(3 kuukautta\), ennen sitä 90.€/);
    expect(o.detail).toMatchObject({ before: { cents: 9000, months: 12 }, after: { cents: 3000, months: 3 }, changeMonth: "2026-06" });
    expect(o.detail!.sums).toHaveLength(15);
    expect(o.detail!.before.cents - o.detail!.after.cents).toBe(o.monthlyCents);
  });

  it("detail is left out while the verdict waits", () => {
    const ctx = cancelled();
    const id = findingId("subscriptions", "unused", seriesId(ctx, "Viaplay"));
    expect(outcomeOf(ctx, done(id, "2026-09-10", 24000), null).detail).toBeUndefined();
  });

  const repriced = (after: number) => ctxOf(monthly("Elisa", "telecom", "2024-10", "2026-10", 1, (m) => (m >= "2026-07" ? after : 3000)));

  it("todennäköinen from 50 %, epäselvä below it, huonompi when higher by the gate", () => {
    const at = (after: number) => {
      const ctx = repriced(after);
      const id = seriesId(ctx, "Elisa");
      return outcomeOf(ctx, done(findingId("subscriptions", "price", id), "2026-07-01", 24000), measured({ kind: "series", keys: [id], perYear: 12 }));
    };
    expect(at(1700)).toMatchObject({ verdict: "todennäköinen", monthlyCents: 1300 });
    expect(at(1300)).toMatchObject({ verdict: "vahvistui", monthlyCents: 1700 });
    const small = at(2700);
    expect(small).toMatchObject({ verdict: "epäselvä", monthlyCents: 300 });
    // a renegotiated contract is expected to keep billing
    expect(small.reason).not.toContain("veloituksia tulee yhä");
    const worse = at(4500);
    expect(worse).toMatchObject({ verdict: "huonompi", monthlyCents: -1500 });
    expect(worse.reason.startsWith("15 € enemmän kuussa")).toBe(true);
  });

  it("a cancellation whose payment still runs says so", () => {
    const ctx = ctxOf(monthly("Viaplay", "subscriptions", "2024-10", "2026-10", 5, () => 2000));
    const id = seriesId(ctx, "Viaplay");
    const finding = { action: "Irtisano Viaplay.", measure: { kind: "series", keys: [id], perYear: 12 } as Measure };
    expect(outcomeOf(ctx, done(findingId("subscriptions", "unused", id), "2026-07-10", 24000), finding)).toMatchObject({
      verdict: "epäselvä",
      monthlyCents: 0,
      reason: "±0 € kuussa: maksut 20 € kuussa muutoksen jälkeen ja 20 € ennen sitä. Viaplay: veloituksia tulee yhä, viimeksi 5.10.2026.",
    });
  });

  it("odottaa until two complete months follow the changeover month", () => {
    const ctx = cancelled();
    const id = findingId("subscriptions", "unused", seriesId(ctx, "Viaplay"));
    expect(outcomeOf(ctx, done(id, "2026-09-03", 24000), null)).toEqual({
      verdict: "odottaa",
      monthlyCents: null,
      reason: "Tulos lasketaan, kun muutoksen jälkeen on 2 valmista kuukautta: 1.12.2026.",
    });
    expect(outcomeOf(ctx, done(id, "2026-08-03", 24000), null)).toMatchObject({ verdict: "odottaa", reason: expect.stringContaining("1.11.2026") });
    // a change dated ahead waits too
    expect(outcomeOf(ctx, done(id, "2027-01-01", 24000), null).verdict).toBe("odottaa");
  });

  it("a finding that started from a spike never reads as a saving when spending returns to its usual size", () => {
    // Kahvila Kulma: 100 € a month, 400 € in June 2026, the finding was made of that June
    const ctx = ctxOf(monthly("Kahvila Kulma", "restaurants", "2024-10", "2026-09", 12, (m) => (m === "2026-06" ? 40000 : 10000)));
    const o = outcomeOf(ctx, done(findingId("habits", "visits", "Kahvila Kulma"), "2026-07-01", 36000), measured({ kind: "merchants", keys: ["Kahvila Kulma"] }));
    expect(o).toMatchObject({ verdict: "epäselvä", monthlyCents: 0 });
    expect(o.reason.startsWith("±0 € kuussa")).toBe(true);
    // three months of the spike in the last year are still under half: the median stays at the usual size
    const longer = ctxOf(monthly("Kahvila Kulma", "restaurants", "2024-10", "2026-09", 12, (m) => (m >= "2026-04" && m <= "2026-06" ? 40000 : 10000)));
    expect(outcomeOf(longer, done("habits:visits:Kahvila Kulma", "2026-07-01", 36000), measured({ kind: "merchants", keys: ["Kahvila Kulma"] })).verdict).toBe("epäselvä");
  });

  it("an account that stopped syncing never reads as a saving", () => {
    // the card's rows end in July: its subscription looks stopped only because nothing was fetched
    const ctx = ctxOf(monthly("Netflix", "subscriptions", "2024-10", "2026-07", 8, () => 1999, "o-card"));
    const id = findingId("subscriptions", "unused", seriesId(ctx, "Netflix"));
    expect(outcomeOf(ctx, done(id, "2026-07-10", 24000), null)).toEqual({ verdict: "epäselvä", monthlyCents: null, reason: "Tilin Kortti tapahtumia ei ole haettu 8.7.2026 jälkeen." });
    // a card that paid it until March 2025 is outside the year the baseline stands on
    const moved = ctxOf([...monthly("Netflix", "subscriptions", "2024-10", "2025-03", 8, () => 1999, "o-card"), ...monthly("Netflix", "subscriptions", "2025-04", "2026-07", 8, () => 1999)]);
    const name = findingId("subscriptions", "unused", "Netflix");
    expect(outcomeOf(moved, done(name, "2026-07-10", 24000), null)).toMatchObject({ verdict: "vahvistui", monthlyCents: 1999 });
  });

  it("a measure of kind none, or an id with nothing to measure, is epäselvä without a figure", () => {
    const ctx = cancelled();
    expect(outcomeOf(ctx, done("tax:household_deduction", "2026-05-01", 30000), measured({ kind: "none", keys: [] }))).toMatchObject({ verdict: "epäselvä", monthlyCents: null });
    expect(outcomeOf(ctx, done("tax:household_deduction", "2026-05-01", 30000), null)).toMatchObject({ verdict: "epäselvä", monthlyCents: null });
  });

  it("an unchanged fee with 11 charges a year costs the same on both sides and never reads as huonompi", () => {
    // day care 300 € a month, free in July: the series bills 11 times a year before the decision and after it
    const ctx = ctxOf(monthly("Helsingin Kaupunki", "kids", "2024-10", "2026-10", 5, (m) => (m.endsWith("-07") ? 0 : 30000)));
    const series = ctx.recurring.find((s) => s.merchant === "Helsingin Kaupunki")!;
    expect(series.perMonth * 12).toBe(11);
    const id = findingId("kids", "daycare", series.id);
    // the measure read from the id, and a finding that still counts twelve charges a year
    for (const finding of [null, measured({ kind: "series", keys: [series.id], perYear: 12 })]) {
      const o = outcomeOf(ctx, done(id, "2026-06-01", 24000), finding);
      expect(o).toMatchObject({ verdict: "epäselvä", monthlyCents: 0 });
      expect(o.reason.replace(/\s/g, " ")).toBe("±0 € kuussa: maksut 275 € kuussa muutoksen jälkeen ja 275 € ennen sitä.");
    }
  });
});

describe("outcomeOf: a switch to a new payee", () => {
  // Helen 60 € a month to June 2026, Oomi 45 € a month from July
  const switched = () =>
    ctxOf([...monthly("Helen", "utilities", "2024-10", "2026-06", 20, () => 6000), ...monthly("Oomi", "utilities", "2026-07", "2026-10", 5, () => 4500)]);

  it("counts the new payee's charges and names it: the saving is the difference, never the whole old bill", () => {
    const ctx = switched();
    const id = findingId("electricity", "contract", seriesId(ctx, "Helen"));
    const o = outcomeOf(ctx, done(id, "2026-07-01", 18000), null);
    expect(o.replacement).toEqual({ merchant: "Oomi", date: "2026-07-05", text: "Korvaava palvelu alkoi: Oomi" });
    expect(o).toMatchObject({ verdict: "vahvistui", monthlyCents: 1500 });
    expect(o.reason).toContain("Oomi on laskettu mukaan.");
    // the same switch against a larger mid is only likely or unclear, never confirmed
    expect(outcomeOf(ctx, done(id, "2026-07-01", 60000), null).verdict).toBe("epäselvä");
  });

  it("proposes the change on an active finding and never marks it done", () => {
    const ctx = switched();
    const helen = seriesId(ctx, "Helen");
    const area: Area = {
      id: "electricity",
      label: "Sähkö",
      assess: () => ({
        checks: [],
        findings: [
          {
            id: findingId("electricity", "contract", helen),
            area: "electricity",
            kind: "contract",
            subject: helen,
            title: "Helen: 180 € vuodessa.",
            action: "Kilpailuta sähkösopimus.",
            euros: { lowCents: 12000, midCents: 18000, highCents: 24000 },
            decideBy: null,
            weaknesses: [],
            shared: false,
            calc: [{ label: "Vuodessa", value: "180 €" }],
            rows: [],
            struck: [],
            claims: [`series:${helen}`],
            measure: { kind: "series", keys: [helen], perYear: 12 },
            facts: [],
          } satisfies FindingDraft,
        ],
      }),
    };
    const data = buildOptimise({ ctx, balances: [], areas: [area] });
    const follow = followUpOf(ctx, data, []);
    expect(follow.proposals).toEqual([{ findingId: `electricity:contract:${helen}`, date: "2026-07-05", text: "Näyttää siltä, että vaihdoit sopimuksen 5.7.2026. Vahvista." }]);
    expect(proposalOf(ctx, data.areas[0]!.findings[0]!)).toEqual(follow.proposals[0]);
    // nothing was decided: the finding is still active and Jo hoidossa is empty, also when the page is built again
    expect(data.done).toEqual([]);
    expect(follow.outcomes).toEqual([]);
    expect(buildOptimise({ ctx, balances: [], areas: [area], states: [] }).areas[0]!.findings.map((f) => f.id)).toEqual([`electricity:contract:${helen}`]);
  });

  it("proposes nothing while the old payment still runs", () => {
    const ctx = ctxOf([...monthly("Helen", "utilities", "2024-10", "2026-10", 20, () => 6000), ...monthly("Oomi", "utilities", "2026-07", "2026-10", 5, () => 4500)]);
    expect(proposalOf(ctx, { id: "electricity:contract:x", measure: { kind: "series", keys: [seriesId(ctx, "Helen")], perYear: 12 } })).toBeNull();
  });
});

describe("outcomeOf: quarterly and yearly items, seasons and the unit price", () => {
  it("a yearly item waits one cycle, and then while its new charge forms no series", () => {
    const ctx = ctxOf([row("2024-11-10", -60000, "Lähivakuutus", "insurance"), row("2025-11-10", -45000, "Lähivakuutus", "insurance")]);
    const measure: Measure = { kind: "merchants", keys: ["Lähivakuutus"], perYear: 1 };
    // one charge of 450 € could start a yearly contract or a monthly one: the verdict does not guess
    expect(outcomeOf(ctx, done("insurance:renewal:Lähivakuutus", "2025-09-20", 15000), measured(measure))).toEqual({
      verdict: "odottaa",
      monthlyCents: null,
      reason: "Uuden maksun laskutusväli ei vielä näy.",
    });
    // dated in October 2025, eleven complete months follow: one cycle is twelve
    expect(outcomeOf(ctx, done("insurance:renewal:Lähivakuutus", "2025-10-20", 15000), measured(measure))).toMatchObject({
      verdict: "odottaa",
      reason: "Tulos lasketaan, kun muutoksen jälkeen on 12 valmista kuukautta: 1.11.2026.",
    });
    // the same price a year later is the old yearly series going on, at its own cadence
    const same = ctxOf([row("2024-11-10", -60000, "Lähivakuutus", "insurance"), row("2025-11-10", -60000, "Lähivakuutus", "insurance")]);
    expect(outcomeOf(same, done("insurance:renewal:Lähivakuutus", "2025-09-20", 15000), measured(measure))).toMatchObject({ verdict: "epäselvä", monthlyCents: 0 });
  });

  it("a new payee billing yearly in the changeover month waits for its cadence, then counts per month (If to LähiTapiola)", () => {
    // If 150 € a quarter; LähiTapiola 500 € a year from June, paid in the changeover month
    const first = ctxOf([...monthly("If", "insurance", "2024-10", "2026-04", 10, (m) => (["01", "04", "07", "10"].includes(m.slice(5)) ? 15000 : 0)), row("2026-06-05", -50000, "LähiTapiola", "insurance")]);
    const id = findingId("insurance", "renewal", seriesId(first, "If"));
    expect(outcomeOf(first, done(id, "2026-06-01", 10000), null)).toEqual({ verdict: "odottaa", monthlyCents: null, reason: "Uuden maksun laskutusväli ei vielä näy." });
    // a year on, the second charge makes it a yearly series: 50 € a month before, 500 € / 12 after
    const later = ctxOf([
      ...monthly("If", "insurance", "2024-10", "2025-04", 10, (m) => (["01", "04", "07", "10"].includes(m.slice(5)) ? 15000 : 0)),
      row("2025-06-05", -50000, "LähiTapiola", "insurance"),
      row("2026-06-05", -50000, "LähiTapiola", "insurance"),
    ]);
    const o = outcomeOf(later, done(findingId("insurance", "renewal", seriesId(later, "If")), "2025-06-01", 10000), null);
    expect(o).toMatchObject({ verdict: "vahvistui", monthlyCents: 5000 - Math.round(50000 / 12), replacement: { merchant: "LähiTapiola" } });
  });

  it("a quarterly charge that became a monthly one of the same total is no saving", () => {
    const ctx = ctxOf([
      ...monthly("Turva", "insurance", "2024-10", "2026-04", 15, (m) => (["01", "04", "07", "10"].includes(m.slice(5)) ? 9000 : 0)),
      ...monthly("Turva", "insurance", "2026-06", "2026-10", 16, () => 3000),
    ]);
    const quarterly = ctx.recurring.find((s) => s.merchant === "Turva" && s.cadence === "quarterly")!;
    const o = outcomeOf(ctx, done(findingId("insurance", "renewal", quarterly.id), "2026-06-01", 24000), measured({ kind: "series", keys: [quarterly.id], perYear: 4 }));
    expect(o).toMatchObject({ verdict: "epäselvä", monthlyCents: 0, reason: "±0 € kuussa: maksut 30 € kuussa muutoksen jälkeen ja 30 € ennen sitä." });
  });

  it("a monthly fee that became one yearly payment in the changeover month waits, through a series or a merchant", () => {
    const ctx = ctxOf([...monthly("Kuntosali", "fitness", "2024-10", "2026-06", 3, () => 5000), row("2026-07-03", -60000, "Kuntosali", "fitness")]);
    const id = seriesId(ctx, "Kuntosali");
    const waiting = { verdict: "odottaa", monthlyCents: null, reason: "Uuden maksun laskutusväli ei vielä näy." };
    expect(outcomeOf(ctx, done(findingId("subscriptions", "unused", id), "2026-07-01", 60000), measured({ kind: "series", keys: [id], perYear: 12 }))).toEqual(waiting);
    expect(outcomeOf(ctx, done("habits:repeat:Kuntosali", "2026-07-01", 60000), measured({ kind: "merchants", keys: ["Kuntosali"] }))).toEqual(waiting);
  });

  it("a yearly charge not seen yet waits a month past the cycle before it reads as stopped", () => {
    const ctx = ctxOf([row("2024-10-28", -60000, "Lähivakuutus", "insurance")]);
    const measure: Measure = { kind: "merchants", keys: ["Lähivakuutus"], perYear: 1 };
    // changeover September 2025: October to September is one cycle, the charge may be days late
    expect(outcomeOf(ctx, done("insurance:renewal:Lähivakuutus", "2025-09-20", 60000), measured(measure))).toMatchObject({ verdict: "odottaa", reason: "Seuraava maksu ei ole vielä näkynyt." });
    expect(outcomeOf(ctx, done("insurance:renewal:Lähivakuutus", "2025-08-20", 60000), measured(measure))).toMatchObject({ verdict: "vahvistui", monthlyCents: 5000 });
  });

  it("a season compares the same months a year earlier deflated by CPI", () => {
    const ctx = ctxOf([
      row("2024-12-10", -50000, "Lahjakauppa", "gifts_donations"),
      row("2025-01-10", -10000, "Lahjakauppa", "gifts_donations"),
      row("2025-12-10", -30000, "Lahjakauppa", "gifts_donations"),
      row("2026-01-10", -8000, "Lahjakauppa", "gifts_donations"),
    ]);
    const o = outcomeOf(ctx, done("seasons:christmas", "2025-11-15", 12000), measured({ kind: "season", keys: ["gifts_donations"] }));
    // December 2025: 500 € × 1,002 − 300 €; January 2026: 100 € × 0,998 − 80 €; the median of the two
    expect(o).toMatchObject({ verdict: "vahvistui", monthlyCents: Math.round((50100 - 30000 + 9980 - 8000) / 2) });
    expect(o.reason).toBe("110 € vähemmän kuussa kuin samaan aikaan vuotta aiemmin. Vuoden takaiset summat on korjattu kuluttajahintojen muutoksella.");
  });

  it("the unit compares the bills of the same months a year earlier, says so, and is never more than todennäköinen", () => {
    const ctx = ctxOf(monthly("Helen", "utilities", "2024-10", "2026-10", 20, (m) => (m >= "2026-07" ? 5000 : 8000)));
    const o = outcomeOf(ctx, done("electricity:price", "2026-07-01", 24000), measured({ kind: "unit", keys: ["Helen"], perYear: 12 }));
    // 30 € less against an expected 20 € with every month lower would be vahvistui
    expect(o).toEqual({
      verdict: "todennäköinen",
      monthlyCents: 3000,
      reason: "30 € vähemmän kuussa kuin samaan aikaan vuotta aiemmin. Vertailussa ovat laskujen summat, joten kulutuksen muutos näkyy luvussa.",
    });
    expect(o.reason).not.toMatch(/kWh|kilowatti/);
  });
});

describe("snapshots and changes", () => {
  const entry = (id: string, midCents: number | null, status: SnapshotEntry["status"] = "active", area: SnapshotEntry["area"] = "subscriptions"): SnapshotEntry => ({
    id,
    area,
    midCents,
    certainty: status === "active" ? "korkea" : null,
    status,
  });
  it("lists new, grown 25 % or more, shrunk 25 % or more and resolved, and nothing for smaller moves", () => {
    const previous = [entry("subscriptions:a:1", 20000), entry("subscriptions:a:2", 20000), entry("food:b", 40000, "active", "food"), entry("subscriptions:a:3", 20000)];
    const current = [entry("subscriptions:a:1", 25000), entry("subscriptions:a:2", 15000), entry("food:b", 39000, "active", "food"), entry("food:c", 13000, "active", "food")];
    expect(changesSince(previous, current)).toEqual([
      { id: "food:c", area: "food", change: "new", midCents: 13000, previousCents: null },
      { id: "subscriptions:a:1", area: "subscriptions", change: "grown", midCents: 25000, previousCents: 20000 },
      { id: "subscriptions:a:2", area: "subscriptions", change: "shrunk", midCents: 15000, previousCents: 20000 },
      { id: "subscriptions:a:3", area: "subscriptions", change: "resolved", midCents: null, previousCents: 20000 },
    ]);
    expect(changesSince(previous, [entry("subscriptions:a:1", 24900)]).filter((c) => c.change !== "resolved")).toEqual([]);
  });

  it("every finding is shown, so a fourth in an area is new and one that leaves is resolved", () => {
    const three = [entry("subscriptions:a:1", 20000), entry("subscriptions:a:2", 20000), entry("subscriptions:a:3", 20000)];
    expect(changesSince(three, [...three, entry("subscriptions:a:4", 30000)])).toEqual([{ id: "subscriptions:a:4", area: "subscriptions", change: "new", midCents: 30000, previousCents: null }]);
    expect(changesSince(three, three.slice(0, 2))).toEqual([{ id: "subscriptions:a:3", area: "subscriptions", change: "resolved", midCents: null, previousCents: 20000 }]);
    // a decision is the household's own move, not a change in the data
    expect(changesSince(three, [entry("subscriptions:a:1", 20000, "done"), ...three.slice(1)])).toEqual([]);
  });

  it("the snapshot holds id, area, mid, certainty and status and nothing else, and a damaged one reads as entries it can trust", () => {
    const ctx = ctxOf(monthly("Viaplay", "subscriptions", "2024-10", "2026-10", 5, () => 2000));
    const id = seriesId(ctx, "Viaplay");
    const area: Area = {
      id: "subscriptions",
      label: "Tilaukset",
      assess: () => ({
        checks: [],
        findings: [
          {
            id: findingId("subscriptions", "unused", id),
            area: "subscriptions",
            kind: "unused",
            subject: id,
            title: "Viaplay: 240 € vuodessa.",
            action: "Irtisano Viaplay.",
            euros: { lowCents: 24000, midCents: 24000, highCents: 24000 },
            decideBy: null,
            weaknesses: [],
            shared: false,
            calc: [{ label: "Vuodessa", value: "240 €" }],
            rows: [],
            struck: [],
            claims: [],
            measure: { kind: "series", keys: [id], perYear: 12 },
            facts: [],
          },
        ],
      }),
    };
    const snooze: FindingState = { findingId: "food:delivery", status: "snoozed", reason: null, until: addDays(TODAY, 30), effectiveDate: null, midCents: 30000, baseline: null, decidedAt: `${TODAY}T10:00:00+03:00` };
    const data = buildOptimise({ ctx, balances: [], areas: [area], states: [snooze] });
    const snapshot = snapshotOf(data, [snooze]);
    expect(snapshot).toEqual([
      { id: `subscriptions:unused:${id}`, area: "subscriptions", midCents: 24000, certainty: "korkea", status: "active" },
      { id: "food:delivery", area: "food", midCents: 30000, certainty: null, status: "snoozed" },
    ]);
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseSnapshot({ findings: 3 })).toEqual([]);
    expect(parseSnapshot([...snapshot, { id: "nope", area: "food", midCents: 1, certainty: null, status: "active" }, { ...snapshot[0], midCents: 1.5 }, null])).toEqual(snapshot);
  });

  it("the line puts the euros found each month against the euros confirmed by then", () => {
    const ctx = ctxOf(monthly("Viaplay", "subscriptions", "2024-10", "2026-07", 5, () => 2000));
    const id = findingId("subscriptions", "unused", seriesId(ctx, "Viaplay"));
    const state = done(id, "2026-07-10", 24000);
    const data = buildOptimise({ ctx, balances: [], areas: [], states: [state] });
    expect(data.done).toEqual([{ state, finding: null }]);
    const found = [entry("food:b", 50000, "active", "food"), entry("food:c", 10000, "dismissed", "food"), { ...entry("food:d", 7000, "active", "food"), certainty: "matala" as const }];
    const follow = followUpOf(ctx, data, [
      { month: "2026-10", entries: [...found, entry(id, 24000, "done")] },
      { month: "2026-09", entries: found },
    ]);
    expect(follow.outcomes).toEqual([{ findingId: id, outcome: expect.objectContaining({ verdict: "vahvistui", monthlyCents: 2000 }) }]);
    // in September only August had passed after the change: nothing was confirmed yet
    expect(follow.line).toEqual([
      { month: "2026-09", foundCents: 50000, confirmedCents: 0 },
      { month: "2026-10", foundCents: 74000, confirmedCents: 24000 },
    ]);
  });
});
