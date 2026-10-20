/**
 * The themes are the main classes above the categories (themes.ts). Every row that counts in Menot has one theme and
 * one line in it, so the themes of a month add up to its Menot to the cent, in both views of every fixture household.
 * Auto takes the car's insurance, tax, finance and lease out of their categories, and exists only for a household
 * that has a car. The car's cost in Säästövinkit reads its lines from the same classifier.
 */
import { describe, expect, it } from "vitest";
import { goldenHouseholds } from "../../../tools/findings/golden.ts";
import { applyUse } from "../src/account-use.ts";
import { type AnalysisContext, type AnalysisTx, createContext, inDays, netSpend } from "../src/analysis/context.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { formatEur } from "../src/analysis/format.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { CATEGORIES } from "../src/categories.ts";
import { addMonths, daysInMonth, monthOf } from "../src/dates.ts";
import { areaInputOf, buildOptimise } from "../src/optimise/index.ts";
import { fuelPurchases, themeOf, THEMES } from "../src/themes.ts";
import type { Account, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { EVENTS, kitHousehold } from "./kit/index.ts";
import { enrich, FRAME, householdInput, joinHousehold } from "./optimise/household.ts";
import * as carPart from "./optimise/parts/car.ts";
import { rowsOf } from "./optimise/parts/tax.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const TODAY = "2026-11-10";
const HALF: Part = { from: 0, to: 1, of: 2 };

type Cars = Parameters<typeof themeOf>[2];
const HAS_CAR: Cars = { answer: 1, purchases: 0 };
const NO_CAR: Cars = { answer: 0, purchases: 40 };
const notAsked = (purchases: number): Cars => ({ answer: null, purchases });

const INSURER = "Esimerkkivakuutus Oy";
const LENDER = "Esimerkkirahoitus Oy";

const cents = (euros: number) => Math.round(euros * 100);
const paid = (bookingDate: string, euros: number, merchant: string, category: string, description: string | null = null) =>
  tx({ bookingDate, amountCents: -cents(euros), merchant, category, categorySource: "rule", description });
const got = (bookingDate: string, euros: number, merchant: string, category: string, description: string | null = null) =>
  tx({ bookingDate, amountCents: cents(euros), merchant, category, categorySource: "rule", description });

/** Where a row counts, as a page would head it: "theme / line". A place the table does not hold has no heading. */
function placeOf(ctx: AnalysisContext, t: AnalysisTx, cars: Cars): string {
  const at = themeOf(ctx, t, cars);
  const theme = THEMES.find((x) => x.id === at.theme);
  return `${theme?.heading} / ${theme?.lines.find((l) => l.id === at.line)?.heading}`;
}

/** The places of `rows`, in the order given. */
function places(rows: readonly Transaction[], cars: Cars = HAS_CAR): string[] {
  const ctx = createContext(rows, [checking], TODAY);
  return rows.map((t) => placeOf(ctx, ctx.txs.find((x) => x.id === t.id)!, cars));
}

/** What the rows that count in Menot add up to in each place. */
function sums(ctx: AnalysisContext, rows: readonly AnalysisTx[], cars: Cars): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of rows) {
    if (!t.spend) continue;
    const place = placeOf(ctx, t, cars);
    out[place] = (out[place] ?? 0) + t.spend;
  }
  return out;
}

const fuel = (bookingDate: string, euros = 60) => paid(bookingDate, euros, "Neste Vantaa", "car");
const carInsurance = () => paid("2026-10-05", 210, INSURER, "insurance", "LIIKENNEVAKUUTUS");
const vehicleTax = () => paid("2026-10-06", 230, "Traficom", "taxes", "AJONEUVOVERO");
const carLoan = () => paid("2026-10-07", 290, LENDER, "loans", "AUTOLAINA LYHENNYS");
const lease = () => paid("2026-10-08", 380, LENDER, "other", "LEASINGVUOKRA");

