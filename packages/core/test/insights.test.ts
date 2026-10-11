import { describe, expect, it } from "vitest";
import { createContext, historyCovers, inDays } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { buildInsights, type Insight, insightDismissSubject, OVERVIEW_INSIGHTS, rankInsights } from "../src/analysis/insights/index.ts";
import { lastCompleteMonths, shiftMonth } from "../src/analysis/insights/shared.ts";
import { type DateRange, toDayRange } from "../src/analysis/period.ts";
import { isCompleteMonth } from "../src/analysis/usual.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const running: DateRange = { from: "2026-10-01", to: today };

/** `count` charges on `day` of each month from `start` (YYYY-MM). */
function monthly(start: string, day: number, count: number, amount: number | ((i: number) => number), partial: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    tx({ merchant: "Test", ...partial, bookingDate: `${addMonths(start, i)}-${String(day).padStart(2, "0")}`, amountCents: typeof amount === "function" ? amount(i) : amount }),
  );
}

/** 30 months from April 2024: pay, rent, food shops and restaurants with small month-to-month changes. */
function household(): Transaction[] {
  const n = 30;
  return [
    ...monthly("2024-04", 15, n, 350000, { merchant: "Työnantaja Oy", category: "salary" }),
    ...monthly("2024-04", 2, n, -90000, { merchant: "Vuokranantaja", category: "housing" }),
    ...[5, 12, 19, 26].flatMap((day, k) => monthly("2024-04", day, n, (i) => -(6000 + (((i % 12) * 137 + k * 500) % 3000)), { merchant: "Prisma", category: "groceries" })),
    ...[9, 23].flatMap((day, k) => monthly("2024-04", day, n, (i) => -(2500 + (((i % 12) * 53 + k * 300) % 2000)), { merchant: "Ravintola", category: "restaurants" })),
  ];
}

function insightsOf(txs: Transaction[], range: DateRange = running, inputs: UserInputs = NO_INPUTS): Insight[] {
  const ctx = createContext(txs, [checking], today);
  const current = inDays(ctx, toDayRange(range));
  return rankInsights({ ctx, range, current, totals: totalsOf(current.map((t) => t.flows)), inputs });
}

const byId = (list: Insight[], prefix: string) => list.find((i) => i.id.startsWith(prefix));
/** Texts with plain spaces: euro amounts and percentages carry no-break spaces. */
const plain = (s: string | undefined) => s?.replace(/ /g, " ");

/** Every insight a scenario below produced, for the style sheet check. */
const seen: Insight[] = [];
const keep = (list: Insight[]) => {
  seen.push(...list);
  return list;
};

