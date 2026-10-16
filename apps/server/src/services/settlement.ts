/**
 * The settlement between the partners of a joint account, served. Core's `settlement` does the sums; this builds its
 * inputs from the settled trace of the pool, the stored agreements, the household members who have no login and the
 * earned income of the pool's users, and decides who may ask: a member sees the pools they are weighted in and no
 * others, the way they see an account only when it is theirs or shared with them.
 */
import { isDeepStrictEqual } from "node:util";
import { type AgreementRow, addMonths, type RunningPool, agreementRefusal, CLOSE_DAYS, type ClosedMonth, dayNumber, fromDayNumber, type Incomes, isEarnedIncome, monthLast, type Owner, type Settlement, type SettlementLine, settlement, type Trace, type TraceUser } from "@banking/core";
import type { StoredAgreement, StoredClosedMonth, StoredMember } from "../db/agreement-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { Services } from "./context.ts";
import { confirmedBy, confirmedByOnly, namedUsers, pendingOf, plainValue, sameRow } from "./agreement-pending.ts";
import { isCardAccount, poolUsers, settledTrace } from "./money-trace.ts";

const KINDS = ["equal", "share", "income", "fixed"] as const;
type Kind = (typeof KINDS)[number];
/** The most a weight or a fixed amount can be, in cents: far above a month of any household, and eight of them add up exactly. */
const MAX_CENTS = 1_000_000_000;
/** A household has a handful of people. */
const MAX_MEMBERS = 50;
/** The key a card bill gets when the bank's category says it is one but no connected card holds its leg: nobody's, so core leaves it out. */
const UNCONNECTED_CARD = "card:?";

/** A pool a member may ask about: a real account with two users or more, not a card, that they are weighted in and can see; or (`card`) a card they hold. */
interface Pool {
  key: string;
  /** The ids of the copies of the account the member can see. */
  ids: string[];
  name: string;
  users: TraceUser[];
  card?: true;
}

export function parseMonth(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new UserError("Virheellinen kuukausi.");
  return value;
}

function parseDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value || value < "2000-01-01" || value > "2100-12-31")
    throw new UserError("Virheellinen päivä.");
  return value;
}

/** Of these keys, the ones the user is weighted in: what a settlement shows them and what the export and import hand them. */
export async function weightedKeys(s: Services, userId: string, keys: readonly string[]): Promise<string[]> {
  const users = await poolUsers(s, keys);
  return keys.filter((k) => users.get(k)?.some((u) => u.owner === `u:${userId}` && u.weight > 0));
}

/** The pools a member is weighted in, from the accounts they own or have been given. */
async function poolsOf(s: Services, userId: string): Promise<Pool[]> {
  const accounts = [...(await s.finance(userId).listAccounts()), ...(await s.household.sharedWith(userId))].filter((a) => a.type !== "credit_card" && !a.cardMask);
  const byKey = new Map<string, Pool>();
  for (const a of accounts) {
    const key = accountKey(a);
    const have = byKey.get(key);
    if (have) have.ids.push(a.id);
    else byKey.set(key, { key, ids: [a.id], name: a.name, users: [] });
  }
  const users = await poolUsers(s, [...byKey.keys()]);
  return [...byKey.values()]
    .map((p) => ({ ...p, users: users.get(p.key) ?? [] }))
    .filter((p) => p.users.filter((u) => u.weight > 0).length >= 2 && p.users.some((u) => u.owner === `u:${userId}` && u.weight > 0));
}

/** The pool of an account the member sees and is weighted in, or the card account they see and hold; anything else looks like an account that is not there. */
async function poolOf(s: Services, userId: string, accountId: string): Promise<Pool> {
  const pool = (await poolsOf(s, userId)).find((p) => p.ids.includes(accountId));
  if (pool) return pool;
  const card = [...(await s.finance(userId).listAccounts()), ...(await s.household.sharedWith(userId))].find((a) => a.id === accountId && isCardAccount(a));
  const users = card ? ((await poolUsers(s, [accountKey(card)])).get(accountKey(card)) ?? []) : [];
  if (!card || !users.some((u) => u.owner === `u:${userId}` && u.weight > 0)) throw new NotFound("Tiliä ei löydy.");
  return { key: accountKey(card), ids: [card.id], name: card.name, users, card: true };
}

