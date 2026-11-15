/** A steady kit household with rows of a test added: the base gives the detectors real noise around the case. */
import type { AnalysisContext } from "../../src/analysis/context.ts";
import { contextOf } from "../../../../tools/findings/households.ts";
import { frameOf, type Frame, rows, type RowSpec } from "../kit/frame.ts";
import { HISTORY_MONTHS, householdOf, steadyRows, withCardBills } from "../kit/household.ts";
import type { Transaction } from "../../src/types.ts";

export const TODAY = "2026-10-18";
export const frame: Frame = frameOf(TODAY, HISTORY_MONTHS);

/** The context of the steady household of `seed` with `specs` added, and the ids the specs got, in order. */
export function withRows(specs: readonly RowSpec[], opts: { seed?: number; drop?: (t: Transaction) => boolean } = {}): { ctx: AnalysisContext; ids: string[] } {
  const { out, add } = rows("case", TODAY);
  for (const s of specs) add(s);
  const txs = withCardBills([...steadyRows(opts.seed ?? 7, "poisson", TODAY), ...out], TODAY).filter((t) => !opts.drop?.(t));
  return { ctx: contextOf(householdOf("case", TODAY, txs)), ids: out.map((t) => t.id) };
}

/** `cents` on `day` of each month from `fromAgo` months back to `toAgo`. */
export function monthly(fromAgo: number, toAgo: number, day: number, spec: Omit<RowSpec, "date">): RowSpec[] {
  const out: RowSpec[] = [];
  for (let back = fromAgo; back >= toAgo; back--) out.push({ ...spec, date: frame.on(frame.ago(back), day) });
  return out;
}
