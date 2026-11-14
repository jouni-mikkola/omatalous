/**
 * One concept, one number, on every page that shows it. The same households as `figures-routes.test.ts` (demo, kit and
 * a made-up one) are read through the routes of the pages, and every month of Yhteenveto's chart is held to the
 * figures the other pages say for it. `figures-routes.test.ts` holds the shared figures of one month; this file holds
 * the concepts that cross pages with another name or another route.
 *
 * `PAGES` lists what a household sees. Each reader is a component and the field it draws, read from the component
 * itself: a field the page does not draw is no reader, since an agreement between figures nobody sees protects nobody.
 *
 * - Menot of a month: Tiles (Menot), MonthBars (spending bar), Kuukausi and Rahankäyttö (Menot kuukausittain).
 * - Ansaitut and odotetut tulot of a month: Tiles (Tulot), MonthBars (income bar) and Kuukausi's income line.
 * - Varat velkojen jälkeen: Tiles (Varat), Holdings under Saldot and Saldot's own figures.
 * - The usual month: MonthBars' dashed line and Rahankäyttö's typical month.
 * - The usual spending up to today in the running month: Tiles (Menot) and Kuukausi.
 *
 * `API_INVARIANTS` lists figures the routes must agree on and no page draws (the dashboard's `totals`, the cash flow
 * table, the earned and usual income of the Tulot report). They keep one definition under several routes (ADR 0004). A
 * page that starts to draw one adds its reader to `PAGES`.
 *
 * A reader that does not apply to a month (a tile of the running month, a month outside the chart) returns undefined and
 * is left out. A reader that returns no number in any month is a test of its own, so a wrong field name cannot drop out
 * of the comparison unseen.
 *
 * A mismatch is a bug in a page or in a definition, never in this file: the test does not bend to the figure.
 */
import { addMonths, monthEnd } from "@banking/core";
import { beforeAll, describe, expect, it } from "vitest";
import { KIT_TODAY } from "../../../packages/core/test/kit/index.ts";
import { FIGURES_TODAY, loadFiguresHousehold } from "./figures-household.ts";
import { setupApp } from "./helpers.ts";
import { loadKit } from "./kit-load.ts";

type App = Awaited<ReturnType<typeof setupApp>>;
// the answers are read as the pages read them, by field name
type Answer = any;
type Value = number | null | undefined;

interface Household {
  name: string;
  day: string;
  load: (app: App) => Promise<void>;
}

const HOUSEHOLDS: readonly Household[] = [
  {
    name: "demo",
    day: "2026-10-09",
    load: async (app) => {
      expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    },
  },
  { name: "kit", day: KIT_TODAY, load: loadKit },
  { name: "made-up", day: FIGURES_TODAY, load: (app) => loadFiguresHousehold(app) },
];

/** One row of the cash flow table (`/api/export/report.csv?report=cashflow`), in cents. */
interface CashRow {
  incomeCents: number;
  consumptionCents: number;
  debtCents: number;
  savedCents: number;
  borrowedCents: number;
  leftCents: number;
}

/** What the readers see for one month of the chart. */
interface Snap {
  month: string;
  running: boolean;
  /** The running month's dashboard: the tiles, `overview` (the chart, whatever the range) and the holdings of today. */
  runDash: Answer;
  /** The twelve months up to today: `income`, `spendingMonths` and `balances`. */
  window: Answer;
  /** The month's row of the cash flow table. */
  cash: CashRow | undefined;
  /** The month's own range, for the running month and the one before only. */
  own?: { dash: Answer; reports: Answer };
}

const monthIn = (list: Answer, month: string): Answer => list?.find((m: Answer) => m.month === month);

/** Kuukausi of an earlier month: the usual view of the change report (pages/reports/Month.tsx). */
const kuukausi = (s: Snap) => s.own?.reports.spendingChange.views.find((v: Answer) => v.view === "expected" && v.change.target.months.join() === s.month)?.change;

/** The sum of the cash flow row's parts as docs/MONEY_FLOWS.md gives Tulos. */
const leftOf = (p: { incomeCents: number; borrowedCents: number; consumptionCents: number; debtCents: number; savedCents: number }) =>
  p.incomeCents + p.borrowedCents - p.consumptionCents - p.debtCents - p.savedCents;

interface Concept {
  id: string;
  name: string;
  /** The months read: every month of the chart, the running month and the one before, or the running month alone. */
  months: "window" | "own" | "running";
  /** A reader is the component (or the route) and the field it draws. */
  readers: Record<string, (s: Snap) => Value>;
}