describe("insights", () => {
  it("an ordinary household is quiet", () => {
    expect(insightsOf(household())).toEqual([]);
  });

  it("a price rise says what it adds to a year, several rises are one line", () => {
    const elisa = monthly("2025-10", 7, 12, (i) => (i < 8 ? -10990 : -13990), { merchant: "Elisa", category: "telecom" });
    const one = keep(insightsOf([...household(), ...elisa]));
    expect(one.map((i) => i.id)).toEqual([expect.stringMatching(/^price:/)]);
    expect(plain(one[0]!.title)).toBe("Elisa: hinta nousi 360 € vuodessa");
    expect(plain(one[0]!.detail)).toBe("109,90 € → 139,90 € 7.6.2026 alkaen.");
    expect(one[0]).toMatchObject({ yearlyCents: 36000, merchant: "Elisa" });
    expect(one[0]!.rows!.length).toBeGreaterThan(0);

    const netflix = monthly("2025-10", 11, 12, (i) => (i < 7 ? -1299 : -1599), { merchant: "Netflix", category: "subscriptions" });
    const spotify = monthly("2025-10", 13, 12, (i) => (i < 6 ? -1199 : -1299), { merchant: "Spotify", category: "subscriptions" });
    const three = keep(insightsOf([...household(), ...elisa, ...netflix, ...spotify]));
    const rises = byId(three, "price-rises")!;
    expect(plain(rises.title)).toBe("Kolme toistuvaa maksua kallistui, yhteensä 408 € vuodessa");
    expect(plain(rises.detail)).toBe("Elisa, Netflix ja Spotify, 12 kuukauden ajalta 10.10.2025 alkaen.");
    expect(rises.yearlyCents).toBe(40800);
    // a rise under a euro or under 5 % is rounding
    const small = monthly("2025-10", 7, 12, (i) => (i < 8 ? -2990 : -3050), { merchant: "Elisa", category: "telecom" });
    expect(insightsOf([...household(), ...small])).toEqual([]);
  });

  it("a loan that ended frees its instalment; a refinancing frees nothing", () => {
    const loan = monthly("2025-08", 20, 12, -25000, { merchant: "Autolaina", category: "loans" });
    const freed = keep(insightsOf([...household(), ...loan]));
    expect(freed).toHaveLength(1);
    expect(freed[0]).toMatchObject({ tone: "good", yearlyCents: 300000, link: { merchant: "Autolaina" } });
    expect(plain(freed[0]!.title)).toBe("Autolaina: 250 € kuussa vapautui");
    expect(freed[0]!.detail).toBe("Viimeinen maksu 20.7.2026, 12 maksua 20.8.2025 alkaen.");
    // waits two intervals: a month after the last instalment it may be late
    expect(insightsOf([...household(), ...loan], { from: "2026-08-01", to: "2026-08-25" }).some((i) => i.id.startsWith("stopped:"))).toBe(false);
    const refinanced = monthly("2026-08", 1, 3, -26000, { merchant: "Lainapankki", category: "loans" });
    expect(insightsOf([...household(), ...loan, ...refinanced]).some((i) => i.id.startsWith("stopped:"))).toBe(false);
  });

  it("a new subscription after a 1 € trial says so", () => {
    const trial = tx({ bookingDate: "2026-07-22", amountCents: -100, merchant: "Storytel", category: "subscriptions" });
    const paid = monthly("2026-08", 5, 3, -2999, { merchant: "Storytel", category: "subscriptions" });
    const list = keep(insightsOf([...household(), trial, ...paid]));
    const n = byId(list, "new:")!;
    expect(plain(n.title)).toBe("Uusi toistuva maksu: Storytel 29,99 € kuussa");
    expect(plain(n.detail)).toBe("1 € kokeilu 22.7.2026, sen jälkeen 3 veloitusta 5.8.2026 alkaen.");
    expect(n.rows).toContain(trial.id);
    expect(n.yearlyCents).toBe(2999 * 12);
  });

  it("subscriptions counted against a year ago", () => {
    const old = monthly("2024-06", 3, 28, -1299, { merchant: "Netflix", category: "subscriptions" });
    const added = [
      ...monthly("2026-03", 4, 7, -1099, { merchant: "HBO Max", category: "subscriptions" }),
      ...monthly("2026-03", 6, 7, -999, { merchant: "Disney+", category: "subscriptions" }),
      ...monthly("2026-04", 8, 6, -799, { merchant: "Strava", category: "fitness" }),
    ];
    const list = keep(insightsOf([...household(), ...old, ...added]));
    const a = byId(list, "subscriptions-added")!;
    expect(plain(a.title)).toBe("Tilauksia 4, vuosi sitten 1: +29 € kuussa");
    expect(plain(a.detail)).toBe("Uudet: HBO Max, Disney+ ja Strava, 348 € vuodessa.");
    expect(a.yearlyCents).toBe(2897 * 12);
  });

  it("a yearly subscription renewing within 45 days, only while the period runs", () => {
    const adobe = [tx({ bookingDate: "2024-10-20", amountCents: -35988, merchant: "Adobe", category: "subscriptions" }), tx({ bookingDate: "2025-10-20", amountCents: -35988, merchant: "Adobe", category: "subscriptions" })];
    const list = keep(insightsOf([...household(), ...adobe]));
    const r = byId(list, "renewals:")!;
    expect(plain(r.title)).toBe("Adobe uusiutuu 20.10.2026, 359,88 €");
    expect(r.detail).toBe("Vuositilaus, viimeksi veloitettu 20.10.2025.");
    expect(r.yearlyCents).toBe(35988);
    expect(insightsOf([...household(), ...adobe], { from: "2026-09-01", to: "2026-09-30" }).some((i) => i.id.startsWith("renewals:"))).toBe(false);
  });

  it("instalments: the same sum three months in a row, never a single payment", () => {
    const klarna = monthly("2026-07", 10, 3, -4500, { merchant: "Klarna", category: "shopping" });
    const list = keep(insightsOf([...household(), ...klarna]));
    const i = byId(list, "instalments")!;
    expect(plain(i.title)).toBe("Klarna: osamaksuja 45 € kuussa");
    expect(i.detail).toBe("Sama erä vähintään kolmena kuukautena peräkkäin.");
    expect(i.rows).toEqual(klarna.map((t) => t.id));
    expect(insightsOf([...household(), klarna[2]!]).some((x) => x.id === "instalments")).toBe(false);
  });

  it("a month that is dearer than usual two years running, its one-offs left out", () => {
    const december = (year: number) => [3, 7, 11, 15, 18, 21].map((d) => tx({ bookingDate: `${year}-12-${String(d).padStart(2, "0")}`, amountCents: -10000, merchant: "Stockmann", category: "shopping" }));
    const list = keep(insightsOf([...household(), ...december(2024), ...december(2025)]));
    const s = byId(list, "seasons:")!;
    expect(plain(s.title)).toMatch(/^Joulukuu \d{3} € tavallista kalliimpi kahtena vuonna$/);
    expect(s.yearlyCents).toBeGreaterThan(55000);
    expect(s.yearlyCents).toBeLessThan(65000);
    expect(s.link).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    // one sofa in December 2025 is a one-off, not a season
    const sofa = tx({ bookingDate: "2025-12-12", amountCents: -60000, merchant: "Asko", category: "home" });
    expect(insightsOf([...household(), ...december(2024), sofa]).some((i) => i.id.startsWith("seasons:"))).toBe(false);
  });

  it("purchases growing faster than income", () => {
    // six visits a month on uneven days and sums, so no series forms: purchases, not a bill
    const shops = ["Ravintola Savoy", "Zara", "Kahvila Ilo"];
    const more = Array.from({ length: 36 }, (_, k) =>
      tx({ bookingDate: `${addMonths("2026-04", Math.floor(k / 6))}-${String([3, 6, 14, 15, 24, 28][k % 6]).padStart(2, "0")}`, amountCents: -(4000 + ((k * 731) % 2000)), merchant: shops[k % 3]!, category: "restaurants" }),
    );
    const list = keep(insightsOf([...household(), ...more]));
    const g = byId(list, "spending-growth")!;
    expect(plain(g.title)).toMatch(/^Ostokset \+\d+ % vuodessa, tulot ±0 %$/);
    expect(plain(g.detail)).toMatch(/^Loka 2025 – syyskuu 2026|^Lokakuu 2025 – syyskuu 2026 verrattuna samaan aikaan vuotta aiemmin/);
    // the extra purchases of six months in the twelve compared: their sum is the yearly figure
    expect(g.yearlyCents).toBe(-more.reduce((sum, t) => sum + t.amountCents, 0));
  });

  it("fixed costs take a larger share of income than a year ago", () => {
    const loan = monthly("2026-01", 20, 9, -40000, { merchant: "Autolaina", category: "loans" });
    const list = keep(insightsOf([...household(), ...loan]));
    const c = byId(list, "commitments-share")!;
    expect(plain(c.title)).toBe("Kiinteät menot vievät 37 % tuloista, vuosi sitten 26 %");
    expect(plain(c.detail)).toBe("Kiinteät menot 1 300 € ja tavalliset tulot 3 500 € kuussa; vuosi sitten 900 € ja 3 500 €.");
    expect(c.tone).toBe("warning");
  });

  it("credit drawn in the period", () => {
    const draw = tx({ bookingDate: "2026-09-10", amountCents: 100000, merchant: "Nordea", category: "credit_draw" });
    const list = keep(insightsOf([...household(), draw], { from: "2026-09-01", to: "2026-09-30" }));
    expect(byId(list, "borrowed")).toMatchObject({ yearlyCents: 100000, rows: [draw.id], link: { category: "credit_draw" } });
    expect(plain(byId(list, "borrowed")!.detail)).toBe("Yksi nosto 1.–30.9.2026.");
  });

  it("ranks by yearlyCents and shows three on the overview", () => {
    const txs = [
      ...household(),
      ...monthly("2025-10", 7, 12, (i) => (i < 8 ? -3990 : -6990), { merchant: "Elisa", category: "telecom" }),
      ...monthly("2025-08", 20, 12, -25000, { merchant: "Autolaina", category: "loans" }),
      ...monthly("2026-07", 10, 3, -4500, { merchant: "Klarna", category: "shopping" }),
      tx({ bookingDate: "2024-10-20", amountCents: -35988, merchant: "Adobe", category: "subscriptions" }),
      tx({ bookingDate: "2025-10-20", amountCents: -35988, merchant: "Adobe", category: "subscriptions" }),
      tx({ bookingDate: "2026-10-05", amountCents: 50000, merchant: "Nordea", category: "credit_draw" }),
    ];
    const all = insightsOf(txs);
    expect(all.length).toBeGreaterThan(OVERVIEW_INSIGHTS);
    const yearly = all.map((i) => i.yearlyCents);
    expect(yearly).toEqual([...yearly].sort((a, b) => b - a));
    const ctx = createContext(txs, [checking], today);
    const current = inDays(ctx, toDayRange(running));
    expect(buildInsights({ ctx, range: running, current, totals: totalsOf(current.map((t) => t.flows)) })).toEqual(all.slice(0, OVERVIEW_INSIGHTS));
  });

  it("a dismissed insight returns only when its number moves 25 %", () => {
    const loan = monthly("2025-08", 20, 12, -25000, { merchant: "Autolaina", category: "loans" });
    const insight = insightsOf([...household(), ...loan])[0]!;
    const dismissedAt = (subject: string): UserInputs => ({ marks: [{ subject, mark: "dismissed", markedAt: "2026-10-01T10:00:00" }], expectedBills: [] });
    expect(insightDismissSubject(insight)).toBe(`alert:${insight.id}@300000`);
    expect(insightsOf([...household(), ...loan], running, dismissedAt(insightDismissSubject(insight)))).toEqual([]);
    expect(insightsOf([...household(), ...loan], running, dismissedAt(`alert:${insight.id}@260000`))).toEqual([]);
    expect(insightsOf([...household(), ...loan], running, dismissedAt(`alert:${insight.id}@200000`))).toHaveLength(1);
  });

  it("titles and details follow the style sheet", () => {
    expect(seen.length).toBeGreaterThan(10);
    for (const i of seen) {
      const words = i.title.split(/[\s ]+/).filter((w) => /\p{L}/u.test(w));
      expect(words.length, i.title).toBeLessThanOrEqual(8);
      expect(i.title, i.title).not.toMatch(/[?!]|\/kk|\/v\b|vs\./);
      // one sentence: a full stop only at the end (dates like 7.6.2026 have no space after their dots)
      expect(i.detail.trim(), i.detail).toMatch(/^[^\s].*\.$/);
      expect(i.detail.slice(0, -1), i.detail).not.toMatch(/[.!?]\s/);
      expect(`${i.title} ${i.detail}`, i.title).not.toMatch(/kannattaa|muista|tärkeää|riittävä|paljon|noin|normaali|keskiarvo|Voit /i);
      expect(i.yearlyCents).toBeGreaterThan(0);
      expect(i.rows?.length || i.link, i.id).toBeTruthy();
    }
  });
});

