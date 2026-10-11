/**
 * Optimoi: the page's data, the evidence behind a finding, the numbers the user types in and their decisions on
 * findings. Mounted at its own prefix behind the `optimise` flag. The inputs and decisions are the signed-in user's own in
 * both scopes. They are read for each request like marks, so saving one moves no data version and calls no reprocess.
 * The same holds for the follow-up's monthly snapshot, which the first visit of a month writes.
 */
import {
  addDays,
  addMonths,
  allFindings,
  baselineOf,
  buildOptimise,
  changesSince,
  dayNumber,
  DISMISS_REASONS,
  type DismissReason,
  type FindingState,
  followUpOf,
  fromDayNumber,
  type InputValues,
  inputDefOf,
  type IsoDate,
  LINE_MONTHS,
  measureSums,
  monthOf,
  parseFindingId,
  parseInputValue,
  parseSnapshot,
  rowsById,
  type Snapshot,
  type SnapshotEntry,
  snapshotOf,
  yearWindow,
} from "@banking/core";
import { Hono } from "hono";
import { isoIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import { parseScope, requestInputs, type Scope } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

/** A household types in a handful of numbers and decides on a few dozen findings; the caps only stop a script from filling the tables. */
const MAX_INPUTS = 50;
const MAX_STATES = 500;
/** How far a done decision may date back or ahead, and how far a snooze may reach, in days. */
const DONE_DAYS = 365;
const SNOOZE_DAYS = 365;

const STATUSES = ["done", "dismissed", "snoozed"] as const;

/** `YYYY-MM-DD` that exists on the calendar (2026-02-30 does not). */
const isRealDate = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromDayNumber(dayNumber(v)) === v;

const absent = (v: unknown) => v === undefined || v === null;

function parseId(value: unknown): string {
  if (typeof value !== "string" || !parseFindingId(value)) throw new UserError("Virheellinen löydöksen tunniste.");
  return value;
}

/** Owners of the shared accounts in view: their register answers categorised those rows, as on the transactions list. */
const ownersOf = (userId: string, accounts: readonly { userId: string }[]) => [...new Set(accounts.map((a) => a.userId).filter((id) => id !== userId))];

/** What the page and the evidence route are built from, for the signed-in user. */
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

/** The state to store from the request: only the fields that belong to its status, checked against allowlists. */
function parseState(raw: unknown, today: IsoDate): { status: FindingState["status"] | null; reason: DismissReason | null; until: IsoDate | null; effectiveDate: IsoDate | null } {
  const input = strictObject(raw, ["status", "reason", "until", "effectiveDate"] as const);
  const status = input.status;
  if (status === undefined || (status !== null && !(STATUSES as readonly unknown[]).includes(status))) throw new UserError("Valitse tila: tehty, ei koske meitä tai lykätty.");
  const stray = () => new UserError("Kenttä ei kuulu tähän valintaan.");
  if (status !== "dismissed" && !absent(input.reason)) throw stray();
  if (status !== "snoozed" && !absent(input.until)) throw stray();
  if (status !== "done" && !absent(input.effectiveDate)) throw stray();

  let reason: DismissReason | null = null;
  if (!absent(input.reason)) {
    if (typeof input.reason !== "string" || !(DISMISS_REASONS as readonly string[]).includes(input.reason)) throw new UserError("Valitse syy listasta.");
    reason = input.reason as DismissReason;
  }
  let until: IsoDate | null = null;
  if (status === "snoozed") {
    // the finding is hidden before this day, so tomorrow is the first that hides anything
    if (!isRealDate(input.until) || input.until <= today || input.until > addDays(today, SNOOZE_DAYS)) throw new UserError("Anna päivä, joka on huomisesta vuoden päähän.");
    until = input.until;
  }
  let effectiveDate: IsoDate | null = null;
  if (!absent(input.effectiveDate)) {
    const day = input.effectiveDate;
    if (!isRealDate(day) || day < addDays(today, -DONE_DAYS) || day > addDays(today, DONE_DAYS)) throw new UserError("Anna päivä, joka on enintään vuoden päässä.");
    effectiveDate = day;
  }
  return { status: status as FindingState["status"] | null, reason, until, effectiveDate };
}

export function optimiseRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  /**
   * The page: the findings, the checks, what is missing, the viewer's inputs and decisions, the changes since the last
   * snapshot and the follow-up of done decisions. The first visit of a month stores its snapshot.
   */
  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const scope = parseScope(c.req.query("scope"));
    const { ctx, data, inputRows, states } = await compute(s, userId, scope);
    const entries = snapshotOf(data, states);
    const { previous, line } = scope === "own" ? await snapshots(s, userId, entries) : { previous: null, line: [] };
    const changes = previous ? changesSince(previous.entries, entries, data) : [];
    return c.json({ data, inputs: inputRows, states, changes, followUp: followUpOf(ctx, data, line) });
  });

  /** The finding recomputed: its calc, the rows it stands on and the monthly sums of what it measures. */
  app.get("/evidence", async (c) => {
    const id = parseId(c.req.query("id"));
    const { ctx, accounts, data } = await compute(s, c.get("user").id, parseScope(c.req.query("scope")));
    const finding = allFindings(data).find((f) => f.id === id);
    if (!finding) return c.json({ error: "Löydöstä ei löydy." }, 404);
    const byId = rowsById(ctx);
    const names = new Map(accounts.map((a) => [a.id, a.ownerName ? `${a.name} (${a.ownerName})` : a.name]));
    const struck = new Set(finding.struck);
    const rows = finding.rows.flatMap((rowId) => {
      const t = byId.get(rowId);
      return t ? [{ id: t.id, date: t.bookingDate, merchant: t.merchant, amountCents: t.amountCents, accountId: t.accountId, account: names.get(t.accountId) ?? "", struck: struck.has(t.id) }] : [];
    });
    return c.json({ id, calc: finding.calc, rows, sums: measureSums(ctx, finding.measure, yearWindow(ctx, data.end).months) });
  });

  // one value per key; a later one replaces the earlier and takes today's date
  app.put("/inputs/:key", async (c) => {
    const user = c.get("user");
    const key = c.req.param("key");
    const found = inputDefOf(key);
    if (!found) throw new UserError("Tuntematon tieto.");
    const { value } = strictObject(await body(c), ["value"] as const);
    const parsed = parseInputValue(found.def, value, s.today());
    if (!parsed.ok) throw new UserError(parsed.error);
    if (found.subject !== null) {
      // a quote belongs to a subscription or bill the history has found, in the scope the page is showing
      const { ctx } = await s.analysis.get(s, user.id, parseScope(c.req.query("scope")));
      if (!ctx.recurring.some((r) => r.id === found.subject)) throw new UserError("Vakuutusta ei löydy tiedoistasi.");
    }
    const repo = s.finance(user.id);
    const current = await repo.listInputs();
    if (current.length >= MAX_INPUTS && !current.some((i) => i.key === key)) throw new UserError(`Tietoja voi olla enintään ${MAX_INPUTS}. Poista ensin turhat.`);
    await repo.setInput(key, parsed.value, s.today());
    return c.json({ inputs: await repo.listInputs() });
  });

  // taking away what is not there is not an error
  app.delete("/inputs/:key", async (c) => {
    const key = c.req.param("key");
    if (!inputDefOf(key)) throw new UserError("Tuntematon tieto.");
    const repo = s.finance(c.get("user").id);
    await repo.deleteInput(key);
    return c.json({ inputs: await repo.listInputs() });
  });

  /**
   * Done, dismissed or snoozed; null takes the decision back. The finding must be one the page can show now or a
   * decision already stored. Its mid and, for done, the baseline come from the finding computed here, never from the request.
   */
  app.put("/findings/:id", async (c) => {
    const user = c.get("user");
    const id = parseId(c.req.param("id"));
    const today = s.today();
    const request = parseState(await body(c), today);
    const repo = s.finance(user.id);
    const stored = await repo.listStates();
    const known = stored.some((st) => st.findingId === id);
    if (request.status === null && known) {
      await repo.clearState(id);
      return c.json({ states: await repo.listStates() });
    }
    // the finding as it is without this decision: a snoozed one is hidden while its state stands
    const { ctx, data } = await compute(s, user.id, parseScope(c.req.query("scope")), id);
    const finding = allFindings(data).find((f) => f.id === id);
    if (!finding) return c.json({ error: "Löydöstä ei löydy." }, 404);
    if (request.status !== null) {
      if (stored.length >= MAX_STATES && !known) throw new UserError("Päätöksiä on liikaa. Poista ensin vanhoja.");
      const effectiveDate = request.status === "done" ? (request.effectiveDate ?? today) : null;
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
    return c.json({ states: await repo.listStates() });
  });

  return app;
}
