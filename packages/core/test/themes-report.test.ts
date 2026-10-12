/**
 * What goes where (analysis/themes-report.ts): the themes of the last twelve complete months as one answer. The window
 * is complete months that every account with spending in it covers from their first day and every paying account has
 * rows in, a year's figure exists for twelve months only, a large purchase stands apart from the themes, and the
 * themes and the large purchases add up to the spending of the window to the cent, for every fixture household as it
 * sees its rows and with every account cut to a half.
 */
import { describe, expect, it } from "vitest";
import { goldenHouseholds } from "../../../tools/findings/golden.ts";
import { applyUse } from "../src/account-use.ts";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { largePurchases } from "../src/analysis/large.ts";
import { type ThemesReport, themesReport } from "../src/analysis/themes-report.ts";
import { addMonths, dateIn, monthEnd, monthIndex } from "../src/dates.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import type { Account, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { EVENTS, kitHousehold } from "./kit/index.ts";
import { enrich } from "./optimise/household.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
/** The 10th of November: October 2026 is the last complete month. */
const TODAY = "2026-11-10";
const LAST = "2026-10";
const HALF: Part = { from: 0, to: 1, of: 2 };

const INSURER = "Esimerkkivakuutus Oy";
const CLOTHES = "Esimerkkivaate Oy";
const FURNITURE = "Esimerkkikaluste Oy";

const cents = (euros: number) => Math.round(euros * 100);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const paid = (bookingDate: string, euros: number, merchant: string, category: string, more: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: -cents(euros), merchant, category, categorySource: "rule", ...more });
const got = (bookingDate: string, euros: number, merchant: string, category: string, more: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: cents(euros), merchant, category, categorySource: "rule", ...more });

/** How many months there are from `first` to the last complete one, both included. */
const monthsFrom = (first: string) => monthIndex(LAST) - monthIndex(first) + 1;

/** One payment on `day` of each of `count` months from `first` on. */
const monthly = (first: string, count: number, day: number, euros: number, merchant: string, category: string, more: Partial<Transaction> = {}) =>
  Array.from({ length: count }, (_, i) => paid(dateIn(addMonths(first, i), day), euros, merchant, category, more));

/** Rent of 450 € on the 2nd of every month from `first` to the running month: the history covers each month from its start. */
const rent = (first: string) => monthly(first, monthsFrom(first) + 1, 2, 450, "Asunto Oy Esimerkki", "housing");
/** A purchase on the card on the 3rd of each of `count` months from `first` on: rows from the 3rd cover their first month. */
const onCard = (first: string, count: number) => monthly(first, count, 3, 40, "Esimerkkikauppa Oy", "groceries", { accountId: card.id });
const fuel = (first: string, count: number) => monthly(first, count, 15, 60, "Neste Vantaa", "car");

/** A household that has paid rent from `first` on, with `more` rows. */
const household = (first: string, more: readonly Transaction[] = []) => createContext([...rent(first), ...more], [checking, card], TODAY);
const answer = (first: string, more: readonly Transaction[] = []) => themesReport(household(first, more))!;

const theme = (r: ThemesReport, id: string) => r.themes.find((t) => t.id === id);
const line = (r: ThemesReport, id: string, lineId: string) => theme(r, id)?.lines.find((l) => l.id === lineId);
/** Each theme's change, by its id. */
const changes = (r: ThemesReport) => Object.fromEntries(r.themes.map((t) => [t.id, t.changePct]));

