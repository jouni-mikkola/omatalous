/**
 * Ruoka (analysis/food.ts): the four food lines of the themes report with what each bought. The lines and nothing
 * else are the theme `food` of the themes report to the cent, a purchase is a row that cost something in the end and
 * is not a payment to a person, and a figure that stands on under six purchases is none.
 */
import { describe, expect, it } from "vitest";
import { goldenHouseholds } from "../../../tools/findings/golden.ts";
import { applyUse } from "../src/account-use.ts";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { type FoodReport, foodReport } from "../src/analysis/food.ts";
import { themesReport, themeWindow } from "../src/analysis/themes-report.ts";
import { addMonths, dateIn, monthIndex, monthOf } from "../src/dates.ts";
import type { Account, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { EVENTS, kitHousehold } from "./kit/index.ts";
import { enrich } from "./optimise/household.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
/** The 10th of October: September 2026 is the last complete month. */
const TODAY = "2026-10-10";
const HALF: Part = { from: 0, to: 1, of: 2 };

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const paid = (bookingDate: string, cents: number, merchant: string, category: string, more: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: -cents, merchant, category, categorySource: "rule", ...more });
const got = (bookingDate: string, cents: number, merchant: string, category: string) => tx({ bookingDate, amountCents: cents, merchant, category, categorySource: "rule" });

const SHOP = "Esimerkkikauppa Oy";
const PLACE = "Ravintola Esimerkki";
const months = (first: string, count: number) => Array.from({ length: count }, (_, i) => addMonths(first, i));
/** Rent on the 2nd of each month from `first` to the running one: the account has rows in every month. */
const rent = (first: string, today: string) => months(first, monthIndex(monthOf(today)) - monthIndex(first) + 1).map((m) => paid(dateIn(m, 2), 45_000, "Asunto Oy Esimerkki", "housing"));
/** `cents` in total split over the days given, the cents left over in the last. */
const split = (month: string, days: readonly number[], total: number, merchant: string, category: string) => {
  const each = Math.floor(total / days.length);
  return days.map((d, i) => paid(dateIn(month, d), i === days.length - 1 ? total - each * (days.length - 1) : each, merchant, category));
};
const DAYS = [3, 9, 16, 23];
/** A line of `totals` cents over `count` months from `first`, in four rows a month, the last month holding what the floors left. */
const line = (first: string, count: number, total: number, merchant: string, category: string) => {
  const each = Math.floor(total / count);
  return months(first, count).flatMap((m, i) => split(m, DAYS, i === count - 1 ? total - each * (count - 1) : each, merchant, category));
};
const world = (first: string, more: readonly Transaction[], today = TODAY) => createContext([...rent(first, today), ...more], [checking], today);
/** The report as figures; a test that gets a gap fails here. */
type FoodFigures = Exclude<FoodReport, { gap: unknown }>;
type FoodGap = Extract<FoodReport, { gap: unknown }>["gap"];
const figures = (r: ReturnType<typeof foodReport>): FoodFigures => {
  if (!r || "gap" in r) throw new Error("expected food figures");
  return r;
};
/** The report as the reason there are no figures. */
const gapOf = (r: ReturnType<typeof foodReport>): FoodGap => {
  if (!r || !("gap" in r)) throw new Error("expected a gap");
  return r.gap;
};
const food = (first: string, more: readonly Transaction[], today = TODAY) => figures(foodReport(world(first, more, today)));
const byId = (r: FoodFigures, id: string) => r.lines.find((l) => l.id === id)!;

