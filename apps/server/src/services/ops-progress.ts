/**
 * `ops progress` (cli-ops.ts): the helper tells the app each step of the action it runs, while it runs.
 */
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { Services } from "./context.ts";
import { MAX_STEPS, parseStepObject, parseSteps, scrub, validOpsId } from "./ops-validate.ts";

/**
 * `{id, step: {n, m, text}}` from `ops progress`: one step of a request that is running now, shown by the page before the
 * report comes. The step goes through the report's own check (parseStepObject) and its text is scrubbed as the report's
 * is; `at` is the seconds since the helper took the request. Nothing else is written: the helper is not marked seen, and
 * the times the expiry reads stay. Anything else is refused.
 */
export async function progressOps(s: Services, payload: unknown): Promise<void> {
  const o = strictObject(payload, ["id", "step"] as const);
  if (!validOpsId(o.id)) throw new UserError("Virheellinen pyynnön tunnus.");
  const step = parseStepObject(o.step);
  if (!step) throw new UserError("Virheellinen vaihe.");
  const row = await s.ops.get(o.id);
  if (!row || row.status !== "running" || !row.claimedAt) throw new UserError("Virheellinen pyynnön tunnus.");
  const clean = parseSteps(`STEP: ${step.n}/${step.m} ${scrub(step.text, (s.config.appSecret ? [s.config.appSecret] : []))}`)[0];
  if (!clean) throw new UserError("Virheellinen vaihe.");
  const at = Math.max(0, Math.round((s.now().getTime() - Date.parse(row.claimedAt)) / 1000));
  if (!(await s.ops.addStep(o.id, JSON.stringify({ ...clean, at }), MAX_STEPS))) throw new UserError("Virheellinen pyynnön tunnus.");
}