describe("the table of themes", () => {
  it("lists the fifteen themes in the order a page prints them", () => {
    expect(THEMES.map((t) => t.heading)).toEqual([
      "Asuminen",
      "Ruoka",
      "Auto",
      "Liikkuminen",
      "Lapset",
      "Lemmikit",
      "Terveys ja hyvinvointi",
      "Viestintä ja tilaukset",
      "Ostokset",
      "Koulutus",
      "Vapaa-aika",
      "Vakuutukset",
      "Verot ja maksut",
      "Lainat ja luotot",
      "Raha-asiat",
    ]);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(15);
  });

  it("has every category that holds spending as a line of one theme, under the category's label", () => {
    const spending = CATEGORIES.filter((c) => c.kind === "expense" || c.kind === "debt");
    expect(spending.length).toBeGreaterThan(30);
    for (const c of spending) {
      const lines = THEMES.flatMap((t) => t.lines.filter((l) => l.id === c.id && t.id !== "car"));
      // the theme is Raha-asiat: the category Muut menot is its line of that name, as everywhere else
      expect(lines.map((l) => l.heading), c.id).toEqual([c.label]);
    }
    for (const t of THEMES) expect(new Set(t.lines.map((l) => l.id)).size, t.heading).toBe(t.lines.length);
  });

  it("gives Auto the lines of what a car row was for, a car bought last", () => {
    expect(THEMES.find((t) => t.id === "car")!.lines.map((l) => l.heading)).toEqual([
      "Polttoaine",
      "Sähkölataus",
      "Pysäköinti",
      "Huolto ja renkaat",
      "Katsastus",
      "Liikenne- ja autovakuutus",
      "Ajoneuvovero",
      "Rahoitus",
      "Leasing",
      "Muut",
      "Auton osto",
    ]);
  });
});

