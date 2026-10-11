/**
 * H-insights 9: fixed-amount charges that got dearer in the 12 months up to the end of the period, with what the rises
 * add to a year. A rise counts from 1 € and 5 % (smaller ones are rounding and currency moves), and the rises together
 * must pass the gate. Bills of varying amount
 * (spot electricity) are left out: their price swings with the season, not with a decision. A step that changed what
 * is bought is no rise (`notAPrice`): a new plan or line, a new home, a municipal fee that follows income and hours.
 */
import { addDays } from "../../dates.ts";
import { getCategory, SUBSCRIPTION_CATEGORIES } from "../../categories.ts";
import { fold } from "../../merchant.ts";
import { type PriceChange, priceChangeYearlyCents, type RecurringSeries } from "../../recurring.ts";
import type { IsoDate } from "../../types.ts";
import { isRent } from "../../wording.ts";
import { type AnalysisContext, recurringAt } from "../context.ts";
import { finnishList, formatEur, formatFiDate } from "../format.ts";
import { capitalise, countWord, isLender, ITEM_GATE_MONTHLY_CENTS } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";
import { isMunicipality } from "../../wording.ts";

const MIN_RISE_CENTS = 100;
const MIN_RISE_SHARE = 0.05;

/** Phone and broadband beside the subscription set: contracts whose plan, tier and line count the household picks. */
export const PLAN_CATEGORIES: ReadonlySet<string> = new Set([...SUBSCRIPTION_CATEGORIES, "telecom"]);
/**
 * A step over this share is a plan, tier or line change (a family plan gaining a line, a campaign price ending into
 * another plan); the bill shows no line count, so such a step is never told as a price rise.
 */
const MAX_PLAN_STEP = 0.3;
/** A rent step over this, in tenths of a percent, is a move or a new contract, never a rise. A vastike really rises more. */
export const MAX_HOUSING_STEP_TENTHS = 100;
/** Fees of these categories that a city or municipality charges follow the family's income and care hours. */
const INCOME_LINKED: ReadonlySet<string> = new Set(["kids", "education"]);


/** The payee and text of a series' last charge, folded. */
function textOf(ctx: AnalysisContext, s: Pick<RecurringSeries, "merchant" | "transactionIds">): string {
  const last = ctx.txs.find((t) => t.id === s.transactionIds[s.transactionIds.length - 1]);
  return fold(`${s.merchant} ${last?.counterparty ?? ""} ${last?.description ?? ""}`);
}

/** A price change as a share of the old price, in tenths of a percent: 1 050 € → 1 290 € is 229. */
export const stepTenths = (p: Pick<PriceChange, "fromCents" | "toCents">) => Math.round(((p.toCents - p.fromCents) / p.fromCents) * 1000);

/**
 * Why a series' new amount is no price rise, or null when it may be one: a plan, tier or line change of a phone or a
 * subscription, a move or a new rent contract, or a municipal day-care or school fee, which follows income and care
 * hours. The price insight and Optimoi's subscription area read this one rule, so neither tells these steps as a rise.
 */
export function notAPrice(ctx: AnalysisContext, s: Pick<RecurringSeries, "category" | "merchant" | "priceChange" | "transactionIds">): "plan" | "home" | "municipal" | null {
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
  return (kind === "expense" || kind === "debt") && !isLender(s.merchant);
};

/** A fixed-amount charge that got dearer, with what the rise adds to a year of its charges. */
export interface PriceRiseItem {
  series: RecurringSeries;
  /** `priceChangeYearlyCents` of the series, positive. */
  yearlyCents: number;
}

/**
 * Every rise of 1 € and 5 % in the `days` up to `end`, one item per series and no total gate, largest first. The
 * insight below adds its gate; Optimoi reads the same list, so both pages name the same rises.
 */
export function priceRiseItems(ctx: AnalysisContext, end: IsoDate, days = 365): PriceRiseItem[] {
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

export function priceRises({ ctx, end }: InsightArgs): Insight[] {
  const since = addDays(end, -365);
  const rises = priceRiseItems(ctx, end)
    .filter((r) => !notAPrice(ctx, r.series))
    .map((r) => ({ s: r.series, yearly: r.yearlyCents }));
  if (!rises.length || rises.reduce((sum, r) => sum + r.yearly, 0) < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  const rows = rises.flatMap(({ s }) => s.transactionIds.slice(-2));
  if (rises.length === 1) {
    const { s, yearly } = rises[0]!;
    const { fromCents, toCents, date } = s.priceChange!;
    const debt = getCategory(s.category).kind === "debt";
    return [
      {
        id: `price:${s.id}`,
        tone: "warning",
        title: `${s.merchant}: ${debt ? "erä kasvoi" : "hinta nousi"} ${formatEur(yearly, false)} vuodessa`,
        detail: `${formatEur(fromCents)} → ${formatEur(toCents)} ${formatFiDate(date)} alkaen.`,
        yearlyCents: yearly,
        rows,
        link: { merchant: s.merchant },
        merchant: s.merchant,
      },
    ];
  }
  const total = rises.reduce((sum, r) => sum + r.yearly, 0);
  return [
    {
      id: "price-rises",
      tone: "warning",
      title: `${capitalise(countWord(rises.length))} toistuvaa maksua kallistui, yhteensä ${formatEur(total, false)} vuodessa`,
      detail: `${finnishList(rises.map((r) => r.s.merchant))}, 12 kuukauden ajalta ${formatFiDate(addDays(since, 1))} alkaen.`,
      yearlyCents: total,
      rows,
    },
  ];
}
