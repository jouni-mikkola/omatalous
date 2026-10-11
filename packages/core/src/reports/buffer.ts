// Decision: build up savings or not
import type { AnalysisContext } from "../analysis/context.ts";
import { spanLabel } from "../analysis/change-text.ts";
import { formatEur, formatFiDate } from "../analysis/format.ts";
import { completeMonthsBefore, usualFrom, usualIncome, usualSpending } from "../analysis/usual.ts";
import { cancelledMerchants, fixedMonthlyCents } from "../commitments.ts";
import { type BalanceInput, NO_INPUTS, type UserInputs } from "../types.ts";

/** A buffer of three months of spending is the usual advice. */
const TARGET_MONTHS = 3;
/** Less than this is not a household's fixed costs, only a few subscriptions. */
const MIN_FIXED_CENTS = 20000;

export interface BufferReport {
  /** Subscriptions, bills and loan instalments per month, as they are now. */
  fixedMonthlyCents: number;
  /** Usual monthly income (`usualIncome`: earned income, the median of the last complete months); null under three. */
  incomeMonthlyCents: number | null;
  /** Fixed costs as a share of that income; null without income or without real fixed costs. */
  fixedShare: number | null;
  /** Spending (consumption and debt) in a usual month, groceries included; null under three complete months. */
  usualSpendCents: number | null;
  /** Balances of savings and checking accounts today; null when none of them has a balance. */
  cashCents: number | null;
  /** The account types that balance counts, for the wording. */
  cashTypes: ("savings" | "checking")[];
  /** The cash in months of usual spending; null without a balance or a usual level. */
  bufferMonths: number | null;
  /** The complete months the usual levels stand on, named in the advice: another page may show another month's usual level. */
  usualMonths: string[];
  /** The day the buffer length can first be told (three complete months); null without history. */
  usualFrom: string | null;
  /** What it means; "" when there is nothing to say. */
  advice: string;
}

/**
 * How much of the income is spoken for before the month starts, and how many months of usual spending the money on
 * savings and checking accounts would carry. Always about today. Fixed costs are a share of income and say nothing
 * about the buffer: a household lives on groceries too. The buffer is told only where the bank gave a balance (a CSV
 * import has none). `inputs` carries the user's marks: a cancelled subscription leaves the fixed costs.
 */
export function bufferReport(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs = NO_INPUTS): BufferReport {
  // a subscription the household marked as cancelled is no longer a fixed cost, as on the overview
  const fixed = fixedMonthlyCents(ctx.recurring, cancelledMerchants(inputs));

  // the complete months before this one, the same yardstick as every "usually" (analysis/usual.ts)
  const month = ctx.today.slice(0, 7);
  const months = completeMonthsBefore(ctx, month);
  const incomeMonthly = usualIncome(ctx, month);
  const spendUsual = usualSpending(ctx, month);
  const share = fixed >= MIN_FIXED_CENTS && incomeMonthly && incomeMonthly > 0 ? fixed / incomeMonthly : null;

  const counted = balances.filter((a) => (a.type === "savings" || a.type === "checking") && a.balanceCents !== null);
  const cashCents = counted.length ? counted.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const cashTypes = (["savings", "checking"] as const).filter((type) => counted.some((a) => a.type === type));
  const bufferMonths = cashCents === null || !spendUsual || spendUsual <= 0 ? null : Math.max(0, cashCents) / spendUsual;

  const report = { fixedMonthlyCents: fixed, incomeMonthlyCents: incomeMonthly, fixedShare: share, usualSpendCents: spendUsual, cashCents, cashTypes, bufferMonths, usualMonths: months, usualFrom: usualFrom(ctx) };
  return { ...report, advice: advice(report) };
}

const months = (n: number) => n.toFixed(1).replace(".", ",");

const ACCOUNTS = { savings: "Säästötileillä", checking: "Käyttötileillä", both: "Säästö- ja käyttötileillä" } as const;

function advice(r: Omit<BufferReport, "advice">): string {
  const parts: string[] = [];
  if (r.fixedShare !== null && r.incomeMonthlyCents !== null) {
    const free = r.incomeMonthlyCents - r.fixedMonthlyCents;
    parts.push(
      `Kiinteät menot ${formatEur(r.fixedMonthlyCents, false)} kuukaudessa vievät ${Math.round(r.fixedShare * 100)} % tuloista. ` +
        `Vapaaksi jää ${formatEur(Math.max(0, free), false)} arkeen ja säästöön.`,
    );
  }
  if (r.cashCents !== null) {
    const where = r.cashTypes.length === 2 ? ACCOUNTS.both : ACCOUNTS[r.cashTypes[0]!];
    const have = `${where} on ${formatEur(r.cashCents, false)}.`;
    if (r.bufferMonths === null || r.usualSpendCents === null) {
      // under three complete months there is no usual level to divide by
      parts.push(r.usualFrom ? `${have} Puskurin pituus näkyy ${formatFiDate(r.usualFrom)}.` : have);
    } else {
      const target = TARGET_MONTHS * r.usualSpendCents;
      parts.push(
        `${have} Se kattaa ${months(r.bufferMonths)} kuukauden menot, kun menot ovat tavallisesti ${formatEur(r.usualSpendCents, false)} kuukaudessa (${spanLabel(r.usualMonths)}).` +
          (r.bufferMonths < TARGET_MONTHS ? ` Kolmen kuukauden puskuri olisi ${formatEur(target, false)}, joten siitä puuttuu ${formatEur(target - r.cashCents, false)}.` : ""),
      );
    }
  }
  return parts.join(" ");
}
