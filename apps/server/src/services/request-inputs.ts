/**
 * What a request reads next to the cached context (`requestInputs` in analysis.ts), and what is worked out of it and
 * kept beside the context for the next request.
 */
import { createHash } from "node:crypto";
import type { AnalysisContext, BalanceInput, LoanProposal, UserInputs } from "@banking/core";
import { loanProposals } from "@banking/core";
import { memoOn } from "./context-memo.ts";

/**
 * The balances and the member's inputs. `stamp` is one digest of both: the key a memo (`memoOn`) takes in their place, so
 * a request that asks many memos serialises the marks, bills and loans once.
 */
export interface RequestInputs {
  balances: BalanceInput[];
  inputs: UserInputs;
  stamp: string;
}

export const stampOf = (balances: readonly BalanceInput[], inputs: UserInputs): string => createHash("sha256").update(JSON.stringify([balances, inputs])).digest("base64");

/** The proposals of a context and the inputs a request read already, kept beside the context for the next request that asks the same. */
export function proposalsOf(ctx: AnalysisContext, { inputs, stamp }: Pick<RequestInputs, "inputs" | "stamp">): LoanProposal[] {
  return memoOn(ctx, "loan-proposals", stamp, () => loanProposals(ctx, inputs));
}
