/**
 * What every source of Tarkistettavat reads of the member's own view: the cached context, its accounts, the balances,
 * the member's inputs and the household's members. The queue reads them once and hands them to each source, so the
 * header's count on every page does not repeat the same reads fourteen times.
 */
import type { AnalysisContext, BalanceInput, HouseholdMember, UserInputs } from "@banking/core";
import type { ScopeAccount } from "./analysis.ts";
import type { RequestReads } from "./request-reads.ts";
import type { MemberMoneyItem } from "./review-members.ts";

export interface OwnView {
  ctx: AnalysisContext;
  accounts: ScopeAccount[];
  balances: BalanceInput[];
  inputs: UserInputs;
  /** `requestInputs` stamp of the balances and inputs: the key the queue's memos take. */
  stamp: string;
  /** What the queue read of the household while it read the view: a source that needs the uses or the traces asks here. */
  reads: RequestReads;
  /** The household's members, read on the first ask. */
  members(): Promise<HouseholdMember[]>;
  /** The money in from other members that nothing explained, worked out on the first ask. */
  memberMoney(): Promise<MemberMoneyItem[]>;
}