/** A stored month as core reads it; a row that is no month's settlement (nobody writes one) is no snapshot. */
function closedOf(row: StoredClosedMonth): ClosedMonth | null {
  let v: Record<string, unknown> | null = null;
  try {
    v = JSON.parse(row.snapshot) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  const status = v?.status as { open?: unknown; closedOn?: unknown } | undefined;
  const shaped = !!v && v.month === row.month && status?.open === false && typeof status.closedOn === "string" && ["members", "lines", "unknownPaidBy", "unknownOwedBy"].every((k) => Array.isArray(v[k]));
  return shaped ? (v as unknown as ClosedMonth) : null;
}

/**
 * Why a closed month an import brings is not taken, or null when it is: the month has ended (today is past its last day), the
 * day it says it closed on is one core can give (from its last day to CLOSE_DAYS after it, not in the future) with the reason
 * core gives for that day, and the text is a month's settlement as `closedOf` reads one.
 */
function closedMonthRefusal(month: string, closedOn: string, snapshot: string, today: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "month";
  const end = monthLast(month);
  if (!(dayNumber(today) > end)) return "open";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closedOn) || new Date(`${closedOn}T00:00:00Z`).toISOString().slice(0, 10) !== closedOn) return "day";
  const closed = dayNumber(closedOn);
  if (closed < end || closed > end + CLOSE_DAYS || closed > dayNumber(today)) return "day";
  const kept = closedOf({ accountKey: "", month, closedOn, snapshot, writtenAt: "" });
  if (!kept || kept.status.closedOn !== closedOn || kept.status.by !== (closed >= end + CLOSE_DAYS ? "time" : "resolved")) return "shape";
  return null;
}

/** A stored row as core reads it; a row of a kind nobody knows or a value that is no object is no agreement. */
function agreementOf(row: StoredAgreement): AgreementRow | null {
  if (!(KINDS as readonly string[]).includes(row.kind)) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // who has put a row that shows the income ratio is for the page to read, not for the sums
  return { accountKey: row.accountKey, validFrom: row.validFrom, kind: row.kind as Kind, value: plainValue(row.kind, value as Record<string, unknown>) };
}

/** Earned income by user and month, from the rows of each user's own accounts. */
async function incomesOf(s: Services, owners: readonly Owner[]): Promise<Incomes> {
  const incomes = new Map<Owner, Map<string, number>>();
  for (const owner of owners) {
    if (!owner.startsWith("u:") || owner === "u:") continue;
    const months = new Map<string, number>();
    for (const t of (await s.analysis.get(s, owner.slice(2), "own")).ctx.txs) {
      if (isEarnedIncome(t)) months.set(t.bookingDate.slice(0, 7), (months.get(t.bookingDate.slice(0, 7)) ?? 0) + t.flows.income);
    }
    incomes.set(owner, months);
  }
  return incomes;
}

/** The owners a month's lines name. */
const namedIn = (lines: readonly SettlementLine[]): Set<Owner> => new Set(lines.flatMap((l) => [...l.paid, ...l.owed].map((e) => e.owner)));

/** Every owner there is now, in words: the users by display name, the members by their name. */
async function namesOf(s: Services): Promise<Record<string, string>> {
  const [users, members] = await Promise.all([s.users.list(), s.agreements.members()]);
  return Object.fromEntries([...users.map((u) => [`u:${u.id}`, u.displayName]), ...members.map((m) => [`m:${m.id}`, m.name])]);
}

/**
 * The words for the owners a pool names and no others, so a member learns no name of a user or member who is no user of the
 * pool; and the members among them who are gone from the household: their `m:` stays on old rows (nothing of the past is
 * rewritten) and is flagged, with no name.
 */
function wordsFor(owners: Iterable<Owner>, all: Record<string, string>): { names: Record<string, string>; removed: Owner[] } {
  const names: Record<string, string> = {};
  const removed: Owner[] = [];
  for (const o of new Set(owners)) {
    if (Object.hasOwn(all, o)) names[o] = all[o]!;
    else if (o.startsWith("m:")) removed.push(o);
  }
  return { names, removed: removed.sort() };
}

