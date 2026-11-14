/**
 * One concept, one number, on every page that shows it. The same households as `figures-routes.test.ts` (demo, kit and
 * a made-up one) are read through the routes of the pages, and every month of Yhteenveto's chart is held to the
 * figures the other pages say for it. `figures-routes.test.ts` holds the shared figures of one month; this file holds
 * the concepts that cross pages with another name or another route:
 *
 * - Menot of a month: the Menot tile, the chart's spending bar, the dashboard's totals, Kuukausi, Rahankäyttö and the
 *   cash flow table (consumption and debt service).
 * - Tulot: earned income (tile, chart, Tulot and Kuukausi), all income (the totals, Tulot and the cash flow table) and
 *   the usual income.
 * - Tulos: the cash flow table's and the totals' own figure, and the sum of their parts (docs/MONEY_FLOWS.md).
 * - Varat velkojen jälkeen: the tile, Tilit ja kortit and the last point of Saldot.
 * - The usual month: the chart's dashed line, Rahankäyttö's typical month and the usual spending of the first page.
 *
 * The registry `CONCEPTS` is the list: a concept, the months it is read for, and each place that shows it with the
 * field it draws. A page that shows a figure of a concept already here adds one line to its readers. A reader that
 * does not apply to a month (a tile of the running month, a month outside the chart) returns undefined and is left out.
 *
 * A mismatch is a bug in a page or in a definition, never in this file: the test does not bend to the figure. One that
 * is not fixed yet is a `KNOWN` entry, which runs the concept as `it.fails` so the suite stays green and the gap is
 * recorded; the fix removes the entry (ADR 0004: one owner per figure).
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
  /** The key of `KNOWN`. */
  id: string;
  name: string;
  /** The months read: every month of the chart, the running month and the one before, or the running month alone. */
  months: "window" | "own" | "running";
  readers: Record<string, (s: Snap) => Value>;
}