describe("the window", () => {
  it("is null under three complete months, and three give an answer", () => {
    expect(themesReport(household("2026-09"))).toBeNull();
    // the history starts on the 10th: August is not covered from its start
    expect(themesReport(createContext(rent("2026-08").map((t) => ({ ...t, bookingDate: `${t.bookingDate.slice(0, 8)}10` })), [checking], TODAY))).toBeNull();
    expect(answer("2026-08")).toEqual({
      window: { first: "2026-08", last: "2026-10", months: 3 },
      themes: [{ id: "housing", heading: "Asuminen", monthlyCents: 45_000, yearCents: null, changePct: null, lines: [{ id: "housing", heading: "Vuokra ja vastike", monthlyCents: 45_000, yearCents: null, changePct: null }] }],
      totalCents: 135_000,
      totalMonthlyCents: 45_000,
      totalYearCents: null,
      large: { cents: 0, count: 0, rows: [] },
      spendingCents: 135_000,
    });
  });

  it("of eleven months has a figure a month over eleven and none for the year", () => {
    const r = answer("2025-12", [...monthly("2025-12", 11, 5, 301.07, "Esimerkkikauppa Oy", "groceries"), paid("2026-06-14", 25.5, "Ravintola Esimerkki", "restaurants")]);
    expect(r.window).toEqual({ first: "2025-12", last: "2026-10", months: 11 });
    // 3 337,27 € over eleven months is 303,388 a month
    expect(theme(r, "food")).toMatchObject({ monthlyCents: 30_339, yearCents: null, changePct: null });
    expect(theme(r, "food")!.lines.map((l) => [l.id, l.monthlyCents, l.yearCents])).toEqual([
      ["groceries", 30_107, null],
      ["restaurants", 232, null],
    ]);
    expect(r).toMatchObject({ totalCents: 495_000 + 333_727, totalMonthlyCents: 45_000 + 30_339, totalYearCents: null });
  });

  it("of twelve months has the year, and the month is the year divided by twelve to the cent", () => {
    // the rows of October 2025 and of the running month are outside the window
    const r = answer("2025-10", [
      ...monthly("2025-10", 14, 5, 301.07, "Esimerkkikauppa Oy", "groceries"),
      paid("2026-06-14", 25.5, "Ravintola Esimerkki", "restaurants"),
      got("2026-06-25", 3000, "ESIMERKKI OY", "salary"),
    ]);
    expect(r.window).toEqual({ first: "2025-11", last: "2026-10", months: 12 });
    expect(r.themes.map((t) => [t.id, t.monthlyCents, t.yearCents])).toEqual([
      ["housing", 45_000, 540_000],
      // 3 638,34 € a year is 303,195 a month
      ["food", 30_320, 363_834],
    ]);
    for (const t of r.themes) expect(t.monthlyCents, t.id).toBe(Math.round(t.yearCents! / 12));
    expect(r).toMatchObject({ totalCents: 903_834, totalMonthlyCents: 75_320, totalYearCents: 903_834, spendingCents: 903_834 });
  });

  it("lists the themes by their sum, and one with more money back than spending last with its minus", () => {
    // the purchase is before the window and its money back inside
    const r = answer("2025-10", [...monthly("2025-11", 12, 5, 300, "Esimerkkikauppa Oy", "groceries"), paid("2025-10-20", 200, CLOTHES, "shopping"), got("2025-11-05", 200, CLOTHES, "shopping")]);
    expect(r.themes.map((t) => [t.id, t.yearCents, t.monthlyCents])).toEqual([
      ["housing", 540_000, 45_000],
      ["food", 360_000, 30_000],
      ["shopping", -20_000, -1_667],
    ]);
    expect(line(r, "shopping", "shopping")).toMatchObject({ yearCents: -20_000, monthlyCents: -1_667 });
    expect(r.totalCents).toBe(880_000);
    expect(r.spendingCents).toBe(880_000);
  });

  it("leaves out a theme and a line that money back brought to nothing, and a few cents of money back are 0 a month", () => {
    const r = answer("2025-10", [
      ...monthly("2025-11", 12, 5, 300, "Esimerkkikauppa Oy", "groceries"),
      // bought and returned whole inside the window
      paid("2026-03-03", 60, "Esimerkkikirja Oy", "education"),
      got("2026-03-20", 60, "Esimerkkikirja Oy", "education"),
      paid("2026-04-03", 35, "Ravintola Esimerkki", "restaurants"),
      got("2026-04-10", 35, "Ravintola Esimerkki", "restaurants"),
      // five cents back for a fee paid before the window
      paid("2025-10-21", 0.05, "Esimerkkipankki Oyj", "fees"),
      got("2025-11-06", 0.05, "Esimerkkipankki Oyj", "fees"),
    ]);
    expect(r.themes.map((t) => [t.id, t.yearCents, t.lines.map((l) => l.id)])).toEqual([
      ["housing", 540_000, ["housing"]],
      ["food", 360_000, ["groceries"]],
      ["taxes", -5, ["fees"]],
    ]);
    // not minus zero
    expect(theme(r, "taxes")!.monthlyCents).toBe(0);
    expect(line(r, "taxes", "fees")!.monthlyCents).toBe(0);
    expect(r).toMatchObject({ totalCents: 899_995, spendingCents: 899_995, totalMonthlyCents: 75_000 });
  });

  it("is the same answer in the dashboard, whatever the period", () => {
    const ctx = household("2025-10", fuel("2025-11", 7));
    const r = themesReport(ctx);
    expect(r).not.toBeNull();
    expect(buildDashboard(ctx, { from: "2026-11-01", to: "2026-11-30" }).themes).toEqual(r);
    expect(buildDashboard(ctx, { from: "2026-03-01", to: "2026-03-31" }).themes).toEqual(r);
    expect(buildDashboard(household("2026-09"), { from: "2026-11-01", to: "2026-11-30" }).themes).toBeNull();
  });
});

describe("a theme's lines", () => {
  it("add up to the theme a month too: its cents are shared out among them", () => {
    // 10 € a year is 0,83 a month on each line, and the theme's 30 € is 2,50
    const r = answer("2025-11", [paid("2026-02-03", 10, "Esimerkkikauppa Oy", "groceries"), paid("2026-02-04", 10, "Ravintola Esimerkki", "restaurants"), paid("2026-02-05", 10, "Esimerkkikuljetus Oy", "food_delivery")]);
    expect(theme(r, "food")).toMatchObject({ monthlyCents: 250, yearCents: 3_000 });
    expect(theme(r, "food")!.lines.map((l) => [l.heading, l.monthlyCents, l.yearCents])).toEqual([
      ["Ruokakauppa", 84, 1_000],
      ["Ravintolat ja kahvilat", 83, 1_000],
      ["Ruoan kotiinkuljetus", 83, 1_000],
    ]);
  });
});