describe("a row's theme and line", () => {
  it("a row of a whole category is under the category's label", () => {
    expect(
      places([
        paid("2026-10-01", 900, "Asunto Oy Esimerkki", "housing"),
        paid("2026-10-02", 640, "Esimerkkipankki", "mortgage"),
        paid("2026-10-03", 85, "Esimerkkikauppa Oy", "groceries"),
        paid("2026-10-04", 30, "Esimerkkikauppa Oy", "home"),
        paid("2026-10-05", 12, "Esimerkkiseura ry", "memberships"),
        paid("2026-10-06", 5, "Esimerkkipankki", "fees"),
        paid("2026-10-07", 45, "Esimerkkiliikenne Oy", "transport"),
      ]),
    ).toEqual([
      "Asuminen / Vuokra ja vastike",
      "Asuminen / Asuntolaina",
      "Ruoka / Ruokakauppa",
      "Ostokset / Koti ja elektroniikka",
      "Verot ja maksut / Jäsenmaksut",
      "Verot ja maksut / Pankkikulut",
      "Liikkuminen / Joukkoliikenne ja taksit",
    ]);
  });

  it("a row of the car's own category is on the line of what it was for", () => {
    expect(
      places([
        fuel("2026-10-01"),
        paid("2026-10-02", 14, "K-Lataus", "car"),
        paid("2026-10-03", 9, "EasyPark", "car"),
        paid("2026-10-04", 450, "Vianor", "car"),
        paid("2026-10-05", 69, "A-Katsastus", "car"),
        paid("2026-10-06", 25, "Esimerkkipesu Oy", "car"),
      ]),
    ).toEqual(["Auto / Polttoaine", "Auto / Sähkölataus", "Auto / Pysäköinti", "Auto / Huolto ja renkaat", "Auto / Katsastus", "Auto / Muut"]);
  });

  it("the car's insurance is Auto, another insurance is Vakuutukset", () => {
    expect(places([carInsurance(), paid("2026-10-05", 140, INSURER, "insurance", "VAKUUTUSMAKSU")])).toEqual(["Auto / Liikenne- ja autovakuutus", "Vakuutukset / Vakuutukset"]);
  });

  it("the vehicle tax is Auto, another tax is Verot ja maksut", () => {
    expect(places([vehicleTax(), paid("2026-10-06", 300, "Verohallinto", "taxes", "JAANNOSVERO")])).toEqual(["Auto / Ajoneuvovero", "Verot ja maksut / Verot, maksut ja sakot"]);
  });

  it("a loan that names the car is Auto, another loan is Lainat ja luotot", () => {
    expect(places([carLoan(), paid("2026-10-07", 120, LENDER, "loans", "KULUTUSLUOTTO")])).toEqual(["Auto / Rahoitus", "Lainat ja luotot / Kulutusluotot"]);
  });

  it("a lease is Auto whatever its category, the same payee's other bill is not", () => {
    expect(places([lease(), paid("2026-10-08", 380, LENDER, "other", "VUOKRA")])).toEqual(["Auto / Leasing", "Raha-asiat / Muut menot"]);
  });

  it("home insurance, property tax and a pet insurer's premium stay in the theme of their category: no word list names them yet", () => {
    expect(
      places([
        paid("2026-10-05", 160, INSURER, "insurance", "KOTIVAKUUTUS"),
        paid("2026-10-06", 420, "Esimerkin kaupunki", "taxes", "KIINTEISTOVERO"),
        paid("2026-10-07", 35, INSURER, "insurance", "ELAINVAKUUTUS"),
      ]),
    ).toEqual(["Vakuutukset / Vakuutukset", "Verot ja maksut / Verot, maksut ja sakot", "Vakuutukset / Vakuutukset"]);
  });

  it("money to a person is never Ruoka, whatever its message says", () => {
    expect(places([paid("2026-10-09", 40, "Matti Meikalainen", "p2p", "RUOKAKAUPPA JA RAVINTOLA"), paid("2026-10-09", 40, "Esimerkkikauppa Oy", "groceries", "RUOKAKAUPPA")])).toEqual([
      "Raha-asiat / Maksut henkilöille",
      "Ruoka / Ruokakauppa",
    ]);
  });

  it("a category the table does not know is the line Muut menot of Raha-asiat, and a car bought is the line Auton osto", () => {
    const rows = [paid("2026-10-10", 50, "Esimerkki Oy", "no_such_category"), paid("2026-10-11", 9000, "Matti Meikalainen", "vehicle_purchase")];
    expect(places(rows)).toEqual(["Raha-asiat / Muut menot", "Auto / Auton osto"]);
    expect(places(rows, NO_CAR)).toEqual(["Raha-asiat / Muut menot", "Liikkuminen / Auton osto"]);
  });
});

describe("the theme Auto of a household that has not said how many cars it has", () => {
  const rows = [fuel("2026-10-01"), carInsurance(), vehicleTax(), carLoan(), lease()];
  const inAuto = ["Auto / Polttoaine", "Auto / Liikenne- ja autovakuutus", "Auto / Ajoneuvovero", "Auto / Rahoitus", "Auto / Leasing"];
  const noAuto = ["Liikkuminen / Auto, polttoaine ja pysäköinti", "Vakuutukset / Vakuutukset", "Verot ja maksut / Verot, maksut ja sakot", "Lainat ja luotot / Kulutusluotot", "Raha-asiat / Muut menot"];

  it("exists with six purchases of fuel or charging in the window, and with five every row stays in the theme of its category", () => {
    expect(places(rows, notAsked(6))).toEqual(inAuto);
    expect(places(rows, notAsked(5))).toEqual(noAuto);
  });

  it("follows the answer once there is one, whatever the purchases", () => {
    expect(places(rows, { answer: 0, purchases: 40 })).toEqual(noAuto);
    expect(places(rows, { answer: 1, purchases: 0 })).toEqual(inAuto);
    expect(places(rows, { answer: 2, purchases: 0 })).toEqual(inAuto);
  });

  it("counts purchases of fuel and of charging, not parking, not a purchase that came back whole and not the money back", () => {
    const four = [1, 2, 3, 4].map((d) => fuel(`2026-10-0${d}`));
    const rest = [
      paid("2026-10-06", 9, "EasyPark", "car"),
      paid("2026-10-07", 70, "Teboil Espoo", "car"),
      got("2026-10-08", 70, "Teboil Espoo", "car"),
      paid("2026-10-09", 30, "Esimerkkikauppa Oy", "groceries"),
    ];
    const count = (list: readonly Transaction[]) => fuelPurchases(createContext(list, [checking], TODAY).txs);
    expect(count([...four, ...rest])).toBe(4);
    // a purchase that came back in part is still one
    const partly = [paid("2026-10-10", 80, "Shell Espoo", "car"), got("2026-10-11", 20, "Shell Espoo", "car")];
    expect(count([...four, ...rest, ...partly])).toBe(5);
    expect(count([...four, ...rest, ...partly, paid("2026-10-12", 14, "K-Lataus", "car")])).toBe(6);
  });
});

