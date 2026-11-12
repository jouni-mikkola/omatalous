// Decision: what a month costs before any choice, and which contract, subscription or loan instalment makes it
import { type AnalysisContext, standingOf } from "../analysis/context.ts";
import { fixedSeriesAt, fixedShareOn } from "../analysis/fixed-share.ts";
import { cancelledSubjects, isFixedSpending } from "../commitments.ts";
import { addMonthsToDate } from "../dates.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import type { Cadence } from "../recurring.ts";
import { FIXED_PAYMENT_MONTHS } from "../thresholds.ts";
import { type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";

/** One payment of a series, as a row of Tapahtumat. */
interface FixedPayment {
  id: string;
  date: IsoDate;
  /** What was paid, positive. */
  amountCents: number;
}

interface FixedCostRow {
  /** The series' id (`seriesId`): the payee, the account and the product. */
  id: string;
  merchant: string;
  category: string;
  /** How often it is charged; a lender's payments on no steady day are monthly. Null when the series tells none. */
  cadence: Cadence | null;
  /** One usual charge, positive. */
  chargeCents: number;
  /** The series' cost a month. */
  monthlyCents: number;
  /** Twelve months of `monthlyCents`, so the yearly column adds up as the monthly one does. */
  yearlyCents: number;
  lastDate: IsoDate;
  /** Null when no next day is told (a lender's payments, a series that follows a pay). */
  nextDate: IsoDate | null;
  /** The series' own payments of the last twelve months, newest first. */
  payments: FixedPayment[];
  /** Their sum. */
  paidCents: number;
}

interface FixedCostsReport {
  /** Largest first: the spending and the loan instalments of the series running today; a series marked as cancelled is not among them. */
  rows: FixedCostRow[];
  /** The rows added up: `fixedMonthlyCents` of `fixedShareOn`, so the share below is of this sum. */
  monthlyCents: number;
  yearlyCents: number;
  /** The expected income of a month (`expectedIncome`); null under three complete months. */
  incomeMonthlyCents: number | null;
  /** `monthlyCents` as a share of that income; null without it or with only a few subscriptions (`fixedShareOn`). */
  fixedShare: number | null;
  /** What the share is of, with the months the income is the mean of: "Kiinteät menot tavallisista tuloista, viimeiset 4 kuukautta". */
  fixedShareLabel: string;
}

/**
 * The fixed costs of a month as the series run today: each contract, subscription and loan instalment with its cost a
 * month and a year, and the payments of the last twelve months behind it. Always about today, whatever period the page
 * shows. The series and the total are those of `fixedShareOn` and of the dashboard's `fixedMonthlyCents`: a lender's
 * monthly payments on no steady day (`lenderInstalments`) count, so the rows say where each euro of the total comes from.
 */
export function fixedCostsReport(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS, lang: Language = DEFAULT_LANGUAGE): FixedCostsReport {
  const cancelled = cancelledSubjects(inputs, ctx.today);
  const running = fixedSeriesAt(ctx, ctx.today).filter((s) => isFixedSpending(s, cancelled));
  const since = addMonthsToDate(ctx.today, -FIXED_PAYMENT_MONTHS);
  // a series' rows are those of the standing context: in the cut one a row can be missing
  const byId = new Map(standingOf(ctx).txs.map((t) => [t.id, t]));
  const rows = running
    .map((s): FixedCostRow => {
      const payments = s.transactionIds
        .flatMap((id) => byId.get(id) ?? [])
        .filter((t) => t.bookingDate > since && t.bookingDate <= ctx.today)
        .map((t) => ({ id: t.id, date: t.bookingDate, amountCents: -t.amountCents }))
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      return {
        id: s.id,
        merchant: s.merchant,
        category: s.category,
        cadence: s.cadence,
        chargeCents: s.typicalAmountCents,
        monthlyCents: s.monthlyCents,
        yearlyCents: s.monthlyCents * 12,
        lastDate: s.lastDate,
        nextDate: s.nextDate,
        payments,
        paidCents: payments.reduce((sum, p) => sum + p.amountCents, 0),
      };
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.merchant.localeCompare(b.merchant, "fi") || a.id.localeCompare(b.id));
  const monthlyCents = rows.reduce((sum, r) => sum + r.monthlyCents, 0);
  const share = fixedShareOn(ctx, ctx.today, inputs, lang);
  return { rows, monthlyCents, yearlyCents: monthlyCents * 12, incomeMonthlyCents: share.incomeMonthlyCents, fixedShare: share.fixedShare, fixedShareLabel: share.fixedShareLabel };
}