describe("the four lines", () => {
  it("add up to the theme to the cent: the worked example of twelve months", () => {
    const r = food("2025-10", [
      ...line("2025-10", 12, 721_440, SHOP, "groceries"),
      ...line("2025-10", 12, 324_050, PLACE, "restaurants"),
      ...line("2025-10", 12, 254_610, "Esimerkkiruoka Oy", "food_delivery"),
      ...line("2025-10", 12, 41_200, "Esimerkkialko", "alcohol"),
    ]);
    expect(r.window).toEqual({ first: "2025-10", last: "2026-09", months: 12, days: 365 });
    expect(r.lines.map((l) => [l.heading, l.cents])).toEqual([
      ["Ruokakauppa", 721_440],
      ["Ravintolat ja kahvilat", 324_050],
      ["Ruoan kotiinkuljetus", 254_610],
      ["Alko", 41_200],
    ]);
    expect(r.cents).toBe(1_341_300);
    expect(r.monthlyCents).toBe(111_775);
    // floors 60 120, 27 004, 21 217 and 3 433 are 111 774 and the cent left goes to the delivery, which lost .50
    expect(r.lines.map((l) => l.monthlyCents)).toEqual([60_120, 27_004, 21_218, 3_433]);
    expect(sum(r.lines.map((l) => l.monthlyCents))).toBe(r.monthlyCents);
    // a week of 365 days: 138,36 €, 62,15 €, 48,83 € and 7,90 €
    expect(r.lines.map((l) => l.weekCents)).toEqual([13_836, 6_215, 4_883, 790]);
  });

  it("are the theme food of the themes report in both views of every household", () => {
    const households = [...goldenHouseholds(), ...EVENTS.map((e) => kitHousehold(e))];
    let seen = 0;
    for (const h of households) {
      const rows = enrich(h.txs, h.accounts, h.rules);
      const halves = new Map(h.accounts.map((a) => [a.id, HALF]));
      const views: Record<string, AnalysisContext> = { "Koko talous": createContext(rows, h.accounts, h.today), own: createContext(applyUse(rows, h.accounts, halves), h.accounts, h.today) };
      for (const [view, ctx] of Object.entries(views)) {
        const at = `${h.name} ${view}`;
        const themes = themesReport(ctx);
        const theme = themes?.themes.find((t) => t.id === "food");
        const told = foodReport(ctx);
        // card bills without their purchases are the reason, not figures
        if (told && "gap" in told) continue;
        const r = told;
        // no window or no food is no section
        expect(r === null, at).toBe(!theme);
        if (!r || !theme || !themes) continue;
        seen++;
        expect(r.window.first, at).toBe(themes.window.first);
        expect(r.window.last, at).toBe(themes.window.last);
        expect(r.window.months, at).toBe(themes.window.months);
        expect(r.monthlyCents, at).toBe(theme.monthlyCents);
        if (theme.yearCents !== null) expect(r.cents, at).toBe(theme.yearCents);
        expect(r.lines.filter((l) => l.cents).map((l) => [l.id, l.monthlyCents]), at).toEqual(theme.lines.map((l) => [l.id, l.monthlyCents]));
        expect(sum(r.lines.map((l) => l.monthlyCents)), at).toBe(r.monthlyCents);
        expect(sum(r.lines.map((l) => l.cents)), at).toBe(r.cents);
        for (const l of r.lines) {
          // the months add up to the line, and the payees and the rest to the line
          expect(l.monthCents.length, at).toBe(r.window.months);
          expect(sum(l.monthCents), `${at} ${l.id}`).toBe(l.cents);
          expect(sum(l.payees.map((p) => p.cents)) + l.otherCents, `${at} ${l.id}`).toBe(l.cents);
          expect(l.payees.length, at).toBeLessThanOrEqual(5);
          // the weekdays are the purchases
          if (l.weekdays) expect(sum(l.weekdays), `${at} ${l.id}`).toBe(l.purchases);
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  }, 60_000);
});

describe("the section", () => {
  it("is not there under three complete months, and three give it", () => {
    expect(foodReport(world("2026-08", line("2026-08", 2, 20_000, SHOP, "groceries")))).toBeNull();
    const r = food("2026-07", line("2026-07", 3, 30_000, SHOP, "groceries"));
    expect(r.window.months).toBe(3);
    expect(r.cents).toBe(30_000);
    // a window with no food in it is none either
    expect(foodReport(world("2026-07", []))).toBeNull();
  });

  it("is the report of the themes window", () => {
    const ctx = world("2026-07", line("2026-07", 3, 30_000, SHOP, "groceries"));
    expect(themeWindow(ctx)!.months.length).toBe(figures(foodReport(ctx)).window.months);
  });
});

describe("a purchase", () => {
  /** Rows of the groceries line in September 2026, one a day on the given days. */
  const shop = (days: readonly number[], cents = 10_000) => days.map((d) => paid(dateIn("2026-09", d), cents, SHOP, "groceries"));

  it("needs six for a mean and the visits a month: five give dashes and six figures", () => {
    const five = byId(food("2026-07", shop([3, 4, 5, 6, 7])), "groceries");
    expect(five).toMatchObject({ cents: 50_000, purchases: 5, meanCents: null, perMonth: null, weekdays: null });
    expect(five.weekCents).not.toBeNull();
    const six = byId(food("2026-07", shop([3, 4, 5, 6, 7, 8])), "groceries");
    expect(six).toMatchObject({ cents: 60_000, purchases: 6, meanCents: 10_000, perMonth: 2 });
    expect(six.weekdays).not.toBeNull();
  });

  it("is a mean of net purchases: money back lowers the line and is no purchase", () => {
    const rows = [...shop([3, 4, 5, 6, 7, 8]), got("2026-09-20", 4_000, SHOP, "groceries")];
    const ctx = world("2026-07", rows);
    // the money back is matched to a payment, and it is not the seventh purchase
    expect(ctx.returns.size).toBe(1);
    const l = byId(figures(foodReport(ctx)), "groceries");
    expect(l.cents).toBe(56_000);
    expect(l.monthCents).toEqual([0, 0, 56_000]);
    expect(l).toMatchObject({ purchases: 6, meanCents: 9_333 });
    // the payment alone is the same purchase: the line is lower, the count is not
    expect(l.payees).toEqual([{ payee: SHOP, cents: 56_000 }]);
  });

  it("returned whole is no purchase, and the line keeps the money out and the money back", () => {
    const l = byId(food("2026-07", [...shop([3, 4, 5, 6, 7, 8]), paid("2026-09-10", 5_000, SHOP, "groceries"), got("2026-09-12", 5_000, SHOP, "groceries")]), "groceries");
    expect(l).toMatchObject({ cents: 60_000, purchases: 6 });
  });

  it("is none when it is a mobile payment to a person, which stays in the line's sum", () => {
    const rows = [
      ...[3, 4, 5, 6, 7, 8].map((d) => paid(dateIn("2026-09", d), 2_000, PLACE, "restaurants")),
      paid("2026-09-10", 3_000, "Matti Meikalainen", "restaurants", { counterparty: "Matti Meikalainen", description: "MobilePay" }),
    ];
    const l = byId(food("2026-07", [...rows, ...shop([3])]), "restaurants");
    expect(l).toMatchObject({ cents: 15_000, purchases: 6, meanCents: 2_000 });
    expect(l.payees.map((p) => p.payee)).toContain("Matti Meikalainen");
    // five and the person: still five purchases
    const five = byId(food("2026-07", [...rows.slice(1), ...shop([3])]), "restaurants");
    expect(five).toMatchObject({ cents: 13_000, purchases: 5, meanCents: null });
  });

  it("is counted by the weekday of the booking, and a delivery has none", () => {
    // 4.9.2026 is a Friday
    const r = food("2026-07", [...shop([4, 5, 6, 7, 8, 9]), ...[4, 5, 6, 7, 8, 9].map((d) => paid(dateIn("2026-09", d), 2_500, "Esimerkkiruoka Oy", "food_delivery"))]);
    expect(byId(r, "groceries").weekdays).toEqual([1, 1, 1, 0, 1, 1, 1]);
    expect(byId(r, "food_delivery")).toMatchObject({ purchases: 6, weekdays: null, meanCents: 2_500 });
  });
});

describe("a line", () => {
  it("at or under zero keeps its row with dashes", () => {
    // a restaurant bill of April, the first row there is, is paid back in August: April is no month of the window
    const rows = [paid("2026-04-20", 5_000, PLACE, "restaurants"), got("2026-08-15", 5_000, PLACE, "restaurants"), ...line("2026-07", 3, 30_000, SHOP, "groceries")];
    const r = food("2026-05", rows);
    const l = byId(r, "restaurants");
    expect(l).toMatchObject({ cents: -5_000, monthlyCents: -1_000, weekCents: null, meanCents: null, perMonth: null, weekdays: null, changeCents: null, dearest: null, purchases: 0 });
    expect(l.heading).toBe("Ravintolat ja kahvilat");
    expect(r.lines).toHaveLength(4);
    expect(r.cents).toBe(25_000);
    // a line with nothing at all is as empty
    expect(byId(r, "alcohol")).toMatchObject({ cents: 0, monthlyCents: 0, weekCents: null, dearest: null });
  });

  it("lists five payees and the rest, which add up to the line", () => {
    const merchants = ["A", "B", "C", "D", "E", "F", "G"].map((x, i) => ({ name: `Esimerkkikauppa ${x}`, cents: (7 - i) * 1_000 }));
    const rows = merchants.flatMap((m, i) => paid(dateIn("2026-09", 3 + i), m.cents, m.name, "groceries"));
    const l = byId(food("2026-07", [...rows, ...line("2026-07", 3, 3_000, "Esimerkkikauppa H", "groceries")]), "groceries");
    expect(l.payees.map((p) => p.payee)).toEqual(["Esimerkkikauppa A", "Esimerkkikauppa B", "Esimerkkikauppa C", "Esimerkkikauppa D", "Esimerkkikauppa E"]);
    expect(l.payees.map((p) => p.cents)).toEqual([7_000, 6_000, 5_000, 4_000, 3_000]);
    // the sixth and seventh and the eighth, which came to 30 €, are the rest
    expect(l.otherCents).toBe(2_000 + 1_000 + 3_000);
    expect(sum(l.payees.map((p) => p.cents)) + l.otherCents).toBe(l.cents);
  });

  it("names the dearest month", () => {
    const rows = [...line("2026-07", 3, 30_000, SHOP, "groceries"), paid("2026-08-20", 5_000, SHOP, "groceries")];
    const l = byId(food("2026-07", rows), "groceries");
    expect(l.monthCents).toEqual([10_000, 15_000, 10_000]);
    expect(l.dearest).toBe(1);
  });
});

describe("a week", () => {
  it("is the sum over the days of the window, also when the clocks change inside it", () => {
    // 26.10.2025 is the end of summer time: October to December has 92 days of 24 hours in the count, one of 25 on the clock
    const r = food("2025-10", line("2025-10", 3, 100_000, SHOP, "groceries"), "2026-01-10");
    expect(r.window).toEqual({ first: "2025-10", last: "2025-12", months: 3, days: 92 });
    // 700 000 / 92 = 7 608,7
    expect(byId(r, "groceries").weekCents).toBe(7_609);
    // 29.3.2026 is the start of it: March to May is 92 days too
    const spring = food("2026-03", line("2026-03", 3, 100_000, SHOP, "groceries"), "2026-06-10");
    expect(spring.window.days).toBe(92);
    expect(byId(spring, "groceries").weekCents).toBe(7_609);
  });
});

describe("a change", () => {
  /** Groceries by month for nine months from January: the six before and the newest three. */
  const nine = (cents: readonly number[]) => food("2026-01", cents.map((c, i) => paid(dateIn(addMonths("2026-01", i), 5), c, SHOP, "groceries")));

  it("is told when the newest three are outside the six before them and over the gate", () => {
    // the usual of the six is 200 €, the gate 10 €
    expect(byId(nine([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 21_100, 21_100, 21_100]), "groceries").changeCents).toBe(1_100);
    expect(byId(nine([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 18_900, 18_900, 18_900]), "groceries").changeCents).toBe(-1_100);
  });

  it("is none inside the range of the six, or at the gate, or under nine months", () => {
    // the mean of the three is in the six's lowest-to-highest
    expect(byId(nine([18_000, 20_000, 22_000, 18_000, 20_000, 22_000, 21_000, 21_000, 21_000]), "groceries").changeCents).toBeNull();
    // outside the range but only 9 € over the usual
    expect(byId(nine([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_900, 20_900, 20_900]), "groceries").changeCents).toBeNull();
    expect(byId(food("2026-02", [20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 30_000, 30_000].map((c, i) => paid(dateIn(addMonths("2026-02", i), 5), c, SHOP, "groceries"))), "groceries").changeCents).toBeNull();
  });
});

describe("the basket", () => {
  /** Groceries from April to September: `now` purchases a month in the newest three and `before` in the three before. */
  const basket = (before: number, now: number, centsNow = 5_000) => {
    const rows = months("2026-04", 6).flatMap((m, i) => Array.from({ length: i < 3 ? before : now }, (_, k) => paid(dateIn(m, 3 + k * 5), i < 3 ? 4_000 : centsNow, SHOP, "groceries")));
    return food("2026-04", rows).basket!;
  };

  it("tells visits a month and the mean purchase now and before: a rise reads as more visits or a dearer basket", () => {
    const b = basket(2, 3, 6_000);
    expect(b.before).toEqual({ purchases: 6, meanCents: 4_000, perMonth: 2 });
    expect(b.now).toEqual({ purchases: 9, meanCents: 6_000, perMonth: 3 });
  });

  it("has dashes when either side has under six purchases and figures at six", () => {
    expect(basket(2, 1).now).toEqual({ purchases: 3, meanCents: null, perMonth: null });
    expect(basket(2, 1).before).toEqual({ purchases: 6, meanCents: null, perMonth: null });
    expect(basket(1, 2).before).toMatchObject({ purchases: 3, meanCents: null });
    expect(basket(2, 2).now.meanCents).toBe(5_000);
  });

  it("is not there under six months", () => {
    expect(food("2026-06", line("2026-06", 4, 40_000, SHOP, "groceries")).basket).toBeNull();
  });
});

describe("the card bills", () => {
  const bill = (day: string, cents: number) => paid(day, cents, "Esimerkkipankki Oyj", "card_bill");
  const report = (more: readonly Transaction[]) => foodReport(world("2026-07", [...line("2026-07", 3, 30_000, SHOP, "groceries"), ...more]));

  it("leave figures when the window holds none, and a bill before the window is not in it", () => {
    expect(figures(report([])).cents).toBe(30_000);
    expect(figures(report([bill("2026-06-15", 20_000)])).cents).toBe(30_000);
  });

  it("make the report one reason with no lines when the window holds a bill whose purchases are not in the data", () => {
    const r = report([bill("2026-08-15", 20_000), bill("2026-09-15", 10_000)])!;
    expect(r).not.toHaveProperty("lines");
    const gap = gapOf(r);
    expect(gap.cents).toBe(30_000);
    expect(gap.window).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(gap.bills).toMatchObject([{ issuer: "Esimerkkipankki Oyj", cents: 30_000, reason: "not_connected" }]);
    expect(gap.text.replace(/\u00a0/g, " ")).toBe("Ruoan menoja ei lasketa: ajalla 1.7.2026–30.9.2026 on korttilaskuja 300 €, mutta Esimerkkipankki Oyj ei ole yhdistetty.");
  });

  it("says since when a connected card has rows when the bill is of the time before: the window ends where the card begins", () => {
    const card: Account = { id: "card-1", name: "Esimerkkipankki Visa", iban: null, currency: "EUR", type: "credit_card" };
    const rows = [...rent("2026-05", TODAY), ...line("2026-05", 4, 40_000, SHOP, "groceries"), bill("2026-08-15", 20_000), paid("2026-09-10", 1_000, SHOP, "groceries", { accountId: "card-1" })];
    const gap = gapOf(foodReport(createContext(rows, [checking, card], TODAY)));
    expect(gap.window).toEqual({ from: "2026-05-01", to: "2026-08-31" });
    expect(gap.bills).toMatchObject([{ reason: "before_history", since: "2026-09-10" }]);
    expect(gap.text).toContain("kortin ostot alkavat vasta 10.9.2026");
  });

  it("are a reason even when the accounts show no food at all", () => {
    expect(gapOf(foodReport(world("2026-07", [bill("2026-08-15", 20_000), ...line("2026-07", 3, 30_000, "Esimerkkipalvelu", "entertainment")])))).toMatchObject({ cents: 20_000 });
  });
});
