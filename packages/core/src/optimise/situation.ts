/**
 * Tilanne: four facts about the household against its own months, each from the function the overview and the
 * reports already use, so the pages never disagree. No score: weights would be arbitrary, and a household on a low
 * income cannot raise one without cutting necessities.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { savingsRateOf } from "../analysis/bridge.ts";
import { debtShareOf } from "../analysis/insights/borrowing.ts";
import { commitmentsShareOf } from "../analysis/insights/commitments.ts";
import { MIN_COMPARE_MONTHS } from "../analysis/usual.ts";
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

  // the overview's yardsticks are about today, so these read today's series and the months before this one
  const fixed = commitmentsShareOf(ctx, ctx.today, inputs).now;
  const fixedShare: SituationFact = {
    id: "fixed_share",
    label: "Kiinteät menot tuloista",
    value: fixed ? fixed.fixedCents / fixed.incomeCents : null,
    unit: "share",
    text: fixed ? `${fixed.pct}\u00a0%` : "",
  };

  const buffer = bufferReport(ctx, balances, inputs);
  const bufferFact: SituationFact = {
    id: "buffer",
    label: "Puskuri",
    value: buffer.bufferMonths,
    unit: "months",
    text: buffer.bufferMonths === null ? "" : monthsText(buffer.bufferMonths),
  };

  // the end the overview's insights use while a period runs: today, so the six complete months before this one
  const debt = debtShareOf(ctx, ctx.today, inputs);
  const debtValue = debt && debt.incomeCents > 0 ? debt.debtCents / debt.incomeCents : null;
  const debtFact: SituationFact = {
    id: "debt_share",
    label: "Velanhoito tuloista, viimeiset 6 kuukautta",
    value: debtValue,
    unit: "share",
    text: debtValue === null ? "" : pct(debtValue),
  };
  return [savings, fixedShare, bufferFact, debtFact];
}
