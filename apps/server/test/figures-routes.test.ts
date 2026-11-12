/**
 * One figure, one number on every page: each figure the pages share, read through the route of every page that shows
 * it, for the demo household, the kit household and a made-up one with own transfers, savings, a loan, a card's bills,
 * refunds, friends' shares, a pending purchase and a row whose category the user set (figures-household.ts). The
 * readers are the fields the pages draw: Yhteenveto (the running month's `/api/dashboard`: MonthPace, Where, Answer),
 * Raportit (`/api/reports`: Kuukausi, Rahankäyttö, Tulot, Kiinteät menot), Tapahtumat (`/api/transactions`), Laskut
 * (`/api/recurring` and the dashboard's `ahead`, as BeforePayday lists it) and "Miksi?" (`/api/explain`). A complete
 * month and the running month are both read; Yhteenveto shows only the running one. Two figures that may differ by
 * what they count have two names; this file holds only the ones that are one figure.
 */
import { addMonths, cancelledSubjects, fixedMonthlyCents, monthEnd, NO_INPUTS } from "@banking/core";
import { beforeAll, describe, expect, it } from "vitest";
import { KIT_TODAY } from "../../../packages/core/test/kit/index.ts";
import { FIGURES_TODAY, loadFiguresHousehold } from "./figures-household.ts";
import { setupApp } from "./helpers.ts";
import { loadKit } from "./kit-load.ts";

type App = Awaited<ReturnType<typeof setupApp>>;

interface Loaded {
  name: string;
  day: string;
  load: (app: App) => Promise<void>;
}

const HOUSEHOLDS: readonly Loaded[] = [
  {
    name: "demo",
    day: "2026-10-09",
    load: async (app) => {
      expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    },
  },
  { name: "kit", day: KIT_TODAY, load: loadKit },
  { name: "made-up", day: FIGURES_TODAY, load: (app) => loadFiguresHousehold(app) },
  // the same household with its card connected in August: the months before have the card's bills alone
  { name: "made-up, card connected later", day: FIGURES_TODAY, load: (app) => loadFiguresHousehold(app, "2026-08") },
];

/** The values one figure has on the pages that show it, by reader; a reader that has no value for the household is left out. */
type Readings = Record<string, number | string | null | undefined>;

function expectOne(figure: string, readings: Readings) {
  const told = Object.entries(readings).filter(([, v]) => v !== undefined);
  expect(told.length, `${figure}: read by two pages at least`).toBeGreaterThan(1);
  const [first, value] = told[0]!;
  for (const [reader, v] of told) expect(v, `${figure}: ${reader} against ${first}`).toBe(value);
}

/** A month's own range and the twelve months up to it, as Raportit asks for them. */
const ranges = (month: string, to: string) => ({ month: `from=${month}-01&to=${to}&scope=own`, year: `from=${addMonths(month, -11)}-01&to=${to}&scope=own` });

