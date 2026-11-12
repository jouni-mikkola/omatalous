/**
 * One figure, one number on every page: each figure the pages share, read through the route of every page that shows
 * it, for the demo household, the kit household and a made-up one with own transfers, savings, a loan, a card's bills,
 * refunds, friends' shares, a pending purchase and a row whose category the user set (figures-household.ts). The
 * readers are the fields the pages draw: Yhteenveto (`/api/dashboard`), Raportit (`/api/reports`: Kuukausi,
 * Rahankäyttö, Tulot, Kiinteät menot), Tapahtumat (`/api/transactions`), Laskut (`/api/recurring`, `/api/ahead`) and
 * "Miksi?" (`/api/explain`). A complete month and the running month are both read. Two figures that may differ by
 * what they count have two names; this file holds only the ones that are one figure.
 */
import { addMonths, cancelledSubjects, fixedMonthlyCents, monthEnd } from "@banking/core";
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
      dash = await get(`/api/dashboard?${q.month}`);
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
        "Yhteenveto totals": dash.totals.expenseCents,
        "Yhteenveto categories added up": dash.categories.reduce((s: number, c: any) => s + c.cents, 0),
        "Yhteenveto pace": isRunning ? dash.pace.currentTotal : undefined,
        "Yhteenveto month figure": isRunning ? dash.home.pace?.spentCents : undefined,
        "Kuukausi": isRunning ? rep.thisMonth.spentCents : kuukausi()?.nowCents,
        "Rahankäyttö Kategoriat": rep.categories.totalCents,
        "Rahankäyttö Menot kuukausittain, the month": rep.spendingMonths.totals.at(-1),
        "Rahankäyttö Menot kuukausittain, 12 kk": year.spendingMonths.totals[at],
      });
    });

    it("Tulot of the month", () => {
      expectOne("Tulot", {
        "Yhteenveto totals": dash.totals.incomeCents,
        "Tulot, the month": rep.income.months.find((m: any) => m.month === month)?.totalCents ?? 0,
        "Tulot kuukausittain, 12 kk": year.income.months.find((m: any) => m.month === month)?.totalCents ?? 0,
      });
    });

    it("Tapahtumat counts the rows of the month once, in the list and in its bars", () => {
      const all = list.histogram.bins.reduce((s: number, b: any) => s + b.count, 0);
      expectOne("tapahtumaa", { "Tapahtumat count": list.total, "Tapahtumat bars": all });
    });

    it("a category's sum and its number of rows", async () => {
      const categories = dash.categories.filter((c: any) => c.category !== null);
      expect(categories.length).toBeGreaterThan(3);
      const inReport = new Map<string, any>(rep.categories.groups.flatMap((g: any) => g.categories).map((c: any) => [c.category, c]));
      const at = year.spendingMonths.months.indexOf(month);
      for (const c of categories) {
        const rows = await get(`/api/transactions?${q.month}&category=${c.category}&limit=1`);
        const why = await get(`/api/explain?figure=spend.category&category=${c.category}&${q.month}`);
        const report = inReport.get(c.category);
        const name = `${c.category} in ${month}`;
        const gap = kuukausi()?.categories.find((x: any) => x.category === c.category);
        expectOne(`${name} sum`, {
          Yhteenveto: c.cents,
          "Rahankäyttö Kategoriat": report?.totalCents ?? null,
          "Menot kuukausittain, the month": rep.spendingMonths.categories.find((x: any) => x.category === c.category)?.totalCents ?? null,
          "Menot kuukausittain, 12 kk": year.spendingMonths.categories.find((x: any) => x.category === c.category)?.values[at] ?? null,
          Kuukausi: isRunning ? rep.thisMonth.categories.find((x: any) => x.category === c.category)?.spentCents : gap?.nowCents,
          "Tapahtumat with the category chosen": -rows.netCents,
          "Miksi?": why.cents,
        });
        expectOne(`${name} rows`, {
          Yhteenveto: c.count,
          "Rahankäyttö Kategoriat": report?.count ?? null,
          "Tapahtumat with the category chosen": rows.total,
          "Miksi?": why.rows.length,
        });
      }
    });
  });

  it("Kiinteät menot: Yhteenveto, Raportit, Laskut and Miksi?", async () => {
    const dash = await get(`/api/dashboard?${ranges(running, h.day).month}`);
    const fixed = await get(`/api/reports?${ranges(running, h.day).year}&reports=fixedCosts`);
    const { series, marks } = await get("/api/recurring");
    const why = await get(`/api/explain?figure=bills.fixed&${ranges(running, h.day).month}`);
    expectOne("Kiinteät menot", {
      Yhteenveto: dash.fixedMonthlyCents,
      "Raportit > Kiinteät menot": fixed.fixedCosts.monthlyCents,
      // Laskut adds the series up with core's function, as Bills.tsx does
      Laskut: fixedMonthlyCents(series, cancelledSubjects({ marks, expectedBills: [], loans: [] } as never, h.day)),
      "Miksi?": why.cents,
    });
  });

  it("Erääntyvät maksut: Yhteenveto's sum row and Laskut", async () => {
    const dash = await get(`/api/dashboard?${ranges(running, h.day).month}`);
    const { ahead } = await get("/api/ahead");
    expectOne("Erääntyvät maksut", { Yhteenveto: dash.home.runway?.sum?.paymentsCents ?? null, Laskut: ahead.totals.dueCents });
  });

  it("the reason a month has no usual: Yhteenveto and Kuukausi, the running month and the one before", async () => {
    const now = ranges(running, h.day).month;
    const before = ranges(addMonths(running, -1), monthEnd(addMonths(running, -1))).month;
    const dash = await get(`/api/dashboard?${now}`);
    const rep = await get(`/api/reports?${now}&reports=thisMonth,spendingChange`);
    const earlier = await get(`/api/reports?${before}&reports=spendingChange`);
    expectOne("no usual, running month", { Yhteenveto: dash.home.paceGap, Kuukausi: rep.thisMonth.gapReason, "Kuukausi, the change report": rep.spendingChange.gapReason });
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