/** What the household sees: each reader is the field a component of the page renders. */
const PAGES: readonly Concept[] = [
  {
    id: "T1",
    name: "Menot of a month",
    months: "window",
    readers: {
      "Tiles Menot: home.pace.spentCents, else nyt.pace.spentCents": (s) => (s.running ? (s.runDash.home.pace?.spentCents ?? s.runDash.nyt.pace.spentCents) : undefined),
      "MonthBars spending bar: overview.months[].spendCents": (s) => monthIn(s.runDash.overview.months, s.month)?.spendCents,
      "Month (Kuukausi): thisMonth.spentCents, else spendingChange nowCents": (s) => (s.running ? s.own?.reports.thisMonth.spentCents : kuukausi(s)?.nowCents),
      "SpendingMonths (Rahankäyttö) months table: totals[]": (s) => s.window.spendingMonths.totals[s.window.spendingMonths.months.indexOf(s.month)],
    },
  },
  {
    id: "T2a",
    name: "Ansaitut tulot of a month",
    months: "window",
    readers: {
      "Tiles Tulot: overview.income.cents": (s) => (s.running ? s.runDash.overview.income.cents : undefined),
      "MonthBars income bar: overview.months[].incomeCents": (s) => monthIn(s.runDash.overview.months, s.month)?.incomeCents,
      "Month (Kuukausi) income line: income.months[].earnedCents": (s) => monthIn(s.own?.reports.income.months, s.month)?.earnedCents,
    },
  },
  {
    id: "T2c",
    name: "Odotetut tulot of a month",
    months: "window",
    readers: {
      "Tiles Tulot: overview.income.usualCents": (s) => (s.running ? s.runDash.overview.income.usualCents : undefined),
      "Month (Kuukausi) income line: income.months[].usualCents": (s) => monthIn(s.own?.reports.income.months, s.month)?.usualCents,
    },
  },
  {
    id: "T4",
    name: "Varat velkojen jälkeen today",
    months: "running",
    readers: {
      "Tiles Varat: holdings.netCents": (s) => s.runDash.holdings.netCents,
      "Balances (Saldot) Holdings: balances.holdings.netCents": (s) => s.window.balances.holdings.netCents,
      // Balances draws this row for today, and only for a household that saved a loan
      "Balances (Saldot) accounts-less-debt row: accountsLessDebt[last]": (s) => (s.window.balances.debt.savedCents > 0 ? s.window.balances.accountsLessDebt.at(-1) : undefined),
      // the datum is the newest known day of the line; the accounts added up and the cards with them are the same figure unless a saved loan with no account holds some of the debt
      "Balances (Saldot) datum: daily.cents, newest known day": (s) => (s.window.balances.debt.savedCents === 0 ? s.window.balances.daily.cents.findLast((v: number | null) => v !== null) : undefined),
    },
  },
  {
    id: "T5a",
    name: "The usual month's spending",
    months: "running",
    readers: {
      "MonthBars dashed line: overview.usualSpendCents": (s) => s.runDash.overview.usualSpendCents,
      "SpendingMonths (Rahankäyttö) typical total: typicalCents": (s) => s.window.spendingMonths.typicalCents,
    },
  },
  {
    id: "T5b",
    name: "The usual spending up to today in the running month",
    months: "running",
    readers: {
      // Tiles draws expectedCents inside the usual range and the difference to it outside, so the expected is the spending less that difference
      "Tiles Menot line: home.pace.expectedCents, else spentCents less diffCents": (s) => {
        const pace = s.runDash.home.pace;
        return pace ? (pace.position === "within" ? pace.expectedCents : pace.spentCents - pace.diffCents) : undefined;
      },
      "Month (Kuukausi) expected column: thisMonth.expectedCents": (s) => s.own?.reports.thisMonth.expectedCents,
    },
  },
];

/** What the routes must agree on and no page draws. */
const API_INVARIANTS: readonly Concept[] = [
  {
    id: "A1",
    name: "Menot of a month: dashboard totals, cash flow table and the chart's spending",
    months: "window",
    readers: {
      "dashboard totals.expenseCents": (s) => s.own?.dash.totals.expenseCents,
      "cash flow Kulutus + Velanhoito": (s) => (s.cash ? s.cash.consumptionCents + s.cash.debtCents : undefined),
      "dashboard overview.months[].spendCents": (s) => monthIn(s.runDash.overview.months, s.month)?.spendCents,
    },
  },
  {
    id: "A2a",
    name: "Ansaitut tulot of a month: income report and the chart's income",
    months: "window",
    readers: {
      "income report months[].earnedCents": (s) => monthIn(s.window.income.months, s.month)?.earnedCents,
      "dashboard overview.months[].incomeCents": (s) => monthIn(s.runDash.overview.months, s.month)?.incomeCents,
    },
  },
  {
    id: "A2b",
    name: "Tulot (all income) of a month",
    months: "window",
    readers: {
      "dashboard totals.incomeCents": (s) => s.own?.dash.totals.incomeCents,
      "income report months[].totalCents": (s) => monthIn(s.window.income.months, s.month)?.totalCents,
      "cash flow Tulot": (s) => s.cash?.incomeCents,
    },
  },
  {
    id: "A2c",
    name: "Odotetut tulot of a month: income report and the tile's usual",
    months: "window",
    readers: {
      "dashboard overview.income.usualCents": (s) => (s.running ? s.runDash.overview.income.usualCents : undefined),
      "income report months[].usualCents": (s) => monthIn(s.window.income.months, s.month)?.usualCents,
    },
  },
  {
    id: "A3",
    name: "Tulos of a month",
    months: "window",
    readers: {
      "cash flow Tulos": (s) => s.cash?.leftCents,
      "cash flow: tulot + luotto - kulutus - velanhoito - säästö": (s) => (s.cash ? leftOf(s.cash) : undefined),
      "dashboard totals.leftCents": (s) => s.own?.dash.totals.leftCents,
      "dashboard totals: tulot + luotto - kulutus - velanhoito - säästö": (s) => (s.own ? leftOf(s.own.dash.totals) : undefined),
    },
  },
];