interface PoolSettlement {
  accountId: string;
  name: string;
  /** The words for the owners the settlement names who use the pool, or did: users and members. */
  names: Record<string, string>;
  /** The members who have no login and are gone: named by old rows, with no name now. */
  removed: Owner[];
  /** The payers as their rows write them, by the `g:` owner of the unknown lines. */
  labels: Record<string, string>;
  settlement: Settlement;
}

/** What a pool's months are worked out from: the settlement of one month given the months closed before it, and the month the pool's first booked row is in. */
async function engineOf(s: Services, pool: Pool) {
  const t = await settledTrace(s, pool.key);
  if (!t) return null;
  const stored = await s.agreements.agreementRows([pool.key, ...t.cards.map((c) => c.key)]);
  // a row that waits for a partner is not in force: the earlier row holds
  const agreements = stored.filter((r) => !pendingOf(r)).flatMap((r) => agreementOf(r) ?? []);
  // a card bill the bank's category names whose card is not connected: a key no card holds, so core cannot say whose it is
  const trace: Trace = { ...t.raw, rows: t.raw.rows.map((r) => (r.cardKey === undefined && r.cents < 0 && t.cardBills.has(r.key) ? { ...r, cardKey: UNCONNECTED_CARD } : r)) };
  const incomes = agreements.some((a) => JSON.stringify(a).includes('"income"')) ? await incomesOf(s, t.users.map((u) => u.owner)) : new Map();
  const compute = (m: string, closed: readonly ClosedMonth[]) => settlement(m, { key: pool.key, trace, answers: t.said, users: t.users }, agreements, t.members, t.cards, incomes, s.today(), closed);
  // a month before the pool's first booked row has no settlement to keep: nothing is stored for it, however it is asked
  const firstDay = Math.min(...trace.rows.filter((r) => !r.pending).map((r) => r.day));
  return { t, compute, firstMonth: Number.isFinite(firstDay) ? fromDayNumber(firstDay).slice(0, 7) : null };
}

type Engine = NonNullable<Awaited<ReturnType<typeof engineOf>>>;
const byMonth = (x: ClosedMonth, y: ClosedMonth): number => (x.month < y.month ? -1 : 1);

/** How many months a quick answer may freeze itself: the one just ended and the one before, whose closing waits for its days. */
const QUICK_MONTHS = 3;

/** The rest a job on the side takes after each month it freezes, so the requests of the same process are not queued behind a long history (a month of a large pool is tens of milliseconds of work). */
const ASIDE_PAUSE_MS = 250;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many months of the pool from its first booked row up to the month before today have no stored snapshot. */
function unstored(s: Services, e: Engine, closed: readonly ClosedMonth[]): number {
  let n = 0;
  for (let m = e.firstMonth ?? "9999-99"; m < s.today().slice(0, 7); m = addMonths(m, 1)) if (!closed.some((c) => c.month === m)) n += 1;
  return n;
}

/** How long a pool whose freeze failed waits before a front page may start it again. */
const RETRY_AFTER_MS = 10 * 60_000;

/** The pools being frozen on the side, per server and key: one job each. A failure is logged and the pool waits RETRY_AFTER_MS, so a failing store is not worked through again on every front page. */
const freezing = new WeakMap<Services, Map<string, Promise<unknown>>>();
const failedAt = new WeakMap<Services, Map<string, number>>();
function freezeAside(s: Services, key: string, job: () => Promise<unknown>): void {
  const jobs = freezing.get(s) ?? freezing.set(s, new Map()).get(s)!;
  const failed = failedAt.get(s) ?? failedAt.set(s, new Map()).get(s)!;
  if (jobs.has(key) || Date.now() - (failed.get(key) ?? -Infinity) < RETRY_AFTER_MS) return;
  const run = job().then(
    () => failed.delete(key),
    (err: unknown) => {
      failed.set(key, Date.now());
      console.error("settlement: freezing the closed months of a shared account failed:", err instanceof Error ? err.message : err);
    },
  );
  jobs.set(key, run.finally(() => jobs.delete(key)));
}

