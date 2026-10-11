/**
 * Optimoi: the page's data, the evidence behind a finding, the numbers the user types in and their decisions on
 * findings. The inputs and decisions are the signed-in user's own in both scopes. They are read for each request like
 * marks, so saving one moves no data version and calls no reprocess. The same holds for the follow-up's monthly
 * snapshot, which the first visit of a month writes.
 */
import {
  addMonths,
  allFindings,
  baselineOf,
  buildOptimise,
  changesSince,
  type DismissReason,
  type EvidenceResponse,
  type FindingState,
  followUpOf,
  type InputValues,
  inputDefOf,
  type IsoDate,
  LINE_MONTHS,
  measureSums,
  monthOf,
  type OptimiseResponse,
  parseInputValue,
  parseSnapshot,
  rowsById,
  type Snapshot,
  type SnapshotEntry,
  snapshotOf,
  yearWindow,
} from "@banking/core";
import { isoIn } from "../platform/config.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import { requestInputs, type Scope } from "./analysis.ts";
import type { Services } from "./context.ts";

/** A household types in a handful of numbers and decides on a few dozen findings; the caps only stop a script from filling the tables. */
const MAX_INPUTS = 50;
const MAX_STATES = 500;

/** A decision as the route parsed it: only the fields that belong to its status. */
export interface StateRequest {
  status: FindingState["status"] | null;
  reason: DismissReason | null;
  until: IsoDate | null;
  effectiveDate: IsoDate | null;
}

/** Owners of the shared accounts in view: their register answers categorised those rows, as on the transactions list. */
const ownersOf = (userId: string, accounts: readonly { userId: string }[]) => [...new Set(accounts.map((a) => a.userId).filter((id) => id !== userId))];

/** What the page and the evidence are built from, for the signed-in user. */
async function compute(s: Services, userId: string, scope: Scope, without?: string) {
  const repo = s.finance(userId);
  const { ctx, accounts } = await s.analysis.get(s, userId, scope);
  const [{ balances, inputs }, inputRows, states, codes] = await Promise.all([requestInputs(s, userId, accounts), repo.listInputs(), repo.listStates(), repo.industryCodes(ownersOf(userId, accounts))]);
  const values: InputValues = Object.fromEntries(inputRows.map(({ key, value, asOf }) => [key, { value, asOf }]));
  // the user's own register answers, for the merchants in view; a lookup never happens here
  const merchants = new Set(ctx.txs.map((t) => t.merchant));
  const industry = new Map([...codes].filter(([merchant]) => merchants.has(merchant)).map(([merchant, { code }]): [string, string] => [merchant, code]));
  // a state is left out when the finding it names is wanted as the frame sees it before the decision
  const data = buildOptimise({ ctx, balances, inputs, values, states: without ? states.filter((st) => st.findingId !== without) : states, industry });
  return { ctx, accounts, data, inputRows, states };
}

/**
 * The stored snapshots for the follow-up, newest first, and this month's written on its first visit. Only the own
 * view keeps them: the table has one row per user and month, and the household view shows other findings. Neither
 * a failed read nor a failed write stops the page; it then shows no changes.
 */
async function snapshots(s: Services, userId: string, entries: SnapshotEntry[]): Promise<{ previous: Snapshot | null; line: Snapshot[] }> {
  const repo = s.finance(userId);
  const month = monthOf(s.today());
  const current: Snapshot = { month, entries };
  try {
    const stored: Snapshot[] = [];
    // getSnapshot gives the latest at or before a month, so each step reads one stored row
    for (let at = month; stored.length < LINE_MONTHS; ) {
      const row = await repo.getSnapshot(at);
      if (!row) break;
      stored.push({ month: row.month, entries: parseSnapshot(row.data) });
      at = addMonths(row.month, -1);
    }
    if (stored[0]?.month !== month) {
      try {
        await repo.putSnapshot(month, entries, isoIn(s.instance.current.timezone, s.now()));
      } catch (err) {
        console.error("optimise snapshot not saved:", err instanceof Error ? err.message : err);
      }
    }
    const older = stored.filter((sn) => sn.month < month);
    // the line ends with today's figures, so a decision made this month shows on it at once
    return { previous: older[0] ?? null, line: [...older.slice(0, LINE_MONTHS - 1), current] };
  } catch (err) {
    console.error("optimise snapshots not read:", err instanceof Error ? err.message : err);
    return { previous: null, line: [current] };
  }
}

/**
 * The page: the findings, the checks, what is missing, the viewer's inputs and decisions, the changes since the last
 * snapshot and the follow-up of done decisions. The first visit of a month stores its snapshot.
 */