describe.each(HOUSEHOLDS.map((h) => [h.name, h] as const))("%s", (_, h) => {
  let app: App;
  const get = async (path: string) => {
    const res = await app.admin.call("GET", path);
    expect(res.status, path).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    app = await setupApp({}, undefined, { now: () => new Date(`${h.day}T10:00:00Z`) });
    await h.load(app);
  }, 120_000);

  const running = h.day.slice(0, 7);
  const months = [
    ["the complete month before", addMonths(running, -1), monthEnd(addMonths(running, -1))],
    ["the running month", running, h.day],
  ] as const;

  describe.each(months)("%s", (label, month, to) => {
    const q = ranges(month, to);
    const isRunning = label === "the running month";
    let dash: any;
    let rep: any;
    let year: any;
    let list: any;

    beforeAll(async () => {
      // Yhteenveto asks for the running month alone (pages/Overview.tsx)
      dash = isRunning ? await get(`/api/dashboard?${q.month}`) : null;
      // Kuukausi reads `thisMonth` for the running month and `spendingChange` for an earlier one (pages/reports/Month.tsx)
      rep = await get(`/api/reports?${q.month}&reports=categories,income,thisMonth,spendingChange,spendingMonths`);
      year = await get(`/api/reports?${q.year}&reports=income,spendingMonths`);
      list = await get(`/api/transactions?${q.month}&limit=1`);
    });

    /** Kuukausi of an earlier month: the usual view of the change report, when the history holds one. */
    const kuukausi = () => rep.spendingChange.views.find((v: any) => v.view === "expected" && v.change.target.months.join() === month)?.change;

    it("Menot of the month", () => {
      const at = year.spendingMonths.months.indexOf(month);
      expectOne("Menot", {
        // MonthPace: the sentence's sum, from the usual comparison or, with none, from `nyt`; its chart's last point
        "Yhteenveto Kuukausi": isRunning ? (dash.home.pace?.spentCents ?? dash.nyt.pace.spentCents) : undefined,
        "Yhteenveto chart": isRunning ? dash.pace.currentTotal : undefined,
        // Where: the largest categories and the rest in one sum under them
        "Yhteenveto Suurimmat menot added up": isRunning ? dash.top.rows.reduce((s: number, r: any) => s + r.cents, 0) + dash.top.otherCents : undefined,
        "Kuukausi": isRunning ? rep.thisMonth.spentCents : kuukausi()?.nowCents,
        "Rahankäyttö Kategoriat": rep.categories.totalCents,
        "Rahankäyttö Menot kuukausittain, the month": rep.spendingMonths.totals.at(-1),
        "Rahankäyttö Menot kuukausittain, 12 kk": year.spendingMonths.totals[at],
      });
    });

    it("Tulot of the month", () => {
      expectOne("Tulot", {
        "Kuukausi": rep.income.months.find((m: any) => m.month === month)?.totalCents ?? 0,
        "Tulot kuukausittain, 12 kk": year.income.months.find((m: any) => m.month === month)?.totalCents ?? 0,
      });
    });

    it("Tapahtumat counts the rows of the month once, in the list and in its bars", () => {
      const all = list.histogram.bins.reduce((s: number, b: any) => s + b.count, 0);
      expectOne("tapahtumaa", { "Tapahtumat count": list.total, "Tapahtumat bars": all });
    });

    it("a category's sum and its number of rows", async () => {
      // every category Rahankäyttö's Kategoriat lists for the month
      const categories = rep.categories.groups.flatMap((g: any) => g.categories).filter((c: any) => c.category);
      expect(categories.length).toBeGreaterThan(3);
      const at = year.spendingMonths.months.indexOf(month);
      for (const c of categories) {
        const rows = await get(`/api/transactions?${q.month}&category=${c.category}&limit=1`);
        const why = await get(`/api/explain?figure=spend.category&category=${c.category}&${q.month}`);
        const name = `${c.category} in ${month}`;
        const gap = kuukausi()?.categories.find((x: any) => x.category === c.category);
        expectOne(`${name} sum`, {
          "Yhteenveto Suurimmat menot": isRunning ? dash.top.rows.find((r: any) => r.category === c.category)?.cents : undefined,
          "Rahankäyttö Kategoriat": c.totalCents,
          // a category whose refunds cancel its purchases is 0 € in Kategoriat and no row in Menot kuukausittain: one figure
          "Menot kuukausittain, the month": rep.spendingMonths.categories.find((x: any) => x.category === c.category)?.totalCents ?? 0,
          "Menot kuukausittain, 12 kk": year.spendingMonths.categories.find((x: any) => x.category === c.category)?.values[at] ?? 0,
          Kuukausi: isRunning ? rep.thisMonth.categories.find((x: any) => x.category === c.category)?.spentCents : gap?.nowCents,
          "Tapahtumat with the category chosen": -rows.netCents + 0,
          "Miksi?": why.cents,
        });
        expectOne(`${name} rows`, {
          "Rahankäyttö Kategoriat": c.count,
          "Tapahtumat with the category chosen": rows.total,
          "Miksi?": why.rows.length,
        });
      }
    });
  });

  it("Kiinteät menot: Raportit, Laskut and Miksi?", async () => {
    const fixed = await get(`/api/reports?${ranges(running, h.day).year}&reports=fixedCosts`);
    const { series, marks } = await get("/api/recurring");
    const why = await get(`/api/explain?figure=bills.fixed&${ranges(running, h.day).month}`);
    expectOne("Kiinteät menot", {
      "Raportit > Kiinteät menot": fixed.fixedCosts.monthlyCents,
      // Laskut adds the series up with core's function, as Bills.tsx does
      Laskut: fixedMonthlyCents(series, cancelledSubjects({ ...NO_INPUTS, marks })),
      "Miksi?": why.cents,
    });
  });

  it("Maksut ennen palkkapäivää: Yhteenveto's sum and the rows Laskut lists under it", async () => {
    const dash = await get(`/api/dashboard?${ranges(running, h.day).month}`);
    const left = dash.nyt?.left;
    if (!left?.known || !dash.ahead?.payday) return;
    // the rows of BeforePayday.tsx: the payments of `ahead.rows` before the payday, the pay itself left out
    const rows = dash.ahead.rows.filter((r: any) => r.cents !== null && r.cents < 0 && r.source !== "income" && r.date < left.payday.date);
    expectOne("Maksut ennen palkkapäivää", { "Yhteenveto and Laskut": left.billsCents, "Laskut, its rows added up": rows.reduce((s: number, r: any) => s - r.cents, 0) });
  });

  it("the reason a month has no usual: Yhteenveto and Kuukausi, the running month and the one before", async () => {
    const now = ranges(running, h.day).month;
    const before = ranges(addMonths(running, -1), monthEnd(addMonths(running, -1))).month;
    const dash = await get(`/api/dashboard?${now}`);
    const rep = await get(`/api/reports?${now}&reports=thisMonth,spendingChange`);
    const earlier = await get(`/api/reports?${before}&reports=spendingChange`);
    expectOne("no usual, running month", { Yhteenveto: dash.home.paceGap, Kuukausi: rep.thisMonth.gapReason, "Kuukausi, the change report": rep.spendingChange.gapReason });
    // no usual figure a day may stand beside a page that says the usual is missing
    if (dash.home.paceGap !== null) expect(dash.nyt.usualPerDayCents ?? null).toBeNull();
    if (h.name === "made-up, card connected later") {
      // nine months of history: the usual is missing for the card's purchases, not for the months
      expect(dash.home.paceGap).toBe("cards");
      expect(earlier.spendingChange.gapReason).toBe("cards");
    }
    if (h.name === "made-up") expect(earlier.spendingChange.gapReason).toBeNull();
  });

  it("Odotettu of the running month: Yhteenveto and Kuukausi", async () => {
    const dash = await get(`/api/dashboard?${ranges(running, h.day).month}`);
    const rep = await get(`/api/reports?${ranges(running, h.day).month}&reports=thisMonth`);
    expectOne("Odotettu", { Yhteenveto: dash.home.pace?.expectedCents ?? null, Kuukausi: rep.thisMonth.expectedCents });
  });
});
