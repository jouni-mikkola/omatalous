// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
import { earnedOf, sumOf } from "../analysis/counted.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { debtSplit } from "../analysis/debt-split.ts";
import { coverOf, totalsOf } from "../analysis/flows.ts";
import type { DateRange } from "../analysis/period.ts";
import { getCategory } from "../categories.ts";
import { spendingLabel } from "../category-names.ts";
import { monthEnd, monthIndex } from "../dates.ts";
import { completeMonthRowsOf } from "../overview.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { MONEY_FLOW_CATEGORY_BANDS } from "../thresholds.ts";
import type { UserInputs } from "../types.ts";

/** What a band is, for its colour and for the table that lists it. */
type MoneyFlowKind = "income" | "drawn" | "spending" | "debt" | "kept";

interface MoneyFlowBand {
  /** `earned`, `other_income`, `savings`, `credit`, `accounts`, `refunds`; `category:<id>`, `other_spending`, `interest`, `principal`, `unsplit`, `saved`, `repaid`, `stayed`; a band that came out below zero on its own side is on the other with `:returned` added. */
  id: string;
  label: string;
  kind: MoneyFlowKind;
  /** Positive cents; a band of nothing is left out. */
  cents: number;
}

/** The picture of one complete month: the same two lists as the whole period, equal to the cent (ADR 0014). */
export interface MoneyFlowMonth {
  month: string;
  /** The first and last day of the month, for the link that opens its rows. */
  from: string;
  to: string;
  sources: MoneyFlowBand[];
  uses: MoneyFlowBand[];
  totalCents: number;
  /** The credit source of the month; 0 when there is none. */
  creditCents: number;
}

export interface MoneyFlowReport {
  /** Where the money came from: income by kind, then what was drawn (savings, credit, accounts and cards). */
  sources: MoneyFlowBand[];
  /** Where it went: consumption by category, debt service, money set aside, credit paid back, and what stayed on the accounts. */
  uses: MoneyFlowBand[];
  /** The sum of `sources` and of `uses`, which are equal (ADR 0014). */
  totalCents: number;
  /** The complete months the bands count. */
  monthCount: number;
  /** The credit source over those months, per month and rounded to the cent; 0 when there is none. */
  creditPerMonthCents: number;
  /** The same picture for each complete month, oldest first. */
  months: MoneyFlowMonth[];
}

/**
 * Money in and money out of the complete months of a range, the months the tiles of Tulot ja menot count, as two equal
 * lists; a range with no complete month has none. Money has no label, so no band links one source to one use.
 * The sources are income, the credit and savings drawn and the rest of the gap (`coverOf`); the uses are what the
 * period took and what stayed. Every figure is read from the same flows as Tulos (`totalsOf`), so the two sides are
 * equal to the cent and neither is made to match the other. A refund larger than the spending it comes off is carried
 * down the bands, and what is still below zero stands on the other side (refunds as a source). The picture is cash: a
 * card that is not connected has its bill in the debt band "Velanhoito, erittelemättä", and Rahankäyttö lists the same
 * purchases by category from the statement rows.
 */
export function moneyFlowReport(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): MoneyFlowReport {
  const { months, rows } = completeMonthRowsOf(ctx, range, lang);
  const splits = months.map((month) => debtSplit(ctx, { from: `${month}-01`, to: monthEnd(month) }, inputs));
  const split = { interestCents: sumOf(splits, (p) => p.interestCents), principalCents: sumOf(splits, (p) => p.principalCents) };
  const whole = bandsOf(rows, split, lang);
  const perMonth = months.map((month, i): MoneyFlowMonth => ({ month, from: `${month}-01`, to: monthEnd(month), ...bandsOf(rows.filter((x) => x.month === monthIndex(month)), splits[i]!, lang) }));
  return { sources: whole.sources, uses: whole.uses, totalCents: whole.totalCents, monthCount: months.length, creditPerMonthCents: months.length > 0 ? Math.round(whole.creditCents / months.length) : 0, months: perMonth };
}