describe("what the review found", () => {
  const rent = household().filter((t) => t.merchant === "Vuokranantaja");
  const stopped = (list: Insight[]) => list.filter((i) => i.id.startsWith("stopped:")).map((i) => plain(i.title));

  it("stopped: a sync that lags is no stop", () => {
    // the last CSV import ran on 31.7.: every payment seems to stop there
    const lagging = household().filter((t) => t.bookingDate <= "2026-07-31");
    expect(stopped(insightsOf(lagging))).toEqual([]);
  });

  it("stopped: one account that stopped syncing is no stop", () => {
    const other: Account = { id: "acc-2", name: "Yhteinen tili", iban: null, currency: "EUR", type: "checking" };
    const stale = [...rent, ...monthly("2024-04", 20, 30, -4000, { merchant: "Lidl", category: "groceries" })].filter((t) => t.bookingDate <= "2026-07-31").map((t) => ({ ...t, accountId: other.id }));
    const txs = [...household().filter((t) => t.merchant !== "Vuokranantaja"), ...stale];
    const ctx = createContext(txs, [checking, other], today);
    const current = inDays(ctx, toDayRange(running));
    expect(stopped(rankInsights({ ctx, range: running, current, totals: totalsOf(current.map((t) => t.flows)) }))).toEqual([]);
  });

  it("stopped: a new provider in the same category is a switch", () => {
    const helen = monthly("2024-04", 12, 28, -6000, { merchant: "Helen", category: "utilities" });
    const oomi = monthly("2026-08", 14, 2, -5400, { merchant: "Oomi", category: "utilities" });
    expect(stopped(insightsOf([...household(), ...helen, ...oomi]))).toEqual([]);
    const ifInsurance = monthly("2024-04", 25, 27, -4500, { merchant: "If", category: "insurance" });
    const lahiTapiola = monthly("2026-07", 27, 3, -5200, { merchant: "LähiTapiola", category: "insurance" });
    expect(stopped(insightsOf([...household(), ...ifInsurance, ...lahiTapiola]))).toEqual([]);
    // without the new provider the stop is told
    expect(stopped(insightsOf([...household(), ...helen]))).toEqual(["Helen: 60 € kuussa vapautui"]);
  });
});

