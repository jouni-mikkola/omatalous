/**
 * The dashboard answer of a cached context, kept per period and inputs. The front page is opened again and again with
 * the same period while the data is unchanged, and building it reads the whole history (budget: docs/DEVELOPMENT.md,
 * Performance budgets). The key holds everything that is not in the context: the period, the stamp of the balances and
 * the user's inputs (`requestInputs`, so the marks, bills and loans are not serialised again), what the rows prove of
 * each balance (which the stamp does not hold) and the proposals, so a mark or a balance that changed builds the answer
 * again; a new data version is a new context and drops every answer with the old one.
 */
import { type AnalysisContext, buildDashboard, type DashboardData, type DateRange, type Language, type LoanProposal } from "@banking/core";
import { memoOn } from "./context-memo.ts";
import type { RequestInputs } from "./request-inputs.ts";

/** A member browsing months holds a few periods; more would only keep memory for views nobody returns to. */
const PER_CONTEXT = 6;

/** `read.balances` are the request's balances with their proof added; apart from the proof they are the ones `read.stamp` stands for. */
export function dashboardOf(ctx: AnalysisContext, range: DateRange, read: RequestInputs, proposals: readonly LoanProposal[], lang: Language = "fi", scopeProposals: readonly LoanProposal[] = proposals): DashboardData {
  const { balances, inputs, stamp } = read;
  const proof = balances.map((b) => b.proof ?? null);
  return memoOn(ctx, "dashboard", [range, stamp, proof, proposals, lang, scopeProposals], () => buildDashboard(ctx, range, balances, inputs, proposals, lang, scopeProposals), PER_CONTEXT);
}
