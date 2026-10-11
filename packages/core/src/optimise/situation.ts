/**
 * Tilanne: four facts about the household against its own months, each from the function the overview and the
 * reports already use, so the pages never disagree. No score: weights would be arbitrary, and a household on a low
 * income cannot raise one without cutting necessities.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { totalsOf } from "../analysis/flows.ts";
import { formatEur } from "../analysis/format.ts";
import { DEBT_SHARE, debtShareOf } from "../analysis/insights/borrowing.ts";
import { commitmentsShareOf } from "../analysis/insights/commitments.ts";
import { MIN_COMPARE_MONTHS } from "../analysis/usual.ts";
import { monthOf } from "../dates.ts";
import { bufferReport } from "../reports/buffer.ts";
import type { BalanceInput, UserInputs } from "../types.ts";
import type { SituationFact } from "./types.ts";

/** Three months of usual spending: the buffer line the buffer report draws. */
const BUFFER_MONTHS = 3;

const pct = (share: number) => `${share < 0 ? "\u2212" : ""}${Math.abs(Math.round(share * 100))}\u00a0%`;
const monthsText = (n: number) => `${n.toFixed(1).replace(".", ",")} kuukautta`;
const eur = (cents: number) => formatEur(cents, false);

/** `months` are the complete months of the window, oldest first (`yearWindow`). */
export function situationOf(ctx: AnalysisContext, months: readonly string[], balances: readonly BalanceInput[], inputs: UserInputs): SituationFact[] {
  const inWindow = new Set(months);
  const totals = totalsOf(ctx.txs.filter((t) => inWindow.has(monthOf(t.bookingDate))).map((t) => t.flows));
  const rate = months.length >= MIN_COMPARE_MONTHS ? totals.savingsRate : null;
  const savings: SituationFact = {
    id: "savings_rate",
    label: "Säästöaste",
    value: rate,
    unit: "share",
    text: rate === null ? "" : pct(rate),
    basis:
      rate === null
        ? "Säästöaste lasketaan, kun tuloja on kolmelta valmiilta kuukaudelta."
        : `Säästöön ${eur(totals.savedCents)} ja tuloja ${eur(totals.incomeCents)} ${months.length} kuukaudessa.`,
  };

  // the overview's yardsticks are about today, so these read today's series and the months before this one
  const fixed = commitmentsShareOf(ctx, ctx.today, inputs).now;
  const fixedShare: SituationFact = {
    id: "fixed_share",
    label: "Kiinteät menot tuloista",
    value: fixed ? fixed.fixedCents / fixed.incomeCents : null,
    unit: "share",
    text: fixed ? `${fixed.pct}\u00a0%` : "",
    basis: fixed
      ? `Kiinteät menot ${eur(fixed.fixedCents)} ja tavalliset tulot ${eur(fixed.incomeCents)} kuussa.`
      : "Tavalliset tulot lasketaan kolmesta valmiista kuukaudesta.",
  };

  const buffer = bufferReport(ctx, balances, inputs);
  const bufferFact: SituationFact = {
    id: "buffer",
    label: "Puskuri",
    value: buffer.bufferMonths,
    unit: "months",
    text: buffer.bufferMonths === null ? "" : monthsText(buffer.bufferMonths),
    basis:
      buffer.bufferMonths !== null && buffer.cashCents !== null && buffer.usualSpendCents !== null
        ? `Tilien saldot ${eur(buffer.cashCents)} ja tavalliset menot ${eur(buffer.usualSpendCents)} kuussa.`
        : buffer.cashCents === null
          ? "Säästö- ja käyttötilien saldoja ei ole annettu."
          : "Tavalliset menot lasketaan kolmesta valmiista kuukaudesta.",
    reference: BUFFER_MONTHS,
  };

  const debt = debtShareOf(ctx, ctx.today, inputs);
  const debtValue = debt && debt.incomeCents > 0 ? debt.debtCents / debt.incomeCents : null;
  const debtFact: SituationFact = {
    id: "debt_share",
    label: "Velanhoito tuloista",
    value: debtValue,
    unit: "share",
    text: debtValue === null ? "" : pct(debtValue),
    basis: debt && debtValue !== null ? `Lainojen erät ${eur(debt.debtCents)} ja tavalliset tulot ${eur(debt.incomeCents)} kuussa.` : "Velanhoidon osuus lasketaan kuuden valmiin kuukauden tuloista.",
    reference: DEBT_SHARE,
  };
  return [savings, fixedShare, bufferFact, debtFact];
}
