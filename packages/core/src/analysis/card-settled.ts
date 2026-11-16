import { addDays } from "../dates.ts";
import { householdDebts } from "../household-debts.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import { expectedMoves, STALE_DAYS } from "./ahead-moves.ts";
import type { AnalysisContext } from "./context.ts";
import { poolOf } from "./pool.ts";

/**
 * Decision: whether the interest and the way to zero of a household with a card are known, or the card hides them.
 *
 * The connected cards whose statement is shown paid in full, with the day the next statement is paid: the settling
 * bills of `expectedMoves` that are `inFull` (each of the last bills covered what the card owed, and no interest row
 * came since). Such a card is paid off in full each time and costs no interest. A card the rows do not show paid in
 * full is not in the map, and its interest stays unknown.
 */
function settledCards(ctx: AnalysisContext, balances: readonly BalanceInput[]): ReadonlyMap<string, IsoDate> {
  const { settling } = expectedMoves(ctx, poolOf(balances).ids, balances, ctx.today, addDays(ctx.today, STALE_DAYS));
  const next = new Map<string, IsoDate>();
  for (const s of settling) if (s.inFull && !(next.get(s.cardId)! <= s.date)) next.set(s.cardId, s.date);
  return next;
}

/** The settled cards of a context and its list of accounts, worked out once: the holdings, Saldot and Lainat of one answer share the run. */
const settledOf = new WeakMap<AnalysisContext, WeakMap<readonly BalanceInput[], ReadonlyMap<string, IsoDate>>>();

function settledOnce(ctx: AnalysisContext, balances: readonly BalanceInput[]): ReadonlyMap<string, IsoDate> {
  const byBalances = settledOf.get(ctx) ?? new WeakMap<readonly BalanceInput[], ReadonlyMap<string, IsoDate>>();
  settledOf.set(ctx, byBalances);
  const known = byBalances.get(balances);
  if (known) return known;
  const settled = settledCards(ctx, balances);
  byBalances.set(balances, settled);
  return settled;
}

/** The debts of the household on the context's today, a card paid in full as one (`settledCards`): the one list every page reads. */
export const debtsOf = (ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): ReturnType<typeof householdDebts> => householdDebts(balances, inputs, ctx.today, settledOnce(ctx, balances));