/** The two equal lists for the rows of some complete months and the interest and principal of the same months. */
function bandsOf(rows: ReturnType<typeof completeMonthRowsOf>["rows"], split: { interestCents: number; principalCents: number }, lang: Language) {
  const totals = totalsOf(rows.map((x) => x.flows));
  const cover = coverOf(totals);

  const earnedCents = sumOf(rows, earnedOf);
  const sources: MoneyFlowBand[] = [
    { id: "earned", label: messageIn(lang, "income.kind_earned"), kind: "income", cents: earnedCents },
    { id: "other_income", label: messageIn(lang, "income.group_other"), kind: "income", cents: totals.incomeCents - earnedCents },
    { id: "savings", label: messageIn(lang, "rpt.mf_source_savings"), kind: "drawn", cents: cover.savingsDrawnCents },
    { id: "credit", label: messageIn(lang, "rpt.mf_source_credit"), kind: "drawn", cents: cover.creditDrawnCents },
    { id: "accounts", label: messageIn(lang, "rpt.mf_source_accounts"), kind: "drawn", cents: cover.accountsCents },
  ];

  const byCategory = new Map<string, number>();
  for (const x of rows) if (x.flows.consumption !== 0) byCategory.set(x.category, (byCategory.get(x.category) ?? 0) + x.flows.consumption);
  const ranked = [...byCategory].filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.slice(0, MONEY_FLOW_CATEGORY_BANDS).map(([category, cents]) => ({ category, cents }));
  // refunds that outweigh the rest come off the bands, largest first; what no band can take is money in
  let rest = totals.consumptionCents - sumOf(named, (b) => b.cents);
  let refundsCents = 0;
  if (rest < 0) {
    let owed = -rest;
    for (const band of named) {
      const taken = Math.min(band.cents, owed);
      band.cents -= taken;
      owed -= taken;
    }
    refundsCents = owed;
    rest = 0;
  }
  sources.push({ id: "refunds", label: messageIn(lang, "rpt.mf_refunds"), kind: "income", cents: refundsCents });
  const uses: MoneyFlowBand[] = [
    ...named.map(({ category, cents }): MoneyFlowBand => ({ id: `category:${category}`, label: spendingLabel(getCategory(category), lang), kind: "spending", cents })),
    { id: "other_spending", label: messageIn(lang, "rpt.mf_other_spending"), kind: "spending", cents: rest },
    { id: "interest", label: messageIn(lang, "rpt.mf_interest"), kind: "debt", cents: split.interestCents },
    { id: "principal", label: messageIn(lang, "rpt.mf_principal"), kind: "debt", cents: split.principalCents },
    { id: "unsplit", label: messageIn(lang, "rpt.mf_unsplit"), kind: "debt", cents: totals.debtCents - split.interestCents - split.principalCents },
    { id: "saved", label: messageIn(lang, "rpt.mf_saved"), kind: "kept", cents: Math.max(0, totals.savedCents) },
    { id: "repaid", label: messageIn(lang, "rpt.mf_repaid"), kind: "debt", cents: cover.creditRepaidCents },
    { id: "stayed", label: messageIn(lang, "rpt.mf_stayed"), kind: "kept", cents: Math.max(0, totals.leftCents) },
  ];

  // a band below zero stands on the other side, so neither list loses a cent
  const returned = (bands: MoneyFlowBand[]) => bands.filter((b) => b.cents < 0).map((b): MoneyFlowBand => ({ ...b, id: `${b.id}:returned`, cents: -b.cents }));
  const present = (bands: MoneyFlowBand[]) => bands.filter((b) => b.cents > 0);
  const out = { sources: present([...sources, ...returned(uses)]), uses: present([...uses, ...returned(sources)]) };
  const creditCents = out.sources.find((b) => b.id === "credit")?.cents ?? 0;
  return { ...out, totalCents: sumOf(out.sources, (b) => b.cents), creditCents };
}