/** Every month of the pool that has closed and is not in `closed`, oldest first, each worked out with the earlier ones; `keep` may say what stands for a month (the stored one). */
async function closeAll(s: Services, e: Engine, closed: ClosedMonth[], keep: (done: Settlement, closed: ClosedMonth[]) => Promise<ClosedMonth[]>): Promise<ClosedMonth[]> {
  for (let m = e.firstMonth ?? "9999-99"; m < s.today().slice(0, 7); m = addMonths(m, 1)) {
    if (closed.some((c) => c.month === m)) continue;
    const done = e.compute(m, closed);
    if (!done.status.open) closed = await keep(done, closed);
  }
  return closed;
}

/**
 * The closed months of one of the user's pools as this server works them out now, stored ones as they were; null when the key is
 * no pool the user is weighted in or it has no trace. Nothing is written: an import compares a month it is given with these.
 */
async function recomputedMonths(s: Services, userId: string, key: string): Promise<Map<string, ClosedMonth> | null> {
  const pool = (await poolsOf(s, userId)).find((p) => p.key === key);
  const e = pool && (await engineOf(s, pool));
  if (!e) return null;
  const stored = (await s.agreements.closedMonths(key)).flatMap((c) => closedOf(c) ?? []);
  const all = await closeAll(s, e, stored, async (done, closed) => [...closed, done as ClosedMonth].sort(byMonth));
  // a month before the pool's first booked row is no closed month a request would store
  return new Map(all.filter((c) => e.firstMonth !== null && c.month >= e.firstMonth).map((c) => [c.month, c]));
}

/**
 * Why a closed month an import brings is not taken, or null when it is: `closedMonthRefusal` finds it no month's closing, or
 * it is not what this server works out for that month of that pool (the same lines and cents), or the pool has no trace here.
 * `cache` holds the pools already worked out in this import.
 */
export async function importedMonthRefusal(s: Services, userId: string, row: Readonly<Record<string, unknown>>, cache: Map<string, Map<string, ClosedMonth> | null>): Promise<string | null> {
  const key = String(row.account_key);
  const why = closedMonthRefusal(String(row.month), String(row.closed_on), String(row.snapshot), s.today());
  if (why) return why;
  if (!cache.has(key)) cache.set(key, await recomputedMonths(s, userId, key));
  const own = cache.get(key)?.get(String(row.month));
  return own && isDeepStrictEqual(JSON.parse(String(row.snapshot)), JSON.parse(JSON.stringify(own))) ? null : "differs";
}

/** The settlement of a month for every pool the member is weighted in and that has a trace. */
export async function settlementsOf(s: Services, userId: string, month: string): Promise<PoolSettlement[]> {
  return (await poolSettlements(s, userId, month)).map((p) => p.settled);
}

/**
 * The running month so far, for the front page: per pool the member is weighted in and that has a trace, who has paid over
 * their share. Only the users of the pool with a weight above zero are named, with the words of `names`; an agreement that
 * waits for a partner is not in force (`engineOf`).
 */
export async function runningSettlement(s: Services, userId: string): Promise<RunningPool[]> {
  const month = s.today().slice(0, 7);
  return (await poolSettlements(s, userId, month, true)).map(({ pool, settled }) => {
    const users = new Set(pool.users.filter((u) => u.weight > 0).map((u) => u.owner));
    const lines = settled.settlement.members.flatMap((m) => (users.has(m.owner) && Object.hasOwn(settled.names, m.owner) ? [{ owner: m.owner, name: settled.names[m.owner]!, overCents: m.over }] : []));
    return { accountKey: pool.key, month: settled.settlement.month, lines };
  });
}