describe("what the review found: growth", () => {
  const growth = (list: Insight[]) => list.filter((i) => i.id === "spending-growth").map((i) => plain(i.title));

  it("flat purchases with a one-off income a year ago are no growth", () => {
    const refund = tx({ bookingDate: "2025-08-04", amountCents: 300000, merchant: "Verohallinto", category: "benefits" });
    expect(growth(insightsOf([...household(), refund]))).toEqual([]);
    const carSale = tx({ bookingDate: "2025-05-20", amountCents: 500000, merchant: "Matti Myyjä", category: "sales" });
    expect(growth(insightsOf([...household(), carSale]))).toEqual([]);
  });

  it("a one-off income this year does not hide purchases that grew", () => {
    const shops = ["Ravintola Savoy", "Zara", "Kahvila Ilo"];
    const more = Array.from({ length: 36 }, (_, k) =>
      tx({ bookingDate: `${addMonths("2026-04", Math.floor(k / 6))}-${String([3, 6, 14, 15, 24, 28][k % 6]).padStart(2, "0")}`, amountCents: -(4000 + ((k * 731) % 2000)), merchant: shops[k % 3]!, category: "restaurants" }),
    );
    const carSale = tx({ bookingDate: "2026-05-20", amountCents: 500000, merchant: "Matti Myyjä", category: "sales" });
    expect(growth(insightsOf([...household(), ...more, carSale]))).toEqual([expect.stringMatching(/^Ostokset \+\d+ % vuodessa, tulot ±0 %$/)]);
  });
});