describe("money back", () => {
  // the refund names the insurer and no car: its own words would put it on Vakuutukset
  const premium = carInsurance();
  const back = got("2026-10-25", 60, INSURER, "insurance", "PALAUTUS");
  // an insurer that was paid nothing: a compensation, which is income
  const claim = got("2026-10-26", 744, "Toinen Esimerkkivakuutus Oy", "insurance", "KORVAUS");
  const ctx = createContext([premium, back, claim, fuel("2026-10-02")], [checking], TODAY);

  it("lowers the theme and the line of the payment it takes back", () => {
    expect(ctx.returns.get(back.id)).toBe(premium.id);
    expect(places([premium, back, claim])).toEqual(["Auto / Liikenne- ja autovakuutus", "Auto / Liikenne- ja autovakuutus", "Vakuutukset / Vakuutukset"]);
    expect(sums(ctx, ctx.txs, HAS_CAR)).toEqual({ "Auto / Liikenne- ja autovakuutus": 15_000, "Auto / Polttoaine": 6_000 });
    expect(sums(ctx, ctx.txs, NO_CAR)).toEqual({ "Vakuutukset / Vakuutukset": 15_000, "Liikkuminen / Auto, polttoaine ja pysäköinti": 6_000 });
  });

  it("that takes nothing back is income: no theme has it, and the themes are Menot", () => {
    expect(ctx.txs.find((t) => t.id === claim.id)!.spend).toBe(0);
    expect(totalsOf(ctx.txs.map((t) => t.flows))).toMatchObject({ expenseCents: 21_000, incomeCents: 74_400 });
    expect(Object.values(sums(ctx, ctx.txs, HAS_CAR)).reduce((a, b) => a + b, 0)).toBe(21_000);
  });
});

