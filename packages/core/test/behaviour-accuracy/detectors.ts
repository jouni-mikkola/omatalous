/**
 * The detectors the measuring stick scores, each as the set of units it claims (a household, a row, a merchant) and
 * the set the truth holds. A detector of BH3 joins with one entry here when its file lands.
 *
 * Bars, and why:
 * - A told line about how a person behaves (D5, D6) must be right when it speaks: precision 1 on the stick, since a
 *   false claim about a household's credit or pay day costs more trust than a missed one. D5's recall 0,8: the stick
 *   holds the real cases a fair rule should see. D6's recall 0,35: of its eight real effects four are moderate (real,
 *   but a year of one card purchase a day cannot tell them from chance) and one strong one is on a card linked late
 *   (not covered), so a rule at precision 1 reaches the three strong covered ones.
 * - A question (D3) costs one tap when it is wrong and is capped at three a week, so precision 0,8. Its recall is over
 *   the real splits the strict rule does not net: three of the seven planted in each household are left out on
 *   purpose (a friend paying 70 %, payments ten days late, a gift through a payment service the run could not place;
 *   a looser rule buys them with many false questions), and in about
 *   half the households the strict rule takes the dinner's two shares for an electricity bill first (returns.ts), so
 *   0,45.
 * - What the app does today and others change (gambling of BH1 and BH2, price rises of insights/prices.ts) is printed
 *   with no bar, so a change shows in the table; BH1 sets the gambling bar when it lands.
 */
import { contextOf } from "../../../../tools/findings/households.ts";
import { monthToDate } from "../../../../tools/findings/statements.ts";
import type { AnalysisContext } from "../../src/analysis/context.ts";
import { insightInputOf, rankInsights } from "../../src/analysis/insights/index.ts";
import { creditStack } from "../../src/behaviour/credit-stack.ts";
import { paydayEffect } from "../../src/behaviour/payday.ts";
import { splitCandidates } from "../../src/behaviour/split.ts";
import { fold } from "../../src/merchant.ts";
import { NO_INPUTS } from "../../src/types.ts";
import type { Labelled, Truth } from "./world.ts";

export interface Bar {
  precision: number;
  recall: number;
}

export interface Detector {
  id: string;
  unit: string;
  claimed: (ctx: AnalysisContext, l: Labelled) => Set<string>;
  truth: (t: Truth, l: Labelled, ctx: AnalysisContext) => Set<string>;
  bar: Bar | null;
}

/** Purchases the strict rule of returns.ts lowered with money from a person. */
function strictlyNetted(ctx: AnalysisContext): Set<string> {
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  return new Set([...ctx.returns].filter(([inId]) => byId.get(inId)?.description === "MOBILEPAY").map(([, purchase]) => purchase));
}

const household = (l: Labelled) => l.household.name;
const one = (yes: boolean, l: Labelled) => (yes ? new Set([household(l)]) : new Set<string>());

export const DETECTORS: readonly Detector[] = [
  {
    id: "D5 credit stacking",
    unit: "household",
    claimed: (ctx, l) => {
      const c = creditStack(ctx);
      return one(c.active.value >= 3 && c.opened.value >= 2, l);
    },
    truth: (t, l) => one(t.stacked, l),
    bar: { precision: 1, recall: 0.8 },
  },
  {
    id: "D5 credit pays credit",
    unit: "draw row",
    claimed: (ctx) => new Set(creditStack(ctx).links.map((k) => k.drawId)),
    truth: (t) => t.linkDraws,
    bar: { precision: 1, recall: 0.8 },
  },
  {
    id: "D6 payday effect",
    unit: "household",
    claimed: (ctx, l) => one(paydayEffect(ctx).told, l),
    truth: (t, l) => one(t.paydaySpike, l),
    bar: { precision: 1, recall: 0.35 },
  },
  {
    id: "D3 split, asked",
    unit: "purchase row",
    claimed: (ctx) => new Set(splitCandidates(ctx).questions.map((q) => q.purchaseId)),
    // the splits the strict rule leaves to a question: all but the ones it netted
    truth: (t, _l, ctx) => new Set([...t.splits].filter((id) => !strictlyNetted(ctx).has(id))),
    bar: { precision: 0.8, recall: 0.45 },
  },
  {
    id: "D3 shared stakes",
    unit: "purchase row",
    // a question about a stake; a payment service row with no operator must never be one
    claimed: (ctx) => {
      const byId = new Map(ctx.txs.map((t) => [t.id, t]));
      return new Set(splitCandidates(ctx).questions.filter((q) => byId.get(q.purchaseId)?.category === "gambling").map((q) => q.purchaseId));
    },
    truth: (t) => t.sharedStakes,
    bar: { precision: 1, recall: 0.8 },
  },
  {
    id: "D3 split, strict (today)",
    unit: "purchase row",
    claimed: (ctx) => strictlyNetted(ctx),
    truth: (t) => t.exactSplits,
    bar: null,
  },
  {
    id: "D1 price rise seen (today)",
    unit: "merchant",
    // what recurring.ts sees as a rise of an active series, before any gate of a told line
    claimed: (ctx) => new Set(ctx.recurring.filter((s) => s.active && s.priceChange && s.priceChange.toCents > s.priceChange.fromCents).map((s) => fold(s.merchant))),
    truth: (t) => t.priceRises,
    bar: null,
  },
  {
    id: "D1 price rise told (today)",
    unit: "merchant",
    claimed: (ctx, l) => {
      const ids = new Set(rankInsights(insightInputOf(ctx, monthToDate(l.household.today), NO_INPUTS)).filter((i) => i.id.startsWith("price:")).map((i) => i.id.slice("price:".length)));
      return new Set(ctx.recurring.filter((s) => ids.has(s.id)).map((s) => fold(s.merchant)));
    },
    truth: (t) => t.priceRises,
    bar: null,
  },
  {
    id: "D4 gambling stakes (today)",
    unit: "row",
    claimed: (ctx) => new Set(ctx.txs.filter((t) => t.category === "gambling" && t.amountCents < 0).map((t) => t.id)),
    truth: (t) => t.stakes,
    bar: null,
  },
];

const contexts = new WeakMap<Labelled, AnalysisContext>();
/** One context per household, shared by every detector. */
export const ctxOf = (l: Labelled): AnalysisContext => {
  let c = contexts.get(l);
  if (!c) contexts.set(l, (c = contextOf(l.household)));
  return c;
};