describe("the paying accounts cover the window", () => {
  const all = (r: ThemesReport) => [r.window.first, r.window.last, r.window.months];

  it("a card that pays in half the months has no rows after them: the window is those months", () => {
    const r = answer("2025-11", onCard("2025-11", 6));
    expect(all(r)).toEqual(["2025-11", "2026-04", 6]);
    expect(r).toMatchObject({ spendingCents: 6 * 49_000, totalYearCents: null });
    expect(theme(r, "housing")).toMatchObject({ monthlyCents: 45_000, yearCents: null });
  });

  it("a card used in five months of twelve pays now and then: the window stays whole", () => {
    const r = answer("2025-11", onCard("2025-11", 5));
    expect(all(r)).toEqual(["2025-11", "2026-10", 12]);
    expect(r.spendingCents).toBe(540_000 + 5 * 4_000);
  });

  it("a month without a row of any kind on a paying card cuts the window to the months after it", () => {
    const gap = [...onCard("2025-11", 5), ...onCard("2026-05", 6)];
    expect(all(answer("2025-11", gap))).toEqual(["2026-05", "2026-10", 6]);
    // money moved to the card in April is a row: the card was read that month
    const moved = tx({ accountId: card.id, bookingDate: "2026-04-20", amountCents: 5_000, category: "transfer", categorySource: "transfer", isTransfer: true });
    expect(all(answer("2025-11", [...gap, moved]))).toEqual(["2025-11", "2026-10", 12]);
  });

  it("is the newest run of three months or more, also when that ends before the last complete month", () => {
    // the card stopped after July
    expect(all(answer("2025-11", onCard("2025-11", 9)))).toEqual(["2025-11", "2026-07", 9]);
    // August is missing: the two months after it are too few, the nine before it are the window
    expect(all(answer("2025-11", [...onCard("2025-11", 9), ...onCard("2026-09", 2)]))).toEqual(["2025-11", "2026-07", 9]);
    // July is missing: the three months after it are enough
    expect(all(answer("2025-11", [...onCard("2025-11", 8), ...onCard("2026-08", 3)]))).toEqual(["2026-08", "2026-10", 3]);
    // every second month is missing: no run is three months long
    expect(themesReport(household("2025-11", [0, 2, 4, 6, 8, 10].flatMap((i) => onCard(addMonths("2025-11", i), 1))))).toBeNull();
  });
});

describe("an account whose rows begin inside the window", () => {
  const all = (r: ThemesReport) => [r.window.first, r.window.last, r.window.months];
  // Food for 400 € a month from the account and 400 € a month with the card, in both years: nothing changed.
  // The card was connected later: its rows begin `n` months before the running month, on `day`.
  const food = (n: number, day = 3) => [
    ...monthly("2024-11", 24, 9, 400, "Esimerkkikauppa Oy", "groceries"),
    ...monthly(addMonths(LAST, -(n - 1)), n, day, 400, "Esimerkkikauppa Oy", "groceries", { accountId: card.id }),
  ];

  it("five months ago: the window is the five months the card covers, with no year and no change", () => {
    const r = answer("2024-11", food(5));
    expect(all(r)).toEqual(["2026-06", "2026-10", 5]);
    expect(theme(r, "food")).toMatchObject({ monthlyCents: 80_000, yearCents: null, changePct: null });
    expect(r.totalYearCents).toBeNull();
  });

  it("two months ago: under three months there is no answer", () => {
    expect(themesReport(household("2024-11", food(2)))).toBeNull();
    expect(all(answer("2024-11", food(3)))).toEqual(["2026-08", "2026-10", 3]);
  });

  it("seven months ago, and a card used now and then: the months from its first row on", () => {
    expect(theme(answer("2024-11", food(7)), "food")).toMatchObject({ monthlyCents: 80_000, yearCents: null, changePct: null });
    // three purchases in the year, the first in January: no payer by any count of months, and its rows begin inside the year
    const r = answer("2025-11", [2, 6, 10].flatMap((i) => onCard(addMonths("2025-11", i), 1)));
    expect(all(r)).toEqual(["2026-01", "2026-10", 10]);
    expect(r.spendingCents).toBe(10 * 45_000 + 3 * 4_000);
  });

  it("twelve months ago: a year, and no change against a year the card is not in", () => {
    const r = answer("2024-11", food(12));
    expect(all(r)).toEqual(["2025-11", "2026-10", 12]);
    expect(theme(r, "food")).toMatchObject({ monthlyCents: 80_000, yearCents: 960_000, changePct: null });
    // with the card in both years the same food is no change either, and a rise in it is one
    expect(changes(answer("2024-11", food(24)))).toEqual({ food: null, housing: null });
    const rise = answer("2024-11", [...food(24), ...monthly("2025-11", 12, 12, 100, "Esimerkkikauppa Oy", "groceries", { accountId: card.id })]);
    expect(changes(rise)).toEqual({ food: 13, housing: null });
  });

  it("a month the card covers only in part is not in the window: its rows begin on the 20th", () => {
    // 100 € of food with the card on the 6th, 13th, 20th and 27th of every month; the card's history begins on 20.4.2026
    const weeks = Array.from({ length: 7 }, (_, i) => addMonths("2026-04", i)).flatMap((m) => [6, 13, 20, 27].map((d) => paid(dateIn(m, d), 100, "Esimerkkikauppa Oy", "groceries", { accountId: card.id })));
    const r = answer("2025-11", weeks.filter((t) => t.bookingDate >= "2026-04-20"));
    expect(all(r)).toEqual(["2026-05", "2026-10", 6]);
    // every month the card covers whole has 400 € of food
    expect(theme(r, "food")!.monthlyCents).toBe(40_000);
  });

  it("every account has the three days of slack: rows from the 4th cover their month, rows from the 5th the next", () => {
    expect(all(answer("2024-11", food(7, 4)))).toEqual(["2026-04", "2026-10", 7]);
    expect(all(answer("2024-11", food(7, 5)))).toEqual(["2026-05", "2026-10", 6]);
  });

  it("a card that took over from one that ended: the window is the new card's months, not the old card's", () => {
    const second: Account = { id: "card-2", name: "Uusi luottokortti", iban: null, currency: "EUR", type: "credit_card" };
    const taken = monthly("2026-06", 5, 3, 40, "Esimerkkikauppa Oy", "groceries", { accountId: second.id });
    const r = themesReport(createContext([...rent("2025-11"), ...onCard("2025-11", 7), ...taken], [checking, card, second], TODAY))!;
    // the old card has no spending in the months left, so its silence is no missing data in them
    expect(all(r)).toEqual(["2026-06", "2026-10", 5]);
    expect(theme(r, "food")!.monthlyCents).toBe(4_000);
  });
});

