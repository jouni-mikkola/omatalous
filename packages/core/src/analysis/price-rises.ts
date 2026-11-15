/**
 * Fixed-amount charges that got dearer in the 12 months up to a day, with what the rises add to a year. A rise counts
 * from 1 € and 5 % (smaller ones are rounding and currency moves), and the rises together must pass the gate. Bills of
 * varying amount (spot electricity) are left out: their price swings with the season, not with a decision. A step that
 * changed what is bought is no rise (`notAPrice`): a new plan or line, a new home, a municipal fee that follows income
 * and hours. A subscription the household answered (`settledBy`) is left out.
 */
import { addDays } from "../dates.ts";
import { getCategory, SUBSCRIPTION_CATEGORIES } from "../categories.ts";
import { fold } from "../merchant.ts";
import { type PriceChange, priceChangeYearlyCents, type RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { isLenderName, isMunicipality, isRent } from "../wording.ts";
import { type AnalysisContext, recurringAt } from "./context.ts";
import { GATE_FLOOR_CENTS, MAX_HOUSING_STEP_TENTHS, MAX_PLAN_STEP, MIN_RISE_CENTS, MIN_RISE_SHARE } from "../thresholds.ts";
import { answeredSubscriptions, answerOf, settledBy } from "./subscription-alerts.ts";

/** Phone and broadband beside the subscription set: contracts whose plan, tier and line count the household picks. */
const PLAN_CATEGORIES: ReadonlySet<string> = new Set([...SUBSCRIPTION_CATEGORIES, "telecom"]);
/** Fees of these categories that a city or municipality charges follow the family's income and care hours. */
const INCOME_LINKED: ReadonlySet<string> = new Set(["kids", "education"]);

/** The payee and text of a series' last charge, folded. */
function textOf(ctx: AnalysisContext, s: Pick<RecurringSeries, "merchant" | "transactionIds">): string {
  const last = ctx.txs.find((t) => t.id === s.transactionIds[s.transactionIds.length - 1]);
  return fold(`${s.merchant} ${last?.counterparty ?? ""} ${last?.description ?? ""}`);
}

/** A price change as a share of the old price, in tenths of a percent: 1 050 € → 1 290 € is 229. */
const stepTenths = (p: Pick<PriceChange, "fromCents" | "toCents">) => Math.round(((p.toCents - p.fromCents) / p.fromCents) * 1000);

/**
 * Why a series' new amount is no price rise, or null when it may be one: a plan, tier or line change of a phone or a
 * subscription, a move or a new rent contract, or a municipal day-care or school fee, which follows income and care
 * hours.
 */
function notAPrice(ctx: AnalysisContext, s: Pick<RecurringSeries, "category" | "merchant" | "priceChange" | "transactionIds">): "plan" | "home" | "municipal" | null {
  const p = s.priceChange;
  if (!p) return null;
  if (INCOME_LINKED.has(s.category) && isMunicipality(fold(s.merchant))) return "municipal";
  if (s.category === "housing" && stepTenths(p) > MAX_HOUSING_STEP_TENTHS && isRent(textOf(ctx, s))) return "home";
  if (PLAN_CATEGORIES.has(s.category) && p.toCents - p.fromCents > MAX_PLAN_STEP * p.fromCents) return "plan";
  return null;
}

const isSpending = (s: RecurringSeries) => {
  const kind = getCategory(s.category).kind;
  // a lender's new sum is a new instalment plan, not a price
  return (kind === "expense" || kind === "debt") && !isLenderName(fold(s.merchant));
};

/** A fixed-amount charge that got dearer, with what the rise adds to a year of its charges. */
interface PriceRiseItem {
  series: RecurringSeries;
  /** `priceChangeYearlyCents` of the series, positive. */
  yearlyCents: number;
}

/** Every rise of 1 € and 5 % in the `days` up to `end`, one item per series and no total gate, largest first. */
function priceRiseItems(ctx: AnalysisContext, end: IsoDate, days = 365): PriceRiseItem[] {
  const since = addDays(end, -days);
  return recurringAt(ctx, end)
    .filter((s) => s.active && s.kind === "subscription" && isSpending(s) && s.priceChange && s.priceChange.date > since && s.priceChange.date <= end)
    .filter((s) => {
      const { fromCents, toCents } = s.priceChange!;
      return toCents - fromCents >= MIN_RISE_CENTS && toCents - fromCents >= MIN_RISE_SHARE * fromCents;
    })
    .map((s) => ({ series: s, yearlyCents: priceChangeYearlyCents(s)! }))
    .sort((a, b) => b.yearlyCents - a.yearlyCents || a.series.merchant.localeCompare(b.series.merchant));
}

/**
 * The price rises the household has not answered, one per series and largest first: `priceRiseItems` without the steps
 * that are no price (`notAPrice`) and the series marked Lopetettu, or Käytössä since the change. Empty when the rises
 * together stay under the gate of a month's contract, 10 €. The queue of Tarkistettavat reads this one list.
 */
export function openPriceRises(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): PriceRiseItem[] {
  const answered = answeredSubscriptions(inputs, ctx.today);
  // a cancelled one is being dropped, and one marked in use after the change is kept at its new price
  const rises = priceRiseItems(ctx, end).filter((r) => !notAPrice(ctx, r.series) && !settledBy(answerOf(answered, r.series), r.series.priceChange!.date));
  return rises.reduce((sum, r) => sum + r.yearlyCents, 0) < 12 * GATE_FLOOR_CENTS ? [] : rises;
}