const CONCEPTS: readonly Concept[] = [
  {
    id: "T1",
    name: "Menot of a month",
    months: "window",
    readers: {
      "Yhteenveto Menot-laatta": (s) => (s.running ? (s.runDash.home.pace?.spentCents ?? s.runDash.nyt.pace.spentCents) : undefined),
      "Yhteenveto Tulot ja menot (kaavio)": (s) => monthIn(s.runDash.overview.months, s.month)?.spendCents,
      "Yhteenveto totals.expenseCents": (s) => s.own?.dash.totals.expenseCents,
      "Raportit Kuukausi": (s) => (s.running ? s.own?.reports.thisMonth.spentCents : kuukausi(s)?.nowCents),
      "Rahankäyttö Menot kuukausittain": (s) => s.window.spendingMonths.totals[s.window.spendingMonths.months.indexOf(s.month)],
      "Kassavirta Kulutus + Velanhoito": (s) => (s.cash ? s.cash.consumptionCents + s.cash.debtCents : undefined),
    },
  },
  {
    id: "T2a",
    name: "Ansaitut tulot of a month",
    months: "window",
    readers: {
      "Yhteenveto Tulot-laatta": (s) => (s.running ? s.runDash.overview.income.cents : undefined),
      "Yhteenveto Tulot ja menot (kaavio)": (s) => monthIn(s.runDash.overview.months, s.month)?.incomeCents,
      "Raportit Tulot": (s) => monthIn(s.window.income.months, s.month)?.earnedCents,
      "Raportit Kuukausi": (s) => monthIn(s.own?.reports.income.months, s.month)?.earnedCents,
    },
  },
  {
    id: "T2b",
    name: "Tulot (all income) of a month",
    months: "window",
    readers: {
      "Yhteenveto totals.incomeCents": (s) => s.own?.dash.totals.incomeCents,
      "Raportit Tulot": (s) => monthIn(s.window.income.months, s.month)?.totalCents,
      "Kassavirta Tulot": (s) => s.cash?.incomeCents,
    },
  },
  {
    id: "T2c",
    name: "Odotetut tulot of a month",
    months: "window",
    readers: {
      "Yhteenveto Tulot-laatta": (s) => (s.running ? s.runDash.overview.income.usualCents : undefined),
      "Raportit Tulot": (s) => monthIn(s.window.income.months, s.month)?.usualCents,
      "Raportit Kuukausi": (s) => monthIn(s.own?.reports.income.months, s.month)?.usualCents,
    },
  },
  {
    id: "T3",
    name: "Tulos of a month",
    months: "window",
    readers: {
      "Kassavirta Tulos": (s) => s.cash?.leftCents,
      "Kassavirta: tulot + luotto - kulutus - velanhoito - säästö": (s) => (s.cash ? leftOf(s.cash) : undefined),
      "Yhteenveto totals.leftCents": (s) => s.own?.dash.totals.leftCents,
      "Yhteenveto totals: tulot + luotto - kulutus - velanhoito - säästö": (s) => (s.own ? leftOf(s.own.dash.totals) : undefined),
    },
  },
  {
    id: "T4",
    name: "Varat velkojen jälkeen today",
    months: "running",
    readers: {
      "Yhteenveto Varat-laatta": (s) => s.runDash.holdings.netCents,
      "Raportit Saldot, Tilit ja kortit": (s) => s.window.balances.holdings.netCents,
      "Raportit Saldot, last month's total": (s) => s.window.balances.accountsLessDebt.at(-1),
      // the accounts added up on the last day and the cards with them are the same figure unless a saved loan with no account holds some of the debt
      "Raportit Saldot, last point of the line": (s) => (s.window.balances.debt.savedCents === 0 ? s.window.balances.daily.cents.at(-1) : undefined),
    },
  },
  {
    id: "T5a",
    name: "The usual month's spending",
    months: "running",
    readers: {
      "Yhteenveto Tulot ja menot (dashed line)": (s) => s.runDash.overview.usualSpendCents,
      "Rahankäyttö Menot kuukausittain (typical)": (s) => s.window.spendingMonths.typicalCents,
      "Yhteenveto Tavalliset menot (home.direction)": (s) => s.runDash.home.direction.usualCents,
    },
  },
  {
    id: "T5b",
    name: "The usual spending up to today in the running month",
    months: "running",
    readers: {
      "Yhteenveto Menot-laatta (expected)": (s) => s.runDash.home.pace?.expectedCents,
      "Raportit Kuukausi (expected)": (s) => s.own?.reports.thisMonth.expectedCents,
    },
  },
];

/**
 * Concepts that disagree today, by the household that shows it. Each runs as `it.fails`: it passes while the pages
 * disagree and fails the day they agree, which is the day to delete the entry. The reason names the figure and the fix.
 */
const KNOWN: Record<string, Record<string, string>> = {};

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

  for (const concept of CONCEPTS) {
    const run = KNOWN[concept.id]?.[h.name] ? it.fails : it;
    run(`${concept.id}: ${concept.name}`, () => {
      const mismatches: string[] = [];
      let compared = 0;
      for (const s of snapsFor(concept, snaps)) {
        const told = Object.entries(concept.readers)
          .map(([reader, read]) => [reader, read(s)] as const)
          .filter(([, value]) => value !== undefined);
        if (told.length < 2) continue;
        compared++;
        if (told.some(([, value]) => value !== told[0]![1])) mismatches.push(`${s.month}: ${told.map(([reader, value]) => `${reader} = ${value}`).join("; ")}`);
      }
      // a concept read by one page only is no agreement: some month has two readers at least
      expect(compared, `${concept.id}: no month is read by two pages`).toBeGreaterThan(0);
      // the message carries each month's figures, which a long value of `toEqual` would cut short
      expect(mismatches.length, mismatches.join(" || ")).toBe(0);
    });
  }
});