describe("another account of its kind at the same bank has older rows", () => {
  const all = (r: ThemesReport) => [r.window.first, r.window.last, r.window.months];
  const BANK = "Esimerkkipankki";
  const account: Account = { ...checking, bank: BANK };
  const old: Account = { ...card, bank: BANK };
  const second: Account = { id: "card-2", name: "Toinen luottokortti", iban: null, currency: "EUR", type: "credit_card", bank: BANK };
  const savings: Account = { id: "sav-1", name: "Säästötili", iban: null, currency: "EUR", type: "savings", bank: BANK };
  const report = (rows: readonly Transaction[], accounts: readonly Account[]) => themesReport(createContext(rows, accounts, TODAY))!;
  const food = (first: string, count: number, day: number, euros: number, accountId: string) => monthly(first, count, day, euros, "Esimerkkikauppa Oy", "groceries", { accountId });

  // Food for 400 € a month from the account and 40 € with the first card in both years; a second card of the bank is
  // first used in January 2026 and pays 100 € a month from then on.
  const twoCards = [...rent("2024-11"), ...food("2024-11", 24, 9, 400, account.id), ...onCard("2024-11", 24), ...food("2026-01", 10, 3, 100, second.id)];

  it("a second card of the bank, first used in January, narrows nothing and takes no change away", () => {
    const r = report(twoCards, [account, old, second]);
    expect(all(r)).toEqual(["2025-11", "2026-10", 12]);
    expect(theme(r, "food")).toMatchObject({ yearCents: 528_000 + 100_000, changePct: 19 });
    expect(changes(r)).toEqual({ food: 19, housing: null });
  });

  it("an account without a bank is never vouched for and vouches for nobody, and another bank's card does neither", () => {
    const without = ({ bank: _, ...a }: Account): Account => a;
    for (const accounts of [
      [account, old, without(second)],
      [account, old, { ...second, bank: null }],
      [account, without(old), second],
      [account, { ...old, bank: null }, { ...second, bank: null }],
      [account, without(old), without(second)],
      [account, old, { ...second, bank: "Toinen Esimerkkipankki" }],
    ]) {
      const r = report(twoCards, accounts);
      expect(all(r), JSON.stringify(accounts.map((a) => a.bank))).toEqual(["2026-01", "2026-10", 10]);
      expect(Object.values(changes(r)).every((c) => c === null)).toBe(true);
    }
  });

  it("a new savings account at the bank of the current account narrows nothing", () => {
    const rows = [...rent("2025-11"), ...monthly("2026-06", 5, 15, 50, CLOTHES, "shopping", { accountId: savings.id })];
    const r = report(rows, [account, savings]);
    expect(all(r)).toEqual(["2025-11", "2026-10", 12]);
    expect(r.spendingCents).toBe(540_000 + 25_000);
    // without the bank on it the first row decides, and a month it begins inside is out
    expect(all(report(rows, [account, { ...savings, bank: null }]))).toEqual(["2026-07", "2026-10", 4]);
  });

  it("a card is vouched for by a card only: one with rows from five months ago still narrows, whatever the bank's accounts hold", () => {
    // the account and a savings account of the same bank reach back two years; no other card of the bank does
    const rows = [...rent("2024-11"), ...food("2024-11", 24, 9, 400, account.id), ...food("2024-11", 24, 20, 10, savings.id), ...food("2026-06", 5, 3, 400, old.id)];
    const r = report(rows, [account, savings, old]);
    expect(all(r)).toEqual(["2026-06", "2026-10", 5]);
    expect(theme(r, "food")).toMatchObject({ monthlyCents: 81_000, yearCents: null, changePct: null });
    // and a card vouches for no account: a current account opened in June with an old card of its bank
    const opened: Account = { id: "acc-2", name: "Toinen tili", iban: null, currency: "EUR", type: "checking", bank: BANK };
    const late = [...rent("2024-11"), ...onCard("2024-11", 24), ...food("2026-06", 5, 3, 400, opened.id)];
    expect(all(report(late, [{ ...checking, bank: "Toinen Esimerkkipankki" }, old, opened]))).toEqual(["2026-06", "2026-10", 5]);
    // a loan vouches for nothing either
    expect(all(report(late, [{ ...checking, type: "loan", bank: BANK }, old, opened]))).toEqual(["2026-06", "2026-10", 5]);
  });

  it("the older row is a whole month before the first row or more, and the history reaches as far back as it", () => {
    // the first card has one row and no spending: money moved to it
    const moved = (bookingDate: string) => tx({ accountId: old.id, bookingDate, amountCents: 5_000, category: "transfer", categorySource: "transfer", isTransfer: true });
    const rows = [...rent("2025-11"), ...food("2026-06", 5, 3, 400, second.id)];
    // on 3.5. for a first row on 3.6.: the second card was in the data from May on
    expect(all(report([...rows, moved("2026-05-03")], [account, old, second]))).toEqual(["2026-05", "2026-10", 6]);
    // on 4.5.: under a month, and the first row decides
    expect(all(report([...rows, moved("2026-05-04")], [account, old, second]))).toEqual(["2026-06", "2026-10", 5]);
  });
});