describe("the themes add up to Menot", () => {
  const households = [...goldenHouseholds(), ...EVENTS.map((e) => kitHousehold(e))];
  const wholeMonth = (month: string) => ({ from: `${month}-01`, to: `${month}-${daysInMonth(month)}` });
  const lineIds = new Map(THEMES.map((t) => [t.id, new Set(t.lines.map((l) => l.id))]));
  const known = new Set(THEMES.flatMap((t) => (t.id === "car" ? [] : t.lines.map((l) => l.id))));

  /** Holds the rows of one period against its Menot, with and without the theme Auto. Returns what Auto took. */
  function check(ctx: AnalysisContext, rows: readonly AnalysisTx[], name: string): number {
    const spent = totalsOf(rows.map((t) => t.flows)).expenseCents;
    let inAuto = 0;
    for (const cars of [HAS_CAR, NO_CAR, notAsked(fuelPurchases(rows))]) {
      const byTheme = new Map<string, number>();
      for (const t of rows) {
        if (!t.spend) continue;
        const at = themeOf(ctx, t, cars);
        expect(lineIds.get(at.theme)?.has(at.line), `${name}: ${at.theme} has the line ${at.line}`).toBe(true);
        byTheme.set(at.theme, (byTheme.get(at.theme) ?? 0) + t.spend);
      }
      expect([...byTheme.values()].reduce((a, b) => a + b, 0), name).toBe(spent);
      if (cars === HAS_CAR) inAuto = byTheme.get("car") ?? 0;
      if (cars !== NO_CAR) continue;
      // without Auto no words move a row: a theme is the sum of its categories, as Menot kategorioittain has them.
      // Raha-asiat also has the categories the table does not know (a seeded household's own rule makes one)
      for (const theme of THEMES) {
        const mine = (category: string) => (theme.id === "other" && !known.has(category)) || (theme.id !== "car" && lineIds.get(theme.id)!.has(category));
        const ofCategories = rows.reduce((sum, t) => (mine(t.category) ? sum + t.spend : sum), 0);
        expect(byTheme.get(theme.id) ?? 0, `${name}: ${theme.heading}`).toBe(ofCategories);
      }
    }
    return inAuto;
  }

  it.each(households.map((h) => [h.name, h] as const))(
    "%s: in both views, in every month and over the whole history, whatever is known of the cars",
    (_name, h) => {
      const rows = enrich(h.txs, h.accounts, h.rules);
      const halves = new Map(h.accounts.map((a) => [a.id, HALF]));
      const views = { "Koko talous": createContext(rows, h.accounts, h.today), own: createContext(applyUse(rows, h.accounts, halves), h.accounts, h.today) };
      for (const [view, ctx] of Object.entries(views)) {
        let months = 0;
        for (let month = monthOf(ctx.dataFrom!); month <= monthOf(ctx.today); month = addMonths(month, 1)) {
          check(ctx, inDays(ctx, toDayRange(wholeMonth(month))), `${view} ${month}`);
          months += 1;
        }
        expect(months).toBeGreaterThan(10);
        // every fixture household buys fuel, so the theme Auto is not empty here
        expect(check(ctx, ctx.txs, `${view}, the whole history`), view).toBeGreaterThan(0);
        for (const [id, payment] of ctx.returns) {
          const pair = [id, payment].map((x) => themeOf(ctx, ctx.txs.find((t) => t.id === x)!, HAS_CAR));
          expect(pair[0], `${view}: the money back ${id}`).toEqual(pair[1]);
        }
      }
    },
    60_000,
  );
});

describe("the car's cost in Säästövinkit", () => {
  it("has the lines and the sums of the theme Auto: one classifier for both", () => {
    const parts = [carPart.hit(FRAME), { txs: rowsOf("lease", carPart.lease(FRAME)) }, { txs: rowsOf("dealer", carPart.dealer(FRAME)) }, { txs: rowsOf("loan", carPart.carLoan(FRAME)) }];
    const input = householdInput(joinHousehold(parts));
    const window = new Set(areaInputOf(input).months);
    const byLine = new Map<string, number>();
    for (const t of input.ctx.txs) {
      const at = themeOf(input.ctx, t, HAS_CAR);
      if (at.theme === "car" && window.has(monthOf(t.bookingDate))) byLine.set(at.line, (byLine.get(at.line) ?? 0) + netSpend(t));
    }
    const summary = buildOptimise(input).areas.find((a) => a.id === "car")!.summary!;
    const lines = THEMES.find((t) => t.id === "car")!.lines.filter((l) => byLine.get(l.id));
    expect(lines.map((l) => l.id)).toEqual(["fuel", "parking", "service", "inspection", "insurance", "tax", "finance", "lease", "purchase"]);
    // the summary prints the total and the distance too, and says of the car bought that it is not in the total
    const printed = summary.lines.filter((l) => !/^(Yhteensä|Ajokilometrit|Kilometriä kohden)/.test(l.label));
    expect(printed.map((l) => [l.label.replace(/,.*/, ""), l.value])).toEqual(lines.map((l) => [l.heading, formatEur(byLine.get(l.id)!, false)]));
  });
});
