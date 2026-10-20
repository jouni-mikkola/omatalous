/**
 * Tilanne: four facts about the household against its own months, each from the function the overview and the
 * reports already use, so the pages never disagree. No score: weights would be arbitrary, and a household on a low
 * income cannot raise one without cutting necessities.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { savingsRateOf } from "../analysis/bridge.ts";
import { debtShareOf } from "../analysis/insights/borrowing.ts";
import { MIN_COMPARE_MONTHS } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import { usualIncomeOf } from "../analysis/fixed-share.ts";
import { bufferReport } from "../reports/buffer.ts";
import type { BalanceInput, UserInputs } from "../types.ts";
import type { SituationFact } from "./types.ts";

const pct = (share: number) => `${share < 0 ? "\u2212" : ""}${Math.abs(Math.round(share * 100))}\u00a0%`;
const monthsText = (n: number) => `${n.toFixed(1).replace(".", ",")} kuukautta`;

/** `months` are the complete months of the window, oldest first (`yearWindow`). */
export function situationOf(ctx: AnalysisContext, months: readonly string[], balances: readonly BalanceInput[], inputs: UserInputs): SituationFact[] {
  const saving = savingsRateOf(ctx, months);
  const rate = saving.months.length >= MIN_COMPARE_MONTHS ? saving.rate : null;
  const savings: SituationFact = {
    id: "savings_rate",
    label: saving.label,
    value: rate,
    unit: "share",
    text: rate === null ? "" : pct(rate),
  };

  // the share Raportit > Kiinteät ja muuttuvat shows, from the same report: about today, so this month's series
  // against the usual income of the complete months before this one
  const buffer = bufferReport(ctx, balances, inputs);
  const fixedShare: SituationFact = {
    id: "fixed_share",
    label: buffer.fixedShareLabel,
    value: buffer.fixedShare,
    unit: "share",
    text: buffer.fixedShare === null ? "" : pct(buffer.fixedShare),
  };

  const bufferFact: SituationFact = {
    id: "buffer",
    label: "Puskuri",
    value: buffer.bufferMonths,
    unit: "months",
    text: buffer.bufferMonths === null ? "" : monthsText(buffer.bufferMonths),
  };

  // the loan instalments of today against the usual income, the end the overview's insights use: Raportit's
  // Maksettu velanhoito is what a window paid, of its whole income, and its title names that window
  const debt = debtShareOf(ctx, ctx.today, inputs);
  const debtValue = debt && debt.incomeCents > 0 ? debt.debtCents / debt.incomeCents : null;
  const debtFact: SituationFact = {
    id: "debt_share",
    label: `Velanhoito ${usualIncomeOf(ctx, monthOf(ctx.today))}`,
    value: debtValue,
    unit: "share",
    text: debtValue === null ? "" : pct(debtValue),
  };
  return [savings, fixedShare, bufferFact, debtFact];
}