describe("the change against the year before", () => {
  /** Two years of rows, each of 250 € or less. `from` is the first month kept: 0 is November 2024. */
  function twoYears(from = 0): Transaction[] {
    const rows: Transaction[] = [];
    for (let i = from; i < 24; i++) {
      const month = addMonths("2024-11", i);
      const later = i >= 12;
      const pay = (day: number, euros: number, merchant: string, category: string) => rows.push(paid(dateIn(month, day), euros, merchant, category));
      // Ostokset: 1 000 € a month, then 1 020: at the gate of 2 %
      for (const day of [5, 12, 19, 26]) pay(day, 250, CLOTHES, "shopping");
      if (later) pay(27, 20, CLOTHES, "shopping");
      // Terveys: 1 000 € a month, then 1 019,99: a cent under 2 %
      for (const day of [6, 13, 20, 27]) pay(day, 250, "Esimerkkiapteekki", "health");
      if (later) pay(28, 19.99, "Esimerkkiapteekki", "health");
      // Lapset: 100 € a month, then 110: at the floor of 10 € a month. Lemmikit: a cent under it
      pay(7, later ? 110 : 100, "Esimerkkipäiväkoti", "kids");
      pay(8, later ? 109.99 : 100, "Esimerkkieläin Oy", "pets");
      // Ruoka: 400 € a month, then 340
      pay(9, later ? 170 : 200, "Esimerkkikauppa Oy", "groceries");
      pay(10, later ? 170 : 200, "Ravintola Esimerkki", "restaurants");
      // Liikkuminen: only in the later year. Viestintä: the same in both
      if (later) pay(11, 50, "Esimerkkiliikenne Oy", "transport");
      pay(14, 30, "Esimerkkioperaattori Oy", "telecom");
    }
    return rows;
  }
  const first = (from: number) => addMonths("2024-11", from);

  it("is a number from the gate on, with its sign, and null under it: never 0", () => {
    const r = answer(first(0), twoYears());
    expect(r.window).toEqual({ first: "2025-11", last: "2026-10", months: 12 });
    expect(changes(r)).toEqual({ shopping: 2, health: null, housing: null, food: -15, kids: 10, pets: null, transport: null, media: null });
    // a line has the gate of its own level
    expect(theme(r, "food")!.lines.map((l) => [l.id, l.changePct])).toEqual([
      ["groceries", -15],
      ["restaurants", -15],
    ]);
    expect(line(r, "shopping", "shopping")!.changePct).toBe(2);
  });

  it("is null with 23 complete months", () => {
    const r = answer(first(1), twoYears(1));
    expect(r.window.months).toBe(12);
    expect(Object.values(changes(r)).every((c) => c === null)).toBe(true);
    expect(r.themes.flatMap((t) => t.lines).every((l) => l.changePct === null)).toBe(true);
  });

  it("is null when a paying card has no rows in a month of the year before", () => {
    const cardRows = onCard("2024-11", 24);
    expect(changes(answer(first(0), [...twoYears(), ...cardRows]))).toMatchObject({ shopping: 2, kids: 10 });
    const r = answer(first(0), [...twoYears(), ...cardRows.filter((t) => !t.bookingDate.startsWith("2025-03"))]);
    expect(r.window.months).toBe(12);
    expect(Object.values(changes(r)).every((c) => c === null)).toBe(true);
    // no rows in a month of the window itself: it is under a year, and a part of a year is compared with nothing
    const cut = answer(first(0), [...twoYears(), ...cardRows.filter((t) => !t.bookingDate.startsWith("2026-02"))]);
    expect(cut.window).toEqual({ first: "2026-03", last: "2026-10", months: 8 });
    expect(Object.values(changes(cut)).every((c) => c === null)).toBe(true);
  });

  it("is null when an account with spending in either year has its first row inside the year before", () => {
    // a card used every third month pays in under half the months of either year
    const nowAndThen = (months: readonly number[]) => months.flatMap((i) => onCard(addMonths("2024-11", i), 1));
    expect(changes(answer(first(0), [...twoYears(), ...nowAndThen([0, 4, 7, 10, 13, 16, 19, 22])]))).toMatchObject({ shopping: 2, kids: 10 });
    for (const months of [[4, 7, 10, 13, 16, 19, 22], [4, 7, 10]]) {
      const r = answer(first(0), [...twoYears(), ...nowAndThen(months)]);
      expect(r.window.months, String(months)).toBe(12);
      expect(Object.values(changes(r)).every((c) => c === null), String(months)).toBe(true);
      expect(r.themes.flatMap((t) => t.lines).every((l) => l.changePct === null), String(months)).toBe(true);
    }
  });

  it("places the year before as the window is placed: Auto is compared with the car's rows of that year", () => {
    // the car's insurance in both years, fuel on the account only in the later one
    const r = answer("2024-11", [...monthly("2024-11", 24, 4, 100, INSURER, "insurance", { description: "LIIKENNEVAKUUTUS" }), ...fuel("2025-11", 6)]);
    expect(theme(r, "car")).toMatchObject({ yearCents: 156_000, changePct: 30 });
    expect(line(r, "car", "insurance")).toMatchObject({ yearCents: 120_000, changePct: null });
    expect(theme(r, "insurance")).toBeUndefined();
  });
});

