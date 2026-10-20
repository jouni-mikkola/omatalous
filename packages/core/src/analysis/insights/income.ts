/** Income insights (H-insights candidates 1 to 4 and 17): the changes `incomeChanges` finds, as insights. */
import { incomeInsights } from "../income-changes.ts";
import type { InsightSource } from "./types.ts";

export const incomeChangesSource: InsightSource = (a) => incomeInsights(a.ctx, a.range, a.inputs);