async function poolSettlements(s: Services, userId: string, month: string, quick = false): Promise<{ pool: Pool; settled: PoolSettlement }[]> {
  const out: { pool: Pool; settled: PoolSettlement }[] = [];
  const all = await namesOf(s);
  for (const pool of await poolsOf(s, userId)) {
    const e = await engineOf(s, pool);
    if (!e) continue;
    const { t, compute, firstMonth } = e;
    // a month is kept as it first reads closed: later answers reach the month after as a `late_change` line, never this one
    const keep = async (done: Settlement, closed: ClosedMonth[]): Promise<ClosedMonth[]> => {
      const row = { accountKey: pool.key, month: done.month, closedOn: done.status.closedOn!, snapshot: JSON.stringify(done), writtenAt: s.now().toISOString() };
      // a request that was there first wrote its own: that one stands
      const kept = (await s.agreements.addClosedMonth(row)) ? (done as ClosedMonth) : (await s.agreements.closedMonths(pool.key)).flatMap((c) => (c.month === done.month ? (closedOf(c) ?? []) : []))[0];
      return kept ? [...closed, kept].sort(byMonth) : closed;
    };
    // every month of the trace that has closed and has none yet, oldest first, so one nobody asked for is frozen near its closing too
    const stored = (await s.agreements.closedMonths(pool.key)).flatMap((c) => closedOf(c) ?? []);
    // a quick answer (the front page) never waits for a long history to be frozen: the pool is left out until a job on the side has done it
    if (quick && unstored(s, e, stored) > QUICK_MONTHS) {
      freezeAside(s, pool.key, () => closeAll(s, e, stored, async (done, closed) => (await pause(ASIDE_PAUSE_MS), keep(done, closed))));
      continue;
    }
    const closed = await closeAll(s, e, stored, keep);
    let done = compute(month, closed);
    if (!done.status.open && firstMonth !== null && month >= firstMonth && !closed.some((c) => c.month === month)) done = (await keep(done, closed)).find((c) => c.month === month) ?? done;
    // only the payers this month's lines name: the other months' are not this month's to show
    const named = namedIn(done.lines);
    const owners = [...pool.users.filter((u) => u.weight > 0).map((u) => u.owner), ...done.members.map((m) => m.owner), ...named, ...done.unknownPaidBy.map((e) => e.owner), ...done.unknownOwedBy.map((e) => e.owner)];
    out.push({ pool, settled: { accountId: pool.ids[0]!, name: pool.name, ...wordsFor(owners, all), labels: Object.fromEntries([...t.labels].filter(([owner]) => named.has(owner))), settlement: done } });
  }
  return out;
}

/** One stored agreement as the member's page reads it. */
interface AgreementItem {
  validFrom: string;
  kind: Kind;
  value: Record<string, unknown>;
  setAt: string;
  /** An income row that is not in force yet: who has put it and who is waited for. The earlier row holds meanwhile. */
  pending?: { confirmed: Owner[]; waiting: Owner[]; /** What this user may do with it: "decline" (named, has not put it), "withdraw" (put it first), or nothing. */ mayRemove: "decline" | "withdraw" | null };
}

interface PoolAgreements {
  accountId: string;
  /** The users the agreements may name, with their words. */
  users: { owner: Owner; name: string }[];
  /** The members who have no login and are named by a row but gone from the household. */
  removed: Owner[];
  agreements: AgreementItem[];
}