describe("money back and money in", () => {
  const premium = paid("2026-10-05", 210, INSURER, "insurance", { description: "LIIKENNEVAKUUTUS" });
  // the money back names the insurer and no car
  const back = got("2026-10-25", 60, INSURER, "insurance", { description: "PALAUTUS" });
  const jacket = paid("2026-09-01", 89.9, CLOTHES, "shopping");
  const returned = got("2026-10-11", 40, CLOTHES, "shopping");
  const ctx = household("2025-11", [...fuel("2025-11", 6), premium, back, jacket, returned, ...Array.from({ length: 12 }, (_, i) => got(dateIn(addMonths("2025-11", i), 25), 3000, "ESIMERKKI OY", "salary"))]);
  const r = themesReport(ctx)!;

  it("money back lowers the theme and the line of its payment", () => {
    expect(ctx.returns.get(back.id)).toBe(premium.id);
    expect(ctx.returns.get(returned.id)).toBe(jacket.id);
    expect(line(r, "car", "insurance")!.yearCents).toBe(15_000);
    expect(theme(r, "insurance")).toBeUndefined();
    expect(theme(r, "shopping")!.yearCents).toBe(4_990);
  });

  it("pay is in no theme: the themes are the spending", () => {
    expect(r.themes.map((t) => [t.id, t.yearCents])).toEqual([
      ["housing", 540_000],
      ["car", 36_000 + 15_000],
      ["shopping", 4_990],
    ]);
    expect(r).toMatchObject({ totalCents: 595_990, spendingCents: 595_990, large: { cents: 0, count: 0, rows: [] } });
  });
});

describe("a large purchase", () => {
  const sofa = paid("2026-03-14", 1499, FURNITURE, "home");
  const lamp = paid("2026-02-10", 499, "Toinen Esimerkkikauppa Oy", "home");

  it("leaves its theme and stands with the large purchases, and one under the policy stays", () => {
    const car = paid("2026-05-20", 12_000, "Esimerkin Auto Oy", "vehicle_purchase");
    const r = answer("2025-11", [sofa, lamp, car]);
    // each row with its day, the payee Tapahtumat names and its cents, the largest first
    expect(r.large).toEqual({
      cents: 1_349_900,
      count: 2,
      rows: [
        { id: car.id, date: "2026-05-20", payee: "Esimerkin Auto Oy", cents: 1_200_000 },
        { id: sofa.id, date: "2026-03-14", payee: FURNITURE, cents: 149_900 },
      ],
    });
    expect(theme(r, "shopping")).toMatchObject({ yearCents: 49_900, lines: [{ id: "home", yearCents: 49_900 }] });
    // the car bought is on no line of Liikkuminen or Auto
    expect(r.themes.map((t) => t.id)).toEqual(["housing", "shopping"]);
    expect(r).toMatchObject({ totalCents: 589_900, spendingCents: 589_900 + 1_349_900 });
  });

  it("takes the money that came back for it along, as a row with its minus: the theme is not lowered", () => {
    const back = got("2026-04-02", 300, FURNITURE, "home");
    const ctx = household("2025-11", [sofa, lamp, back]);
    expect(ctx.returns.get(back.id)).toBe(sofa.id);
    const r = themesReport(ctx)!;
    // one purchase is counted, and the two rows add up to the sum
    expect(r.large).toEqual({
      cents: 119_900,
      count: 1,
      rows: [
        { id: sofa.id, date: "2026-03-14", payee: FURNITURE, cents: 149_900 },
        { id: back.id, date: "2026-04-02", payee: FURNITURE, cents: -30_000 },
      ],
    });
    expect(theme(r, "shopping")!.yearCents).toBe(49_900);
    expect(r.totalCents + r.large.cents).toBe(r.spendingCents);
  });

  it("bought before the window lowers the large purchases by what came back inside it, with no purchase to count", () => {
    const machine = paid("2025-10-20", 2000, "Esimerkkikone Oy", "home");
    const back = got("2025-11-05", 250, "Esimerkkikone Oy", "home");
    const ctx = household("2025-10", [machine, back, lamp]);
    expect(largePurchases(ctx).has(machine.id)).toBe(true);
    const r = themesReport(ctx)!;
    expect(r.large).toEqual({ cents: -25_000, count: 0, rows: [{ id: back.id, date: "2025-11-05", payee: "Esimerkkikone Oy", cents: -25_000 }] });
    expect(theme(r, "shopping")!.yearCents).toBe(49_900);
    expect(r.totalCents + r.large.cents).toBe(r.spendingCents);
  });

  it("money in on Auton osto that takes back no payment stands with the car bought, with its minus, on no line of Auto", () => {
    const car = paid("2026-05-20", 12_000, "Esimerkin Auto Oy", "vehicle_purchase");
    // the old car sold to a person: the user put the money on Auton osto
    const sold = got("2026-05-25", 8000, "Matti Meikalainen", "vehicle_purchase", { categorySource: "user" });
    const ctx = household("2025-11", [...fuel("2025-11", 12), car, sold]);
    expect(ctx.returns.has(sold.id)).toBe(false);
    const r = themesReport(ctx)!;
    expect(line(r, "car", "purchase")).toBeUndefined();
    expect(theme(r, "car")).toMatchObject({ yearCents: 72_000, lines: [{ id: "fuel", yearCents: 72_000 }] });
    // one purchase is counted: the money in is a row and no purchase
    expect(r.large).toEqual({
      cents: 400_000,
      count: 1,
      rows: [
        { id: car.id, date: "2026-05-20", payee: "Esimerkin Auto Oy", cents: 1_200_000 },
        { id: sold.id, date: "2026-05-25", payee: "Matti Meikalainen", cents: -800_000 },
      ],
    });
    expect(r).toMatchObject({ totalCents: 540_000 + 72_000, spendingCents: 540_000 + 72_000 + 400_000 });
  });

  it("money in on Auton osto without a car bought, in a household without Auto: a row with its minus and no line of Liikkuminen", () => {
    const sold = got("2026-05-25", 8000, "Matti Meikalainen", "vehicle_purchase", { categorySource: "user" });
    const r = answer("2025-11", [sold]);
    expect(r.themes.map((t) => t.id)).toEqual(["housing"]);
    expect(r.large).toEqual({ cents: -800_000, count: 0, rows: [{ id: sold.id, date: "2026-05-25", payee: "Matti Meikalainen", cents: -800_000 }] });
    expect(r.totalCents + r.large.cents).toBe(r.spendingCents);
  });
});

