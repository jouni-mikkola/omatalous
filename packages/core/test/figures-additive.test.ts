/**
 * The `additive` flag of the figure registry (`figures.ts`) is a promise: the figures of the members' own views add up to
 * the household's, to the cent, where the split of the joint account is said. Over invented households of two to four
 * members, each figure flagged additive is read in the household view and in every member's view and the members' sum is
 * held to the household's. A figure flagged additive needs a reader here, or the reason it has none.
 */
import { describe, expect, it } from "vitest";
import { viewsOf, type HouseholdView } from "../../../tools/findings/households.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { addMonths, monthEnd, monthOf } from "../src/dates.ts";
import { FIGURES } from "../src/figures.ts";
import { buildHoldings } from "../src/holdings.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { NO_INPUTS } from "../src/types.ts";
import { generateHousehold } from "./kit/generate.ts";
import type { Spec } from "./kit/truth.ts";

const LONG = 120_000;

type FigureKey = keyof typeof FIGURES;
type Reader = (view: HouseholdView, today: string) => number | null;

const lastMonth = (today: string) => {
  const month = addMonths(monthOf(today), -1);
  return { month, range: { from: `${month}-01`, to: monthEnd(month) } };
};

const READERS: Partial<Record<FigureKey, Reader>> = {
  spending: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.expenseCents,
  consumption: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.consumptionCents,
  left: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.leftCents,
  saved: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.savedCents,
  income: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.incomeCents,
  earnedIncome: (v, today) => earnedIncome(v.ctx, lastMonth(today).month),
  netWorth: (v) => buildHoldings(v.ctx, v.balances, NO_INPUTS).netCents,
  cash: (v) => buildHoldings(v.ctx, v.balances, NO_INPUTS).accountsCents,
  periodLeft: (v, today) => cashflowReport(v.ctx, { from: `${addMonths(monthOf(today), -11)}-01`, to: today }).whole.leftCents,
};

/** Figures flagged additive that this file does not read, and where they are held. */
const ELSEWHERE: Partial<Record<FigureKey, string>> = {
  // a loan's payment is read at a part by each member: shared-additivity.test.ts adds the parts up to the household's
  loanMonthly: "shared-additivity.test.ts",
};

/** More than one seed: a household drawn once can add up by luck. */
const SEEDS = [1, 2, 3];

const SPECS: Spec[] = ([2, 3, 4] as const).flatMap((members) => (["joint", "checking"] as const).map((loan): Spec => ({ members, joint: "said", loan, cards: "connected" })));

describe("the figures flagged additive in the registry", () => {
  it("each have a reader here or name the test that holds them", () => {
    const additive = (Object.keys(FIGURES) as FigureKey[]).filter((k) => FIGURES[k].additive);
    const covered = [...Object.keys(READERS), ...Object.keys(ELSEWHERE)];
    expect(additive.sort()).toEqual(covered.sort());
  });

  it.each(SEEDS)(
    "add up from the members' views to the household's view, to the cent, where the split is said (seed %i)",
    (seed) => {
      for (const spec of SPECS) {
        const h = generateHousehold(spec, seed);
        const [household, ...members] = viewsOf(h);
        expect(members.length, h.name).toBe(spec.members);
        for (const [key, read] of Object.entries(READERS) as [FigureKey, Reader][]) {
          const whole = read(household!, h.today);
          // a figure nobody tells would pass by being empty
          expect(whole, `${h.name}: ${key} in the household`).not.toBeNull();
          // a member who tells nothing is no zero: the sum would pass by leaving that part out
          const parts = members.map((v) => read(v, h.today));
          expect(parts.includes(null), `${h.name}: ${key} in a member's view`).toBe(false);
          const sum = parts.reduce<number>((total, part) => total + (part ?? 0), 0);
          expect(sum, `${h.name}: ${key}, the members against the household`).toBe(whole);
        }
      }
    },
    LONG,
  );
});

/**
 * The monthly transfer between two members arrives a fee short. The pair counts where both legs are in the view, so the
 * figures of the members' views differ from the household's by exactly two things, and no other: the sender's view has
 * only its own leg, so the fee of 1,50 € is in the household's spending and in no member's; and the receiver's view has
 * only the money in, which names no payer account, so it counts as income there and asks its question (the member money
 * question of Tarkistettavat, `member-money.ts`) while the household counts it as the transfer it is. The server's
 * own view holds the other member's account when the other shares it, and the pair counts there: fee-short-list.test.ts.
 */
describe("the figures with a transfer between members that arrives a fee short", () => {
  it(
    "differ between the members and the household by the fee and the money in that counts as income, and by nothing else",
    () => {
      const h = generateHousehold({ members: 2, joint: "said", loan: "savings", cards: "unconnected", events: ["member-fee"] }, 1);
      const [household, ...members] = viewsOf(h);
      type Range = { from: string; to: string };
      const rowsOf = (range: Range) => h.txs.filter((t) => h.truth.get(t.id)?.event === "member-fee" && t.bookingDate >= range.from && t.bookingDate <= range.to);
      const month = lastMonth(h.today);
      const year = { from: `${addMonths(monthOf(h.today), -11)}-01`, to: h.today };
      const fee = (range: Range) => rowsOf(range).reduce((sum, t) => sum + (h.truth.get(t.id)!.feeCents ?? 0), 0);
      const arrives = (range: Range) => rowsOf(range).reduce((sum, t) => sum + Math.max(t.amountCents, 0), 0);
      expect(fee(month.range), "the generated month has a fee").toBeGreaterThan(0);
      expect(arrives(month.range), "the generated month has money in").toBeGreaterThan(0);
      const difference = (key: FigureKey) => {
        const read = READERS[key]!;
        return read(household!, h.today)! - members.reduce((sum, v) => sum + read(v, h.today)!, 0);
      };
      const inMonth = month.range;
      expect(difference("spending")).toBe(fee(inMonth));
      expect(difference("consumption")).toBe(fee(inMonth));
      expect(difference("income")).toBe(-arrives(inMonth));
      expect(difference("left")).toBe(-fee(inMonth) - arrives(inMonth));
      expect(difference("periodLeft")).toBe(-fee(year) - arrives(year));
      // the money in is a person's money in the receiver's view, which is no earned income, and the figures of saving and of the accounts do not move
      expect(difference("earnedIncome")).toBe(0);
      for (const key of ["saved", "netWorth", "cash"] as const) expect(difference(key), key).toBe(0);
    },
    LONG,
  );
});