/** The agreements of a pool the member is weighted in, oldest first. */
export async function agreementsOf(s: Services, userId: string, accountId: string): Promise<PoolAgreements> {
  const pool = await poolOf(s, userId, accountId);
  const all = await namesOf(s);
  const me = `u:${userId}`;
  // a row that waits for a partner is shown to the users it names and to the one who put it, and to nobody else
  const rows = (await s.agreements.agreementRows([pool.key])).filter((r) => {
    const p = pendingOf(r);
    return !p || p.who.includes(me) || p.confirmed.includes(me);
  });
  return {
    accountId,
    users: pool.users.filter((u) => u.weight > 0 && u.owner !== "u:").map((u) => ({ owner: u.owner, name: all[u.owner] ?? u.owner })),
    removed: wordsFor(rows.flatMap((r) => [...r.value.matchAll(/"(m:[^"]+)"/g)].map((m) => m[1]!)), all).removed,
    agreements: rows.flatMap((r) => {
      const a = agreementOf(r);
      const p = pendingOf(r);
      return a ? [{ validFrom: a.validFrom, kind: a.kind, value: a.value as Record<string, unknown>, setAt: r.setAt, ...(p ? { pending: { confirmed: p.confirmed, waiting: p.waiting, mayRemove: p.waiting.includes(me) ? "decline" : r.setBy === userId ? "withdraw" : null } } : {}) }] : [];
    }),
  };
}

/**
 * Takes back a row that waits for a partner: a user it names who has not put it declines it, the user who put it first
 * withdraws it. Only that pending row goes; a row in force, or one the user does not see, is not found.
 */
export async function removeAgreement(s: Services, userId: string, accountId: string, day: unknown): Promise<PoolAgreements> {
  const pool = await poolOf(s, userId, accountId);
  const validFrom = parseDay(day);
  const me = `u:${userId}`;
  const row = (await s.agreements.agreementRows([pool.key])).find((r) => r.validFrom === validFrom);
  const p = row && pendingOf(row);
  if (!row || !p || !(p.who.includes(me) || p.confirmed.includes(me))) throw new NotFound("Sopimusta ei löydy.");
  if (!p.waiting.includes(me) && row.setBy !== userId) throw new UserError("Sopimusta ei voi poistaa.");
  if (!(await s.agreements.withdrawAgreement(pool.key, validFrom, row.value))) throw new NotFound("Sopimusta ei löydy.");
  return agreementsOf(s, userId, accountId);
}

/** A record of owner to whole cents above zero: every owner one of the pool's users. */
function amounts(value: unknown, owners: ReadonlySet<Owner>): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UserError("Virheellinen sopimus.");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > owners.size) throw new UserError("Valitse tilin käyttäjät.");
  for (const [owner, n] of entries) {
    if (!owners.has(owner)) throw new UserError("Valitse tilin käyttäjät.");
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_CENTS) throw new UserError("Virheellinen osuus.");
  }
  return Object.fromEntries(entries);
}

function who(value: unknown, owners: ReadonlySet<Owner>): string[] {
  if (!Array.isArray(value) || !value.length || value.length > owners.size || new Set(value).size !== value.length || value.some((o) => typeof o !== "string" || !owners.has(o))) {
    throw new UserError("Valitse tilin käyttäjät.");
  }
  return value as string[];
}

/** The value of an agreement checked and written the one way: it names users of the pool who weigh something, and nobody else. */
function parseAgreementValue(kind: Kind, value: unknown, owners: ReadonlySet<Owner>): Record<string, unknown> {
  if (kind === "equal" || kind === "income") return { who: who(strictObject(value, ["who"] as const).who, owners) };
  if (kind === "share") return { weights: amounts(strictObject(value, ["weights"] as const).weights, owners) };
  const fixed = strictObject(value, ["cents", "rest"] as const);
  const out: Record<string, unknown> = { cents: amounts(fixed.cents, owners) };
  if (fixed.rest !== undefined) {
    const rest = strictObject(fixed.rest, ["kind", "weights"] as const);
    if (rest.kind !== "equal" && rest.kind !== "share" && rest.kind !== "income") throw new UserError("Virheellinen sopimus.");
    out.rest = rest.kind === "share" ? { kind: "share", weights: amounts(rest.weights, owners) } : { kind: rest.kind };
  }
  return out;
}

/** Adds an agreement to a pool, or to a card the member holds (its holders only, never `fixed`), from a day. A day that has one already is refused, and an earlier row is never touched. */
export async function addAgreement(s: Services, userId: string, accountId: string, input: { validFrom: unknown; kind: unknown; value: unknown }): Promise<PoolAgreements> {
  const pool = await poolOf(s, userId, accountId);
  const validFrom = parseDay(input.validFrom);
  if (typeof input.kind !== "string" || !(KINDS as readonly string[]).includes(input.kind)) throw new UserError("Virheellinen sopimus.");
  const kind = input.kind as Kind;
  const owners = new Set(pool.users.filter((u) => u.weight > 0 && u.owner !== "u:").map((u) => u.owner));
  const value = parseAgreementValue(kind, input.value, owners);
  const refusal = agreementRefusal({ accountKey: pool.key, validFrom, kind, value }, !!pool.card, [...owners]);
  if (refusal === "fixed_on_card") throw new UserError("Kortille ei voi sopia kiinteää määrää.");
  if (refusal) throw new UserError("Valitse tilin käyttäjät.");
  const me = `u:${userId}`;
  const have = (await s.agreements.agreementRows([pool.key])).find((r) => r.validFrom === validFrom);
  const waiting = have ? pendingOf(have) : null;
  if (have && waiting && have.kind === kind && waiting.who.includes(me) && sameRow(kind, have.value, value)) {
    // the same row from another user it names: put by one more, in force when every named user has put it
    if (!waiting.confirmed.includes(me) && !(await s.agreements.confirmAgreement(pool.key, validFrom, have.value, confirmedBy(have.value, me)))) throw new UserError("Tälle päivälle on jo sopimus.");
  } else {
    // a row that shows the partners' income ratio is put by the one who writes it and waits for the others it names
    const named = namedUsers(kind, value, [...owners]);
    const text = JSON.stringify(named ? { ...value, ...(kind === "fixed" ? { who: named } : {}), confirmed: [me] } : value);
    const added = await s.agreements.addAgreement({ accountKey: pool.key, validFrom, kind, value: text, setBy: userId, setAt: s.now().toISOString() });
    if (!added) throw new UserError("Tälle päivälle on jo sopimus.");
  }
  // a card's agreement says whose its bill is: the parts of the pool that pays it change, and every member's figures with them
  if (pool.card) await bumpAll(s);
  return agreementsOf(s, userId, accountId);
}