describe("what the review found: debt share", () => {
  const debt = (list: Insight[]) => list.filter((i) => i.id === "debt").map((i) => plain(i.title));
  const mortgage = (months: number, from = "2024-04", amount = -60000) => monthly(from, 5, months, amount, { merchant: "Asuntolaina", category: "mortgage" });

  it("an early repayment is no debt service", () => {
    const early = tx({ bookingDate: "2026-08-14", amountCents: -800000, merchant: "Asuntolaina", category: "mortgage" });
    expect(debt(insightsOf([...household(), ...mortgage(30), early]))).toEqual([]);
  });

  it("needs six complete months", () => {
    const recent = household().filter((t) => t.bookingDate >= "2026-05-01");
    expect(debt(insightsOf([...recent, ...mortgage(6, "2026-05", -150000)]))).toEqual([]);
  });

  it("counts the loan instalments against usual income", () => {
    const list = keep(insightsOf([...household(), ...mortgage(30, "2024-04", -150000)]));
    const d = byId(list, "debt")!;
    expect(plain(d.title)).toBe("Velanhoitoon 43 % tuloista");
    expect(plain(d.detail)).toBe("Lainojen erät 1 500 € ja tavalliset tulot 3 500 € kuussa, huhti–syyskuu 2026.");
    expect(d.yearlyCents).toBe((150000 - 122500) * 12);
    expect(d.rows).toHaveLength(6);
  });
});

describe("what the review found: subscriptions", () => {
  it("a yearly subscription paid since 2024 is not new", () => {
    const netflix = monthly("2024-06", 3, 28, -1299, { merchant: "Netflix", category: "subscriptions" });
    const adobe = [tx({ bookingDate: "2024-11-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" }), tx({ bookingDate: "2025-11-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" })];
    const office = [tx({ bookingDate: "2025-01-15", amountCents: -9900, merchant: "Microsoft 365", category: "subscriptions" }), tx({ bookingDate: "2026-01-15", amountCents: -9900, merchant: "Microsoft 365", category: "subscriptions" })];
    const list = insightsOf([...household(), ...netflix, ...adobe, ...office]);
    expect(list.filter((i) => i.id === "subscriptions-added").map((i) => plain(i.title))).toEqual([]);
    // two new ones beside them: the year ago count holds the yearly ones too
    const added = [...monthly("2026-03", 4, 7, -1599, { merchant: "HBO Max", category: "subscriptions" }), ...monthly("2026-03", 6, 7, -1399, { merchant: "Disney+", category: "subscriptions" })];
    const a = byId(insightsOf([...household(), ...netflix, ...adobe, ...office, ...added]), "subscriptions-added")!;
    expect(plain(a.title)).toBe("Tilauksia 5, vuosi sitten 3: +30 € kuussa");
  });

  it("the year of new subscriptions is their own yearly cost: a quarterly one counts its four charges", () => {
    const quarterly = ["2026-02-10", "2026-05-10", "2026-08-10"].map((bookingDate) => tx({ bookingDate, amountCents: -3001, merchant: "Lehtitalo", category: "subscriptions" }));
    const added = [...quarterly, ...monthly("2026-03", 4, 7, -1599, { merchant: "HBO Max", category: "subscriptions" })];
    const a = byId(insightsOf([...household(), ...added]), "subscriptions-added")!;
    // 4 × 30,01 € and 12 × 15,99 €; a twelfth of the quarterly one rounded back to a year would be 120,00 €
    expect(a.yearlyCents).toBe(4 * 3001 + 12 * 1599);
  });
});