const snapsFor = (concept: Concept, snaps: readonly Snap[]) =>
  snaps.filter((s) => (concept.months === "window" ? true : concept.months === "own" ? s.own !== undefined : s.running));

describe.each(HOUSEHOLDS.map((h) => [h.name, h] as const))("%s", (_, h) => {
  let snaps: Snap[] = [];

  beforeAll(async () => {
    const app = await setupApp({}, undefined, { now: () => new Date(`${h.day}T10:00:00Z`) });
    await h.load(app);
    const get = async (path: string): Promise<Answer> => {
      const res = await app.admin.call("GET", path);
      expect(res.status, path).toBe(200);
      return res.body;
    };
    const running = h.day.slice(0, 7);
    const range = (month: string, to: string) => `from=${month}-01&to=${to}&scope=own`;
    const year = range(addMonths(running, -11), h.day);
    const twelve = await get(`/api/reports?${year}&reports=income,spendingMonths,balances`);
    const csv: string = await get(`/api/export/report.csv?report=cashflow&${year}`);
    const cash = new Map<string, CashRow>();
    // the first line is the heading, which starts with the byte order mark; the cells of a figure are plain numbers with a decimal comma
    for (const line of csv.slice(csv.indexOf("\n") + 1).trim().split("\r\n")) {
      const c = line.split(";");
      const cents = (i: number) => Math.round(Number(c[i]!.replace(",", ".")) * 100);
      cash.set(c[0]!, { incomeCents: cents(1), consumptionCents: cents(2), debtCents: cents(3), savedCents: cents(4), borrowedCents: cents(5), leftCents: cents(8) });
    }
    const previous = addMonths(running, -1);
    const ownOf = async (month: string, to: string) => ({
      dash: await get(`/api/dashboard?${range(month, to)}`),
      reports: await get(`/api/reports?${range(month, to)}&reports=income,thisMonth,spendingChange`),
    });
    const own = new Map([
      [previous, await ownOf(previous, monthEnd(previous))],
      [running, await ownOf(running, h.day)],
    ]);
    const runDash = own.get(running)!.dash;
    snaps = (twelve.spendingMonths.months as string[]).map((month) => ({ month, running: month === running, runDash, window: twelve, cash: cash.get(month), own: own.get(month) }));
  }, 180_000);

  const holdAll = (concepts: readonly Concept[]) => {
    for (const concept of concepts) {
      // a reader that throws or tells no number in any month is a fault of its own and not a mismatch
      it(`${concept.id}: ${concept.name}: every reader reads a number`, () => {
        for (const [reader, read] of Object.entries(concept.readers)) {
          const told = snapsFor(concept, snaps).map(read);
          expect(
            told.some((value) => typeof value === "number"),
            `${concept.id}: "${reader}" tells no number in any month`,
          ).toBe(true);
        }
      });
      it(`${concept.id}: ${concept.name}`, () => {
        const mismatches: string[] = [];
        let compared = 0;
        for (const s of snapsFor(concept, snaps)) {
          // a reader is named by its place in the concept's list, so a long line of the log keeps every figure
          const told = Object.entries(concept.readers)
            .map(([reader, read], at) => [`${at}:${reader.slice(0, 12)}`, read(s)] as const)
            .filter(([, value]) => value !== undefined);
          if (told.length < 2) continue;
          compared++;
          if (told.some(([, value]) => value !== told[0]![1])) mismatches.push(`${s.month}: ${told.map(([reader, value]) => `${reader}=${value}`).join(" ")}`);
        }
        // a concept read by one place only is no agreement: some month has two readers at least
        expect(compared, `${concept.id}: no month is read by two places`).toBeGreaterThan(0);
        // the message carries each month's figures, which a long value of `toEqual` would cut short
        expect(mismatches.length, mismatches.join(" || ")).toBe(0);
      });
    }
  };

  describe("pages", () => holdAll(PAGES));
  describe("API invariants", () => holdAll(API_INVARIANTS));
});