/** Every member's data version moves, so what was built from the household is read again. */
const bumpAll = async (s: Services): Promise<void> => {
  await Promise.all((await s.users.list()).map((u) => s.settings.bumpUserDataVersion(u.id)));
};

/** The household members who have no login. */
export async function listMembers(s: Services): Promise<{ id: string; name: string }[]> {
  return (await s.agreements.members()).map(({ id, name }) => ({ id, name }));
}

/** Checks a list of members: names of 1 to 80 characters, one of each (case ignored), ids only of members that exist. */
function parseMembers(value: unknown, known: readonly StoredMember[]): { id?: string; name: string }[] {
  if (!Array.isArray(value) || value.length > MAX_MEMBERS) throw new UserError("Virheellinen jäsenlista.");
  const names = new Set<string>();
  const ids = new Set<string>();
  return value.map((row) => {
    const { id, name } = strictObject(row, ["id", "name"] as const);
    const text = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
    if (!text || text.length > 80 || /\p{Cc}/u.test(text)) throw new UserError("Virheellinen nimi.");
    if (names.has(text.toLowerCase())) throw new UserError("Sama nimi on kahdesti.");
    names.add(text.toLowerCase());
    if (id === undefined || id === null) return { name: text };
    if (typeof id !== "string" || !known.some((m) => m.id === id)) throw new UserError("Jäsentä ei löydy.");
    if (ids.has(id)) throw new UserError("Sama jäsen on kahdesti.");
    ids.add(id);
    return { id, name: text };
  });
}

/** Makes the household members what the list says; the traces are built again with the new names on the next read. */
export async function saveMembers(s: Services, value: unknown): Promise<{ id: string; name: string }[]> {
  const rows = parseMembers(value, await s.agreements.members());
  await s.agreements.replaceMembers(
    rows.map((r) => ({ id: r.id ?? crypto.randomUUID(), name: r.name, isNew: !r.id })),
    s.now().toISOString(),
  );
  await bumpAll(s);
  return listMembers(s);
}

/**
 * The text an imported agreement row is stored as, or null when it is refused: a kind this server knows and a value of the
 * shape the PUT takes (the names in it are checked as to shape only: a file from another instance names the users it had, and
 * a name that is nobody here weighs nothing and is never waited for). One that shows the income ratio is put by the importing
 * user alone, whatever the file says, and waits for the others the pool has.
 */
export async function importedAgreementValue(s: Services, userId: string, key: string, kind: string, value: string): Promise<string | null> {
  if (!(KINDS as readonly string[]).includes(kind)) return null;
  const owners = ((await poolUsers(s, [key])).get(key) ?? []).filter((u) => u.weight > 0 && u.owner !== "u:").map((u) => u.owner);
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const plain = plainValue(kind, parsed as Record<string, unknown>);
    parseAgreementValue(kind as Kind, plain, new Set([...owners, ...[...JSON.stringify(plain).matchAll(/"((?:u|m):[^"]*)"/g)].map((m) => m[1]!)]));
  } catch {
    return null;
  }
  return confirmedByOnly(kind, value, `u:${userId}`, owners);
}