describe("what the review found: instalments", () => {
  it("a Klarna plan is told once, as instalments", () => {
    const klarna = monthly("2026-07", 28, 3, -4500, { merchant: "Klarna", category: "shopping" });
    expect(insightsOf([...household(), ...klarna]).map((i) => i.id)).toEqual(["instalments"]);
    // a second plan after the first is no price rise
    const plans = monthly("2026-01", 10, 9, (i) => (i < 6 ? -3000 : -4500), { merchant: "Walley", category: "shopping" });
    expect(insightsOf([...household(), ...plans]).map((i) => i.id)).toEqual(["instalments"]);
  });
});

describe("what the review found: materiality", () => {
  it("a finding about one charge has the catalogue gate of 10 € a month, not the household's 2 %", () => {
    // usual spending is about 1 270 € a month, so the household gate would be about 25 €: a new 18,99 € subscription
    // passes the item gate, a 5 € a month price rise (60 € a year) and a 119,88 € yearly renewal stay under it
    const storytel = monthly("2026-08", 5, 3, -1899, { merchant: "Storytel", category: "subscriptions" });
    const elisa = monthly("2025-10", 7, 12, (i) => (i < 8 ? -2990 : -3490), { merchant: "Elisa", category: "telecom" });
    const adobe = [tx({ bookingDate: "2024-10-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" }), tx({ bookingDate: "2025-10-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" })];
    expect(insightsOf([...household(), ...storytel, ...elisa, ...adobe]).map((i) => i.id)).toEqual([expect.stringMatching(/^new:.*Storytel$/)]);
  });
});

describe("what the review found: the overview", () => {
  it("a dismissal applies on the overview", () => {
    const loan = monthly("2025-08", 20, 12, -25000, { merchant: "Autolaina", category: "loans" });
    const ctx = createContext([...household(), ...loan], [checking], today);
    const shown = buildDashboard(ctx, running).insights;
    expect(shown.map((i) => i.id)).toEqual([expect.stringMatching(/^stopped:/)]);
    const inputs: UserInputs = { marks: [{ subject: insightDismissSubject(shown[0]!), mark: "dismissed", markedAt: "2026-10-01T10:00:00" }], expectedBills: [] };
    expect(buildDashboard(ctx, running, [], inputs).insights).toEqual([]);
  });
});