describe("a joint account", () => {
  const joint: Account = { id: "joint", name: "Yhteinen tili", holder: "MEIKALAINEN MATTI, MEIKALAINEN MAIJA", iban: null, currency: "EUR", type: "checking" };
  const rows = monthly("2025-11", 12, 2, 301.01, "Esimerkkikauppa Oy", "groceries", { accountId: joint.id });

  it("counts whole in the household's view and at the viewer's part in the member's own, each row cut on its own", () => {
    const whole = themesReport(createContext(rows, [joint], TODAY))!;
    const own = themesReport(createContext(applyUse(rows, [joint], new Map([[joint.id, HALF]])), [joint], TODAY))!;
    expect(whole).toMatchObject({ spendingCents: 361_212, totalCents: 361_212, totalMonthlyCents: 30_101 });
    // the half of 301,01 is 150,51 on every row, so the year is 6 cents over the half of the whole
    expect(own).toMatchObject({ spendingCents: 180_612, totalCents: 180_612, totalMonthlyCents: 15_051 });
    expect(theme(own, "food")).toMatchObject({ monthlyCents: 15_051, yearCents: 180_612 });
  });

  it("gives a row of the large purchases the cents its view counts, as the sum has them", () => {
    const sofa = paid("2026-03-14", 1499.01, FURNITURE, "home", { accountId: joint.id });
    const back = got("2026-04-02", 300.01, FURNITURE, "home", { accountId: joint.id });
    const all = [...rows, sofa, back];
    const whole = themesReport(createContext(all, [joint], TODAY))!;
    const own = themesReport(createContext(applyUse(all, [joint], new Map([[joint.id, HALF]])), [joint], TODAY))!;
    expect(whole.large).toMatchObject({ cents: 119_900, count: 1 });
    expect(whole.large.rows.map((x) => [x.id, x.cents])).toEqual([
      [sofa.id, 149_901],
      [back.id, -30_001],
    ]);
    // the half of each row, rounded on its own: 749,51 and 150,01
    expect(own.large).toMatchObject({ cents: 59_950, count: 1 });
    expect(own.large.rows.map((x) => [x.id, x.cents])).toEqual([
      [sofa.id, 74_951],
      [back.id, -15_001],
    ]);
    expect(own.totalCents + own.large.cents).toBe(own.spendingCents);
  });
});

describe("the theme Auto", () => {
  const insurance = paid("2026-10-05", 210, INSURER, "insurance", { description: "LIIKENNEVAKUUTUS" });
  const tax = paid("2026-10-06", 230, "Traficom", "taxes", { description: "AJONEUVOVERO" });

  it("exists with six purchases of fuel in the window and takes the car's insurance and tax", () => {
    const r = answer("2025-11", [...fuel("2025-11", 6), insurance, tax]);
    expect(theme(r, "car")!.lines.map((l) => [l.heading, l.yearCents])).toEqual([
      ["Polttoaine", 36_000],
      ["Liikenne- ja autovakuutus", 21_000],
      ["Ajoneuvovero", 23_000],
    ]);
    expect(r.themes.map((t) => t.id)).toEqual(["housing", "car"]);
  });

  it("does not exist with five: every row stays in the theme of its category", () => {
    // three more before the window do not count
    const r = answer("2025-08", [...fuel("2025-08", 3), ...fuel("2025-11", 5), insurance, tax]);
    expect(r.window.first).toBe("2025-11");
    expect(theme(r, "car")).toBeUndefined();
    expect(r.themes.map((t) => [t.heading, t.yearCents])).toEqual([
      ["Asuminen", 540_000],
      ["Liikkuminen", 30_000],
      ["Verot ja maksut", 23_000],
      ["Vakuutukset", 21_000],
    ]);
  });
});

