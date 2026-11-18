/**
 * The dashboard answer of a cached context, kept per period and inputs. The front page is opened again and again with
 * the same period while the data is unchanged, and building it reads the whole history (budget: docs/DEVELOPMENT.md,
 * Performance budgets). The key holds everything that is not in the context (period, balances, the user's inputs, the
 * proposals), so a mark or a balance that changed builds the answer again; a new data version is a new context and drops
 * every answer with the old one.
 */
import { type AnalysisContext, type BalanceInput, buildDashboard, type DashboardData, type DateRange, type Language, type LoanProposal, type UserInputs } from "@banking/core";
import { memoOn } from "./context-memo.ts";

/** A member browsing months holds a few periods; more would only keep memory for views nobody returns to. */
const PER_CONTEXT = 6;

export function dashboardOf(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[], inputs: UserInputs, proposals: readonly LoanProposal[], lang: Language = "fi", scopeProposals: readonly LoanProposal[] = proposals): DashboardData {
  return memoOn(ctx, "dashboard", [range, balances, inputs, proposals, lang, scopeProposals], () => buildDashboard(ctx, range, balances, inputs, proposals, lang, scopeProposals), PER_CONTEXT);
}
