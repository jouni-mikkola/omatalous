/**
 * The dashboard answer of a cached context, kept per period and inputs. The front page is opened again and again with
 * the same period while the data is unchanged, and building it reads the whole history (budget: docs/DEVELOPMENT.md,
 * Performance budgets). The key holds everything that is not in the context (period, balances, the user's inputs, the
 * proposals), so a mark or a balance that changed builds the answer again; a new data version is a new context and drops
 * every answer with the old one.
 */
import { type AnalysisContext, type BalanceInput, buildDashboard, type DashboardData, type DateRange, type Language, type LoanProposal, type UserInputs } from "@banking/core";

/** A member browsing months holds a few periods; more would only keep memory for views nobody returns to. */
const PER_CONTEXT = 6;

const answers = new WeakMap<AnalysisContext, Map<string, DashboardData>>();

export function dashboardOf(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[], inputs: UserInputs, proposals: readonly LoanProposal[], lang: Language = "fi"): DashboardData {
  const key = JSON.stringify([range, balances, inputs, proposals, lang]);
  let held = answers.get(ctx);
  if (!held) answers.set(ctx, (held = new Map()));
  const hit = held.get(key);
  if (hit) return hit;
  const built = buildDashboard(ctx, range, balances, inputs, proposals, lang);
  if (held.size >= PER_CONTEXT) held.delete(held.keys().next().value!);
  held.set(key, built);
  return built;
}