describe("what the life-event kit found", () => {
  const titles = (list: Insight[], prefix: string) => list.filter((i) => i.id.startsWith(prefix)).map((i) => plain(i.title));
  const noRent = () => household().filter((t) => t.merchant !== "Vuokranantaja");
  /** Month-to-month swings that add up to nothing: a household's months are never alike. */
  const SWING = [5, -7, 2, 9, -4, -9, 6, 0, -6, 8, -2, 4, -8, 3, 7, -5, 1, -3, 9, -6, 2, -9, 5, 0, 4, -2, -7, 6, 1, -3];
  /** `count(i)` purchases in the i-th month from April 2024, each of `cents`. */
  const visits = (merchant: string, category: string, cents: number, count: (i: number) => number) =>
    SWING.flatMap((_, i) => Array.from({ length: count(i) }, (_, k) => tx({ bookingDate: `${addMonths("2024-04", i)}-${String(1 + (k % 28)).padStart(2, "0")}`, amountCents: -cents, merchant, category })));

  it("a step over 30 % on a phone bill is a new plan or line, no price rise", () => {
    const line = monthly("2025-10", 7, 12, (i) => (i < 8 ? -3990 : -6990), { merchant: "Elisa", category: "telecom" });
    expect(titles(insightsOf([...household(), ...line]), "price")).toEqual([]);
  });

  it("a rent step over 10 % is a move or a new contract; a smaller one is a rise", () => {
    const rent = (to: number) => monthly("2024-04", 2, 30, (i) => (i < 24 ? -90000 : -to), { merchant: "Vuokranantaja", category: "housing" });
    expect(titles(insightsOf([...noRent(), ...rent(100000)]), "price")).toEqual([]);
    expect(titles(insightsOf([...noRent(), ...rent(94500)]), "price")).toEqual(["Vuokranantaja: hinta nousi 540 € vuodessa"]);
  });

  it("a municipal day-care fee follows income and hours: no price rise; a private one's is", () => {
    const fee = (merchant: string) => monthly("2024-04", 8, 30, (i) => (i < 28 ? -27990 : -33500), { merchant, category: "kids" });
    expect(titles(insightsOf([...household(), ...fee("Helsingin Kaupunki")]), "price")).toEqual([]);
    expect(titles(insightsOf([...household(), ...fee("Touhula Oy")]), "price")).toEqual(["Touhula Oy: hinta nousi 661 € vuodessa"]);
  });

  it("a monthly fee that became one yearly payment is a new cadence, no stop", () => {
    const paper = monthly("2024-04", 18, 27, -3290, { merchant: "Sanoma", category: "subscriptions" });
    const year = tx({ bookingDate: "2026-07-18", amountCents: -32900, merchant: "Sanoma", category: "subscriptions" });
    expect(titles(insightsOf([...household(), ...paper, year]), "stopped")).toEqual([]);
    expect(titles(insightsOf([...household(), ...paper]), "stopped")).toEqual(["Sanoma: 33 € kuussa vapautui"]);
  });

  it("hit: a vastike or a storage unit up 13 to 15 % is a price rise; only rent steps over 10 % are a move", () => {
    const vastike = monthly("2024-04", 3, 30, (i) => (i < 24 ? -30000 : -33900), { merchant: "As Oy Kotikallio", description: "HOITOVASTIKE", category: "housing" });
    expect(titles(insightsOf([...household(), ...vastike]), "price")).toEqual(["As Oy Kotikallio: hinta nousi 468 € vuodessa"]);
    const storage = monthly("2024-04", 4, 30, (i) => (i < 24 ? -10000 : -11500), { merchant: "Pelican Self Storage", description: "VARASTON VUOKRA", category: "housing" });
    expect(titles(insightsOf([...household(), ...storage]), "price")).toEqual(["Pelican Self Storage: hinta nousi 180 € vuodessa"]);
  });

  it("hit: a large last payment on a loan pays it off, so the loan ended", () => {
    const loan = monthly("2025-08", 20, 12, (i) => (i < 11 ? -30000 : -300000), { merchant: "Autolaina", category: "loans" });
    expect(titles(insightsOf([...household(), ...loan]), "stopped")).toEqual(["Autolaina: 300 € kuussa vapautui"]);
  });

  it("hit: a December 1 250 € dearer two years running is a season beside a one-off in August", () => {
    const cafe = visits("Kahvila", "restaurants", 2000, (i) => 20 + SWING[i]!);
    const december = (year: number) => [3, 7, 11, 15, 18, 21].map((d) => tx({ bookingDate: `${year}-12-${String(d).padStart(2, "0")}`, amountCents: -20800, merchant: "Stockmann", category: "shopping" }));
    const sofa = tx({ bookingDate: "2025-08-12", amountCents: -150000, merchant: "Asko", category: "home" });
    expect(titles(insightsOf([...household(), ...cafe, ...december(2024), ...december(2025), sofa]), "seasons")).toEqual([expect.stringMatching(/^Joulukuu 1 \d{3} € tavallista kalliimpi kahtena vuonna$/)]);
  });

  it("grocery visits on a card that stopped syncing are not compared", () => {
    const card: Account = { id: "acc-2", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
    const shop = visits("K-Market", "groceries", 4000, () => 10).map((t) => ({ ...t, accountId: card.id }));
    const fee = monthly("2024-04", 28, 30, -300, { merchant: "Nordea", category: "fees", accountId: card.id });
    const spare: Account = { id: "acc-3", name: "Toinen kortti", iban: null, currency: "EUR", type: "credit_card" };
    const sometimes = ["2025-02-14", "2026-05-14"].map((date) => tx({ bookingDate: date, amountCents: -3500, merchant: "Alepa", category: "groceries", accountId: spare.id }));
    const groceries = (txs: Transaction[]) => {
      const ctx = createContext(txs, [checking, card, spare], today);
      const current = inDays(ctx, toDayRange(running));
      return titles(rankInsights({ ctx, range: running, current, totals: totalsOf(current.map((t) => t.flows)) }), "spending-groceries");
    };
    // the card's rows end in July: August and September are missing data
    expect(groceries([...household(), ...[...shop, ...fee].filter((t) => t.bookingDate < "2026-08-01")])).toEqual([]);
    // the card kept syncing its fee, so the months without visits count; a card used now and then has quiet months
    expect(groceries([...household(), ...shop.filter((t) => t.bookingDate < "2026-08-01"), ...fee, ...sometimes])).toEqual(["Ruokakaupassa käyntejä 12 % vähemmän"]);
  });

  it("grocery visits up 2 a month in a year whose months swing by more are noise; up 8 they are told", () => {
    const more = (extra: number) => visits("K-Market", "groceries", 4000, (i) => 16 + Math.round(SWING[i]! / 2) + (i >= 18 ? extra : 0));
    expect(titles(insightsOf([...household(), ...more(2)]), "spending-groceries")).toEqual([]);
    expect(titles(insightsOf([...household(), ...more(8)]), "spending-groceries")).toEqual([expect.stringMatching(/^Ruokakaupassa käyntejä \d+ % enemmän$/)]);
  });

  it("purchases three standard errors up are noise", () => {
    const cafe = visits("Kahvila", "restaurants", 2000, (i) => 20 + SWING[i]! + (i >= 18 ? 9 : 0));
    expect(titles(insightsOf([...household(), ...cafe]), "spending-growth")).toEqual([]);
  });

  it("a December as dear as the household's other busy months is no season", () => {
    const busy = ["2024-06", "2024-09", "2025-03", "2025-05", "2025-08", "2026-02", "2026-05"].flatMap((m) => [4, 11, 18, 25].map((d) => tx({ bookingDate: `${m}-${String(d).padStart(2, "0")}`, amountCents: -20000, merchant: "Verkkokauppa", category: "home" })));
    const december = (year: number) => [3, 9, 15, 21].map((d) => tx({ bookingDate: `${year}-12-${String(d).padStart(2, "0")}`, amountCents: -9000, merchant: "Stockmann", category: "shopping" }));
    expect(titles(insightsOf([...household(), ...busy, ...december(2024), ...december(2025)]), "seasons")).toEqual([]);
  });
});

describe("insights on random households", () => {
  it("stay quiet on 50 seeded histories without the patterns", () => {
    const loud: string[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 600);
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, "2025-11-15");
      for (const range of [{ from: "2025-11-01", to: "2025-11-15" }, { from: "2025-06-01", to: "2025-08-31" }]) {
        const current = inDays(ctx, toDayRange(range));
        for (const i of rankInsights({ ctx, range, current, totals: totalsOf(current.map((t) => t.flows)) })) loud.push(`${seed} ${i.id}: ${plain(i.title)}`);
      }
    }
    expect(loud).toEqual([]);
  }, 30_000);

  it("stay quiet on 50 settled households of 30 months, every gate reached", () => {
    const loud: string[] = [];
    const reached = new Map<string, number>();
    const reach = (gate: string, ok: boolean) => ok && reached.set(gate, (reached.get(gate) ?? 0) + 1);
    const judged = "2025-11-15";
    for (let seed = 1; seed <= 50; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 1500, { months: 30, settled: true });
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, judged);
      // what each source checks before it judges anything
      const twelve = lastCompleteMonths(ctx, judged, 12);
      const series = ctx.recurring;
      reach("two years of complete months (growth, seasons)", twelve.length === 12 && isCompleteMonth(ctx, shiftMonth(twelve[0]!, -12)));
      reach("440 days (subscriptions a year ago)", historyCovers(ctx, addDays(judged, -440)));
      reach("a year and a half (fixed costs share)", historyCovers(ctx, addDays(judged, -548)));
      reach("six complete months and a loan series (debt share)", twelve.length >= 6 && series.some((s) => s.active && s.category === "mortgage"));
      reach("an ended series of six payments (stopped)", series.some((s) => !s.active && s.occurrences >= 6 && s.kind !== "habit"));
      reach("a yearly subscription (renewals, subscriptions)", series.some((s) => s.cadence === "yearly"));
      reach("lender rows in half a year (instalments)", ctx.txs.some((t) => /Klarna|Walley/.test(t.merchant) && t.bookingDate >= addDays(judged, -183)));
      reach("a year of fixed charges (price rises)", series.some((s) => s.active && s.kind === "subscription" && s.occurrences >= 12));
      for (const range of [{ from: "2025-11-01", to: judged }, { from: "2025-06-01", to: "2025-08-31" }]) {
        const current = inDays(ctx, toDayRange(range));
        for (const i of rankInsights({ ctx, range, current, totals: totalsOf(current.map((t) => t.flows)) })) loud.push(`${seed} ${i.id}: ${plain(i.title)}`);
      }
    }
    expect(loud).toEqual([]);
    expect(Object.fromEntries(reached)).toEqual({
      "two years of complete months (growth, seasons)": 50,
      "440 days (subscriptions a year ago)": 50,
      "a year and a half (fixed costs share)": 50,
      "six complete months and a loan series (debt share)": 50,
      "an ended series of six payments (stopped)": 50,
      "a yearly subscription (renewals, subscriptions)": 50,
      "lender rows in half a year (instalments)": 50,
      "a year of fixed charges (price rises)": 50,
    });
  }, 30_000);
});