export async function optimisePage(s: Services, userId: string, scope: Scope): Promise<OptimiseResponse> {
  const { ctx, data, inputRows, states } = await compute(s, userId, scope);
  const entries = snapshotOf(data, states);
  const { previous, line } = scope === "own" ? await snapshots(s, userId, entries) : { previous: null, line: [] };
  const changes = previous ? changesSince(previous.entries, entries, data) : [];
  return { data, inputs: inputRows, states, changes, followUp: followUpOf(ctx, data, line) };
}

/** The finding recomputed: its calc, the rows it stands on and the monthly sums of what it measures. */
export async function optimiseEvidence(s: Services, userId: string, scope: Scope, id: string): Promise<EvidenceResponse> {
  const { ctx, accounts, data } = await compute(s, userId, scope);
  const finding = allFindings(data).find((f) => f.id === id);
  if (!finding) throw new NotFound("Löydöstä ei löydy.");
  const byId = rowsById(ctx);
  const names = new Map(accounts.map((a) => [a.id, a.ownerName ? `${a.name} (${a.ownerName})` : a.name]));
  const struck = new Set(finding.struck);
  const rows = finding.rows.flatMap((rowId) => {
    const t = byId.get(rowId);
    return t ? [{ id: t.id, date: t.bookingDate, merchant: t.merchant, amountCents: t.amountCents, accountId: t.accountId, account: names.get(t.accountId) ?? "", struck: struck.has(t.id) }] : [];
  });
  return { id, calc: finding.calc, rows, sums: measureSums(ctx, finding.measure, yearWindow(ctx, data.end).months) };
}

/** One value per key; a later one replaces the earlier and takes today's date. */
export async function setInput(s: Services, userId: string, scope: Scope, key: string, value: unknown) {
  const found = inputDefOf(key);
  if (!found) throw new UserError("Tuntematon tieto.");
  const parsed = parseInputValue(found.def, value, s.today());
  if (!parsed.ok) throw new UserError(parsed.error);
  if (found.subject !== null) {
    // a quote belongs to a subscription or bill the history has found, in the scope the page is showing
    const { ctx } = await s.analysis.get(s, userId, scope);
    if (!ctx.recurring.some((r) => r.id === found.subject)) throw new UserError("Vakuutusta ei löydy tiedoistasi.");
  }
  const repo = s.finance(userId);
  const current = await repo.listInputs();
  if (current.length >= MAX_INPUTS && !current.some((i) => i.key === key)) throw new UserError(`Tietoja voi olla enintään ${MAX_INPUTS}. Poista ensin turhat.`);
  await repo.setInput(key, parsed.value, s.today());
  return { inputs: await repo.listInputs() };
}

/** Taking away what is not there is not an error. */
export async function deleteInput(s: Services, userId: string, key: string) {
  if (!inputDefOf(key)) throw new UserError("Tuntematon tieto.");
  const repo = s.finance(userId);
  await repo.deleteInput(key);
  return { inputs: await repo.listInputs() };
}

/**
 * Done, dismissed or snoozed; null takes the decision back. The finding must be one the page can show now or a
 * decision already stored. Its mid and, for done, the baseline come from the finding computed here, never from the request.
 */
export async function decide(s: Services, userId: string, scope: Scope, id: string, request: StateRequest) {
  const repo = s.finance(userId);
  const stored = await repo.listStates();
  const known = stored.some((st) => st.findingId === id);
  if (request.status === null && known) {
    await repo.clearState(id);
    return { states: await repo.listStates() };
  }
  // the finding as it is without this decision: a snoozed one is hidden while its state stands
  const { ctx, data } = await compute(s, userId, scope, id);
  const finding = allFindings(data).find((f) => f.id === id);
  if (!finding) throw new NotFound("Löydöstä ei löydy.");
  if (request.status !== null) {
    if (stored.length >= MAX_STATES && !known) throw new UserError("Päätöksiä on liikaa. Poista ensin vanhoja.");
    const effectiveDate = request.status === "done" ? (request.effectiveDate ?? s.today()) : null;
    await repo.setState({
      findingId: id,
      status: request.status,
      reason: request.reason,
      until: request.until,
      effectiveDate,
      midCents: finding.euros?.midCents ?? null,
      baseline: request.status === "done" ? [...baselineOf(ctx, finding, effectiveDate!)] : null,
      // local time with its offset, so the first ten characters are the household's day
      decidedAt: isoIn(s.instance.current.timezone, s.now()),
    });
  }
  return { states: await repo.listStates() };
}