describe("the themes and the large purchases add up to the spending of the window", () => {
  const households = [...goldenHouseholds(), ...EVENTS.map((e) => kitHousehold(e))];

  /** A household's rows as the server reads them, and the same rows as a member with a half of every account sees them. */
  function views(name: string): Record<string, AnalysisContext> {
    const h = households.find((x) => x.name === name)!;
    const rows = enrich(h.txs, h.accounts, h.rules);
    const halves = new Map(h.accounts.map((a) => [a.id, HALF]));
    return { "Koko talous": createContext(rows, h.accounts, h.today), own: createContext(applyUse(rows, h.accounts, halves), h.accounts, h.today) };
  }

  it.each(households.map((h) => h.name))(
    "%s: in both views, to the cent",
    (name) => {
      for (const [view, ctx] of Object.entries(views(name))) {
        const r = themesReport(ctx);
        // The bank gave the card a new account in mid-August: it has spending and covers September alone, under three
        // months. The kit's accounts carry no bank and the new one is no account of the household, so nothing vouches for it.
        expect(r === null, view).toBe(name === "kit:card-replaced");
        if (!r) continue;
        const year = r.window.months === 12;
        expect(r.window.months, view).toBe(monthIndex(r.window.last) - monthIndex(r.window.first) + 1);
        // the spending of the window as Tulot ja menot has it
        expect(r.spendingCents, view).toBe(cashflowReport(ctx, { from: dateIn(r.window.first, 1), to: monthEnd(r.window.last) }).totals.expenseCents);
        expect(r.totalCents + r.large.cents, view).toBe(r.spendingCents);

        // the large purchases are the policy's rows of the window, with the money that came back for one
        const large = largePurchases(ctx);
        const inWindow = ctx.txs.filter((t) => t.month >= monthIndex(r.window.first) && t.month <= monthIndex(r.window.last));
        // a large purchase, money back for one, and money in on Auton osto that takes back no payment
        const apart = (t: (typeof inWindow)[number]) => large.has(ctx.returns.get(t.id) ?? t.id) || (t.spend < 0 && t.category === "vehicle_purchase" && !ctx.returns.has(t.id));
        expect(r.large.cents, view).toBe(sum(inWindow.filter(apart).map((t) => t.spend)));
        // its rows add up to the sum, and the count is the rows that are purchases: the rest is money back, with a minus
        expect(sum(r.large.rows.map((x) => x.cents)), view).toBe(r.large.cents);
        const purchases = r.large.rows.filter((x) => large.has(x.id));
        expect(r.large.count, view).toBe(purchases.length);
        expect(purchases.map((x) => x.id).sort(), view).toEqual(inWindow.filter((t) => large.has(t.id)).map((t) => t.id).sort());
        expect(r.large.rows.filter((x) => x.cents > 0), view).toEqual(purchases);
        // each is a row of the window once: its day, the payee Tapahtumat names and what this view counts for it
        const byId = new Map(inWindow.map((t) => [t.id, t]));
        expect(new Set(r.large.rows.map((x) => x.id)).size, view).toBe(r.large.rows.length);
        for (const x of r.large.rows) {
          const t = byId.get(x.id)!;
          expect(x, `${view} ${x.id}`).toEqual({ id: t.id, date: t.bookingDate, payee: t.merchant, cents: t.spend });
        }
        expect(r.large.rows.map((x) => x.cents), view).toEqual(r.large.rows.map((x) => x.cents).sort((a, b) => b - a));

        // a page adds nothing up: the columns do
        expect(sum(r.themes.map((t) => t.monthlyCents)), view).toBe(r.totalMonthlyCents);
        expect(r.totalYearCents, view).toBe(year ? r.totalCents : null);
        if (year) expect(sum(r.themes.map((t) => t.yearCents!)), view).toBe(r.totalCents);
        for (const t of r.themes) {
          const at = `${view} ${t.heading}`;
          expect(t.lines.length, at).toBeGreaterThan(0);
          expect(sum(t.lines.map((l) => l.monthlyCents)), at).toBe(t.monthlyCents);
          for (const x of [t, ...t.lines]) expect(x.yearCents === null, at).toBe(!year);
          if (!year) continue;
          expect(sum(t.lines.map((l) => l.yearCents!)), at).toBe(t.yearCents);
          expect(t.monthlyCents, at).toBe(Math.round(t.yearCents! / 12) || 0);
          // a line is within a cent of its own year divided by twelve
          for (const l of t.lines) expect(Math.abs(l.monthlyCents - l.yearCents! / 12), `${at} / ${l.heading}`).toBeLessThan(1);
        }
        expect(r.themes.map((t) => t.heading), view).toEqual([...new Set(r.themes.map((t) => t.heading))]);
      }
    },
    60_000,
  );

  it("the fixtures hold a large purchase, a window cut by a stopped account and a change over the gate", () => {
    const bought = themesReport(views("kit:large-purchase")["Koko talous"]!)!;
    // the television of the sixth of last month, its one row
    expect(bought.large).toMatchObject({ cents: 149_900, count: 1, rows: [{ date: "2026-09-06", cents: 149_900 }] });
    expect(themesReport(views("kit:stopped-account")["Koko talous"]!)!.window).toEqual({ first: "2025-10", last: "2026-07", months: 10 });
    // a card connected late: the months from its first row on, with no year and no change
    const late = themesReport(views("kit:card-connected-late")["Koko talous"]!)!;
    expect(late.window).toEqual({ first: "2026-05", last: "2026-09", months: 5 });
    expect(late.themes.every((t) => t.yearCents === null && t.changePct === null)).toBe(true);
    const settled = themesReport(views("settled:1")["Koko talous"]!)!;
    expect(settled.window.months).toBe(12);
    expect(settled.themes.some((t) => t.changePct !== null)).toBe(true);
  });

  it("kit:card-replaced has its answer when its two cards are accounts of one bank: the old card vouches for the new one", () => {
    const h = households.find((x) => x.name === "kit:card-replaced")!;
    const rows = enrich(h.txs, h.accounts, h.rules);
    // the kit's accounts carry no bank, and the new card account is no account of the household
    expect(h.accounts.some((a) => a.bank || a.id === "card2")).toBe(false);
    expect(themesReport(createContext(rows, h.accounts, h.today))).toBeNull();
    const accounts: Account[] = [...h.accounts.map((a) => ({ ...a, bank: "Nordea" })), { id: "card2", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card", bank: "Nordea" }];
    const r = themesReport(createContext(rows, accounts, h.today))!;
    expect(r.window).toEqual({ first: "2025-10", last: "2026-09", months: 12 });
    // the same purchases on a new account id: the answer of the household whose card was not replaced
    expect(r).toEqual(themesReport(views("kit:base")["Koko talous"]!));
    expect(changes(r)).toMatchObject({ shopping: 75 });
  });
});
