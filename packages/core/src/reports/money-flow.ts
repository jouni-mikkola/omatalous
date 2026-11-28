// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
import { earnedOf, sumOf } from "../analysis/counted.ts";
import { type AnalysisContext, inDays } from "../analysis/context.ts";
import { debtSplit } from "../analysis/debt-split.ts";
import { coverOf, totalsOf } from "../analysis/flows.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { getCategory } from "../categories.ts";
import { spendingLabel } from "../category-names.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { MONEY_FLOW_CATEGORY_BANDS } from "../thresholds.ts";
import type { UserInputs } from "../types.ts";

/** What a band is, for its colour and for the table that lists it. */
type MoneyFlowKind = "income" | "drawn" | "spending" | "debt" | "kept";

interface MoneyFlowBand {
  /** `earned`, `other_income`, `savings`, `credit`, `accounts`; `category:<id>`, `other_spending`, `interest`, `principal`, `unsplit`, `saved`, `repaid`, `stayed`. */
  id: string;
  label: string;
  kind: MoneyFlowKind;
  /** Positive cents; a band of nothing is left out. */
  cents: number;
}

export interface MoneyFlowReport {
  /** Where the money came from: income by kind, then what was drawn (savings, credit, accounts and cards). */
  sources: MoneyFlowBand[];
  /** Where it went: consumption by category, debt service, money set aside, credit paid back, and what stayed on the accounts. */
  uses: MoneyFlowBand[];
  /** The sum of `sources` and of `uses`, which are equal (ADR 0014). */
  totalCents: number;
}

/**
 * Money in and money out of a range as two equal lists. Money has no label, so no band links one source to one use.
 * The sources are income, the credit and savings drawn and the rest of the gap (`coverOf`); the uses are what the
 * period took and what stayed. Every figure is read from the same flows as Tulos (`totalsOf`), so the two sides are
 * equal to the cent on every range and neither is made to match the other.
 */
export function moneyFlowReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): MoneyFlowReport {
  const rows = inDays(ctx, toDayRange(range));
  const totals = totalsOf(rows.map((x) => x.flows));
  const cover = coverOf(totals);
  const split = debtSplit(ctx, range, inputs);

  const earnedCents = sumOf(rows, earnedOf);
  const sources: MoneyFlowBand[] = [
    { id: "earned", label: messageIn(lang, "income.kind_earned"), kind: "income", cents: earnedCents },
    { id: "other_income", label: messageIn(lang, "income.group_other"), kind: "income", cents: totals.incomeCents - earnedCents },
    { id: "savings", label: messageIn(lang, "home.source_savings"), kind: "drawn", cents: cover.savingsDrawnCents },
    { id: "credit", label: messageIn(lang, "home.source_credit"), kind: "drawn", cents: cover.creditDrawnCents },
    { id: "accounts", label: messageIn(lang, "home.source_accounts"), kind: "drawn", cents: cover.accountsCents },
  ];

  const byCategory = new Map<string, number>();
  for (const x of rows) if (x.flows.consumption !== 0) byCategory.set(x.category, (byCategory.get(x.category) ?? 0) + x.flows.consumption);
  const ranked = [...byCategory].filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.slice(0, MONEY_FLOW_CATEGORY_BANDS);
  // refunds that outweigh a category's spending are netted into the rest, which a band cannot show below zero: they come off the largest band
  let rest = totals.consumptionCents - sumOf(named, ([, cents]) => cents);
  if (rest < 0 && named.length > 0) {
    named[0] = [named[0]![0], named[0]![1] + rest];
    rest = 0;
  }
  const uses: MoneyFlowBand[] = [
    ...named.map(([category, cents]): MoneyFlowBand => ({ id: `category:${category}`, label: spendingLabel(getCategory(category), lang), kind: "spending", cents })),
    { id: "other_spending", label: messageIn(lang, "rpt.mf_other_spending"), kind: "spending", cents: rest },
    { id: "interest", label: messageIn(lang, "home.bridge_interest"), kind: "debt", cents: split.interestCents },
    { id: "principal", label: messageIn(lang, "home.bridge_principal"), kind: "debt", cents: split.principalCents },
    { id: "unsplit", label: messageIn(lang, "home.bridge_unsplit"), kind: "debt", cents: totals.debtCents - split.interestCents - split.principalCents },
    { id: "saved", label: messageIn(lang, "home.bridge_saved"), kind: "kept", cents: Math.max(0, totals.savedCents) },
    { id: "repaid", label: messageIn(lang, "home.bridge_repaid"), kind: "debt", cents: cover.creditRepaidCents },
    { id: "stayed", label: messageIn(lang, "rpt.mf_stayed"), kind: "kept", cents: Math.max(0, totals.leftCents) },
  ];

  const present = (bands: MoneyFlowBand[]) => bands.filter((b) => b.cents > 0);
  const out = { sources: present(sources), uses: present(uses) };
  return { ...out, totalCents: sumOf(out.sources, (b) => b.cents) };
}
