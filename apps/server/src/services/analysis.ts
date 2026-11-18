/**
 * Builds and caches the analysis context (enriched transactions + recurring
 * series) per user and view. A cache entry is valid while the data versions
 * it was built from are unchanged (the user's own, the owners' of shared
 * accounts in view, and the instance's) and the viewer's parts of the accounts are, so a dashboard request after the
 * first one only filters and sums. The cache holds the context only: the dashboard and the reports are built for
 * each request, with the balances and the user's marks, expected bills and loans from `requestInputs`, so those need no
 * data version.
 */
import { getHeapStatistics } from "node:v8";
import {
  type AccountUse,
  type AnalysisContext,
  applyUse,
  type BalanceInput,
  billCents,
  createContextPausing,
  balanceDayOf,
  dayNumber,
  isNone,
  isUserOwner,
  isWhole,
  type LoanProposal,
  type Part,
  type PaidOf,
  paidRows,
  partCents,
  type RowShare,
  standingCut,
  transfersBetweenMembers,
  type UserInputs,
} from "@banking/core";
import { isCurrencyCode, isEuro } from "../connectors/balance-sign.ts";
import { extensionRowParts, rowPartsKey } from "../extensions.ts";
import type { OwnRows } from "../db/finance-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount, StoredTransaction } from "../db/rows.ts";
import { todayIn } from "../platform/config.ts";
import { yieldToLoop } from "../platform/yield.ts";
import type { Services } from "./context.ts";
import { historyOf } from "./coverage.ts";
import { type HeldLocks, lockedOutside, runsEnded, whenUnlocked, writesOf } from "./enrich.ts";
import { foreignDaysOf } from "./foreign-rows.ts";
import { loansInView } from "./loans-in-view.ts";
import { proposalsOf, type RequestInputs, stampOf } from "./request-inputs.ts";
import { RequestReads } from "./request-reads.ts";
import { statementsInView } from "./statements.ts";
import { settledTrace, sharesOf, type SettledTrace } from "./money-trace.ts";
import type { TraceFacts } from "./money-trace-parts.ts";
import { notAmong, visibleTo } from "./visible-accounts.ts";

/**
 * own = what I use: my accounts and the ones shared with me that I have a part of, a joint account at my part, and
 * nothing of an account somebody else uses alone. household = mine + accounts other members shared with me, each whole.
 */
export type Scope = "own" | "household";
/** The part of an account the sums read in SQL are handed (`OwnRows`): the viewer's part, and who the viewer is where the rows are cut by who paid. */
type ViewPart = OwnRows["parts"] extends ReadonlyMap<string, infer P> ? P : never;
/** What a cache entry holds: a scope, or `used`: the accounts of the own view with their rows whole, for advice on what the household pays together. */
export type View = Scope | "used";

export function parseScope(value: string | undefined): Scope {
  return value === "household" ? "household" : "own";
}

export interface ScopeAccount extends StoredAccount {
  /** Display name of the owner when the account belongs to someone else. */
  ownerName: string | null;
  /** My own copy of a joint account the partner linked too (household view only). */
  joint?: boolean;
  /** Who uses the account. */
  use?: AccountUse;
  /** What the view counts of the account: the viewer's part in the own view. Left out, the account counts whole. */
  part?: Part;
  /** The own view cuts the account's rows by who paid them (it has a trace and a split); `part` stays and cuts the rows with no parts. */
  traced?: true;
  /** A traced account's balance in the own view, from its lots: what the viewer's own money and their part of the rest come to. */
  tracedCents?: number;
}

export interface ScopeData {
  ctx: AnalysisContext;
  accounts: ScopeAccount[];
  /** The viewer's own cents of the rows of the traced accounts, by row id. */
  shares: ReadonlyMap<string, RowShare>;
  /** The rows the view counts otherwise than they are stored, by row id: what the sums read in SQL follow. */
  told: OwnRows["told"];
  /** The fee each payment that arrived short counts as spending (`ctx.fees`), by row id: the lists read in SQL count that for the payment. */
  fees: ReadonlyMap<string, number>;
}

/** The most cached transaction rows over all entries, on a host with plenty of memory. A context costs about 0.8 KB a row, so this is roughly 200 MB. */
const MAX_CACHED_ROWS = 250_000;
/** What a cached context costs a row, about. */
const BYTES_PER_ROW = 800;
/** The share of V8's heap limit the cached contexts may fill: a build in progress, a request and the rest of the process need the remainder. */
const HEAP_SHARE = 0.3;
/** Under this the cache would hold less than a household of a few years, so a small heap does not go below it. */
const MIN_CACHED_ROWS = 20_000;

/**
 * The row budget for a heap limit. The container has 512 MB, which gives Node a heap limit of about 270 MB, and the
 * fixed 250 000 rows (200 MB) would fill most of that before the least recently used entry went: the process dies
 * of an exhausted heap instead of dropping an entry.
 */
export function rowBudgetFor(heapLimitBytes: number): number {
  return Math.min(MAX_CACHED_ROWS, Math.max(MIN_CACHED_ROWS, Math.floor((heapLimitBytes * HEAP_SHARE) / BYTES_PER_ROW)));
}
/** An entry nobody asked for in this long is dropped. */
const IDLE_MS = 60 * 60_000;

interface Entry {
  /** What it was built from: the data versions (instance, the user and the owners of the shared accounts in view) and the viewer's part of each account. */
  version: string;
  /** The users whose data versions are in `version`, sorted as there. */
  ids: readonly string[];
  /** `runsEnded` of `ids` when the build started. */
  runs: string;
  today: string;
  data: Promise<ScopeData>;
  /** Transaction rows in the context; 0 while it is being built. */
  rows: number;
  lastUsed: number;
}

export interface CacheOptions {
  maxRows?: number;
  idleMs?: number;
  /** For tests. */
  clock?: () => number;
}

/**
 * One entry per user and view. The day and the data versions are kept in the entry, so a new day or a change
 * replaces it where a key with the day in it left the old one in memory until the entry count ran out. The
 * budget counts rows, not entries: a household with long histories fills it sooner than a small one. The
 * least recently used entries go first, and the entry just asked for always stays.
 */
export class AnalysisCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxRows: number;
  private readonly idleMs: number;
  private readonly clock: () => number;

  constructor(opts: CacheOptions = {}) {
    this.maxRows = opts.maxRows ?? rowBudgetFor(getHeapStatistics().heap_size_limit);
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.clock = opts.clock ?? Date.now;
  }

  /** What the cache holds now (tests and the health of the process). */
  stats(): { entries: number; rows: number } {
    return { entries: this.entries.size, rows: [...this.entries.values()].reduce((n, e) => n + e.rows, 0) };
  }

  /**
   * `held`: the users whose lock the caller runs under (the after hook of a reprocess); such a caller never waits.
   * `reads`: what the request has read of the household already (`RequestReads`); a request that asks again hands it on.
   */
  get(s: Services, userId: string, requested: View, held: HeldLocks = new Set(), reads?: RequestReads): Promise<ScopeData> {
    return this.read(s, userId, requested, held, false, reads);
  }

  private async read(s: Services, userId: string, requested: View, held: HeldLocks, waited: boolean, reads?: RequestReads): Promise<ScopeData> {
    const today = s.today();
    // a view with nothing of its own to show is the own view: one entry, not two
    const inView = await accountsInView(s, userId, requested, reads);
    const ids = [...new Set([userId, ...inView.accounts.map((a) => a.userId)])].sort();
    const version = await s.settings.dataVersionOf(ids);
    // which accounts are in view and at what part belongs to the version: a share or a use that changes it must not
    // serve the old view, and a use derived from the holders' names changes with no data version moving. So does what a
    // traced account's rows were cut with
    const versionKey = `${version}|${[...inView.parts].map(([id, part]) => `${id}:${part.from}-${part.to}/${part.of}`).sort().join(",")}|${[...inView.traces].map(([id, f]) => `${id}:${f.signature}`).sort().join(",")}|${await rowPartsKey(s, userId)}`;
    if (!waited && lockedOutside(ids, held)) {
      // a reprocess of a user in view runs and the rows read now may be part of its writes. What was built just before
      // it is a whole answer when only that run moves it: the same users, no run of theirs ended since, and every
      // version but the locked users' the same (a share that ended moves the others' and the parts). Else the answer
      // is the one after the run
      const before = this.entries.get(`${userId}:${inView.view}`);
      if (before && before.today === today && before.ids.join() === ids.join() && before.runs === runsEnded(ids) && masked(before.version, ids) === masked(versionKey, ids)) {
        before.lastUsed = this.clock();
        return before.data;
      }
      await whenUnlocked(ids);
      // the run wrote while this request waited: what it read of the household is read again
      reads?.changed();
      return this.read(s, userId, requested, held, true, reads);
    }
    const key = `${userId}:${inView.view}`;
    // shares or parts that ended: the old entry would only wait for the idle limit
    if (requested !== inView.view) this.entries.delete(`${userId}:${requested}`);
    const now = this.clock();
    const hit = this.entries.get(key);
    // a build in progress is shared too: the dashboard and reports often ask at once
    if (hit && hit.version === versionKey && hit.today === today) {
      hit.lastUsed = now;
      // most recently used last
      this.entries.delete(key);
      this.entries.set(key, hit);
      this.trim(key);
      return hit.data;
    }

    const entry: Entry = {
      version: versionKey,
      ids,
      runs: runsEnded(ids, held),
      today,
      data: settledScope(s, userId, inView, today, ids, held).then(({ data, settled }) => {
        if (!settled && this.entries.get(key) === entry) this.entries.delete(key);
        return data;
      }),
      rows: 0,
      lastUsed: now,
    };
    this.entries.set(key, entry);
    // a failed build is not kept
    entry.data.catch(() => this.entries.get(key) === entry && this.entries.delete(key));
    void entry.data.then((d) => {
      entry.rows = d.ctx.txs.length + (d.ctx.standing?.txs.length ?? 0);
      this.trim(key);
    }, () => undefined);
    this.trim(key);
    return entry.data;
  }

  /** Drops idle entries, then the least recently used until the rows fit. `keep` is never dropped. */
  private trim(keep: string): void {
    const now = this.clock();
    for (const [k, e] of this.entries) if (k !== keep && now - e.lastUsed > this.idleMs) this.entries.delete(k);
    let rows = 0;
    for (const e of this.entries.values()) rows += e.rows;
    for (const [k, e] of this.entries) {
      if (rows <= this.maxRows) break;
      if (k === keep) continue;
      this.entries.delete(k);
      rows -= e.rows;
    }
  }
}

/** `versionKey` with the data versions of the users whose lock is held set aside: their run moves them. */
function masked(versionKey: string, ids: readonly string[]): string {
  const [version, ...rest] = versionKey.split("|");
  return [version!.split(".").map((v, i) => (i > 0 && lockedOutside([ids[i - 1]!]) ? "*" : v)).join("."), ...rest].join("|");
}

/**
 * `loadScope`, read again when a reprocess wrote rows of the users in view while it read them: a read that gives the loop
 * back between pages can see some pieces of a write and not others. The second read waits for the run to end.
 */
async function settledScope(s: Services, userId: string, inView: InView, today: string, ids: readonly string[], held: HeldLocks): Promise<{ data: ScopeData; settled: boolean }> {
  for (;;) {
    const before = writesOf(ids);
    const data = await loadScope(s, userId, inView, today);
    if (writesOf(ids) === before) return { data, settled: true };
    // under a lock nothing waits on another lock (two members' runs would wait on each other): the read serves this
    // caller and is not kept
    if (held.size) return { data, settled: false };
    await whenUnlocked(ids);
  }
}

/** The accounts of a view as they are read. */
interface InView {
  /** The view that is read: the one asked for, or the own view when that one would hold the same. */
  view: View;
  /** The accounts in it, each with its use and what the view counts of it. */
  accounts: ScopeAccount[];
  /** The viewer's own accounts the view leaves out: somebody else uses them alone. */
  left: ScopeAccount[];
  /** The viewer's part of every account the viewer may see, by account id. */
  parts: Map<string, Part>;
  /** What the traced accounts of the own view were cut with, by account id. */
  traces: Map<string, TraceFacts>;
}

/**
 * Which accounts a view holds. The own view: the viewer's accounts and the ones shared with them, each when the viewer
 * has a part of it. The household view: all of them, whole; it is the own view when nobody shares with the viewer and
 * every account of theirs is theirs whole. `used` is the own view's accounts counted whole, and the own view itself
 * when that cuts nothing.
 */
async function accountsInView(s: Services, userId: string, requested: View, reads?: RequestReads): Promise<InView> {
  const { own, offered, shared, uses, traces } = await visibleTo(s, userId, reads);
  const parts = new Map([...uses].map(([id, { part }]) => [id, part]));
  const seen = (a: ScopeAccount): ScopeAccount & { part: Part } => ({ ...a, ...uses.get(a.id)! });
  const mine = own.map((a) => seen({ ...a, ownerName: null }));
  const all = [...mine, ...shared.map(seen)];

  if (requested === "household" && (shared.length || mine.some((a) => !isWhole(a.part)))) {
    // a joint account the partner linked too is left out of `shared`: flag my copy, so it is never split to a person
    const partners = new Set(offered.map((a) => a.identity).filter(Boolean));
    const whole = all.map(({ part: _part, traced: _traced, ...a }): ScopeAccount => (a.userId === userId && a.identity && partners.has(a.identity) ? { ...a, joint: true } : a));
    return { view: "household", accounts: whole, left: [], parts, traces: new Map() };
  }
  const accounts = all.filter((a) => !isNone(a.part));
  const left = mine.filter((a) => isNone(a.part));
  if (requested === "used" && accounts.some((a) => !isWhole(a.part))) return { view: "used", accounts: accounts.map(({ part: _part, traced: _traced, ...a }) => a), left, parts, traces: new Map() };
  return { view: "own", accounts, left, parts, traces: new Map([...traces].filter(([id, f]) => f.traced && accounts.some((a) => a.id === id))) };
}

/** A row cut to a part, as the bank booked it. */
function uncut(t: StoredTransaction): StoredTransaction {
  if (t.wholeCents === undefined) return t;
  const { wholeCents: _whole, ...row } = t;
  return { ...row, amountCents: billCents(t) };
}

/** The local day a time stands for: the books count local days, so a balance given at 1.30 already holds that morning's rows. */
function localDay(s: Services, at: string | null): string | null {
  const when = at ? new Date(at) : null;
  return when && !Number.isNaN(when.getTime()) ? todayIn(s.instance.current.timezone, when) : null;
}

/**
 * The balance of a traced account in the own view, as of the day its balance stands for: what the viewer's own lots come
 * to and their part of the rest (the lots nobody owns, less what the account owes its own spending), less what the rows
 * booked after that day moved for them.
 */
function tracedBalance(t: SettledTrace, userId: string, part: Part, day: number, shares: ReadonlyMap<string, RowShare>): number {
  const mine = `u:${userId}`;
  const lots = t.trace.lots.reduce((sum, l) => (l.owner === mine ? sum + l.cents : sum), 0);
  const loose = t.trace.lots.reduce((sum, l) => (isUserOwner(l.owner) ? sum : sum + l.cents), 0) - t.trace.creditCents;
  const later = t.trace.rows.reduce((sum, r) => (r.day > day && !r.pending ? sum + (r.ids.length ? (shares.get(r.ids[0]!)?.cents ?? 0) : 0) : sum), 0);
  return lots + partCents(loose, part) - later;
}

/** The traced accounts of the own view: the viewer's cents of their rows and each one's balance. An account whose trace is gone counts by its part. */
async function tracedShares(s: Services, userId: string, accounts: readonly ScopeAccount[], today: string): Promise<{ accounts: ScopeAccount[]; shares: Map<string, RowShare>; paid: Map<string, PaidOf> }> {
  const shares = new Map<string, RowShare>();
  const paid = new Map<string, PaidOf>();
  const counted = await Promise.all(
    accounts.map(async (a): Promise<ScopeAccount> => {
      const t = a.traced && a.part ? await settledTrace(s, accountKey(a)) : null;
      if (!t || !a.part) {
        const { traced: _traced, ...rest } = a;
        return rest;
      }
      const own = sharesOf(t, userId, a.part);
      for (const [id, share] of own) shares.set(id, share);
      for (const [id, evidence] of paidRows(t.trace.rows, `u:${userId}`)) paid.set(id, evidence);
      return { ...a, tracedCents: tracedBalance(t, userId, a.part, dayNumber(balanceDayOf(localDay(s, a.balanceAt), today)), own) };
    }),
  );
  return { accounts: counted, shares, paid };
}

async function loadScope(s: Services, userId: string, inView: InView, today: string): Promise<ScopeData> {
  const { view, left, parts } = inView;
  const traced = view === "own" ? await tracedShares(s, userId, inView.accounts, today) : { accounts: inView.accounts, shares: new Map<string, RowShare>(), paid: new Map<string, PaidOf>() };
  const { accounts, shares, paid } = traced;
  const theirs = accounts.filter((a) => a.userId !== userId).map((a) => a.id);
  let txs: readonly StoredTransaction[] = await s.finance(userId).allTransactions();
  if (theirs.length) txs = [...txs, ...(await s.household.transactionsOfAccounts(theirs))];
  const told = new Map<string, Pick<StoredTransaction, "category" | "categorySource" | "isTransfer">>();
  let standing: readonly StoredTransaction[] | undefined;
  if (view === "household") {
    if (theirs.length) txs = neutraliseTransfersBetweenMembers(txs, accounts);
  } else {
    // the rows of an account left out say where the money of the others went, so they are read and then dropped
    const read = [...accounts, ...left];
    const stored = new Map(txs.map((t) => [t.id, t]));
    const owners = new Map(read.map((a) => [a.id, a.userId]));
    // what is ahead keeps the stable cut: only a view with a pool cut by who paid reads the rows cut by the parts as well,
    // and a series there is cut as the past cut its recent rows: by who paid them, the weights sharing what nobody owns
    if (shares.size) standing = standingCut(applyUse(txs, read, parts, owners), parts, paid);
    txs = applyUse(txs, read, parts, owners, shares);
    // this is the one place that decides what a row counts as in the view: the sums read in SQL are handed the answer
    for (const { id, category, categorySource, isTransfer } of txs) {
      const was = stored.get(id)!;
      if (was.category !== category || was.isTransfer !== isTransfer) told.set(id, { category, categorySource, isTransfer });
    }
    // a row that is money between people or between pools is a transfer for every member, also for one whose share of it is 0
    for (const [id, share] of shares) {
      const was = stored.get(id);
      if (share.cents === 0 && share.transfer && was && was.categorySource !== "user" && !was.isTransfer) told.set(id, { category: "transfer", categorySource: was.categorySource, isTransfer: true });
    }
    if (view === "used") txs = txs.map(uncut);
  }
  // the rows of card statements read in the page: of the members whose accounts are in the view, each at the viewer's part
  const statements = await statementsInView(s, accounts, [...txs, ...(standing ?? [])], parts);
  // the build gives the event loop back between its stages: a long history takes seconds, and every member waits on one thread
  const ctx = await createContextPausing(yieldToLoop, txs, accounts, today, standing, await foreignDaysOf(s, userId, accounts), await historyOf(s, accounts), statements);
  // an extension tells only of the viewer's own rows, in the categories the view counts them in and at the bank's whole
  // amounts, which its match reads; core cuts the parts to what each row counts
  const own = new Set(accounts.filter((a) => a.userId === userId).map((a) => a.id));
  const rowParts = await extensionRowParts(s, userId, txs.filter((t) => own.has(t.accountId)).map(uncut));
  if (rowParts) ctx.rowParts = rowParts;
  // a payment that arrived short is a transfer and spending on Pankkikulut at once: the context decided it, so the lists say the same
  for (const t of ctx.fees.size ? ctx.txs : []) {
    if (ctx.fees.has(t.id)) told.set(t.id, { category: t.category, categorySource: t.categorySource, isTransfer: t.isTransfer });
  }
  return { ctx, accounts, shares, told, fees: ctx.fees };
}

/**
 * What the lists and sums read in SQL need of a view: the other members' accounts in it, and for the own view the
 * accounts it leaves out, the parts it cuts amounts by and the rows it counts otherwise than they are stored. The same
 * accounts and the same rows as the cached context of the view: the rows come from it, and so do the fees of payments
 * that arrived short, which the household view has as well.
 */
export async function rowsInView(s: Services, userId: string, scope: Scope, reads = new RequestReads()): Promise<{ shared: ScopeAccount[]; own: OwnRows; ctx: AnalysisContext }> {
  const { view, accounts, left } = await accountsInView(s, userId, scope, reads);
  const parts = new Map(accounts.flatMap((a): [string, ViewPart][] => (a.part && (a.traced || !isWhole(a.part)) ? [[a.id, a.traced ? { ...a.part, viewer: `u:${userId}` } : a.part]] : [])));
  const data = await s.analysis.get(s, userId, view, undefined, reads);
  return { shared: accounts.filter((a) => a.userId !== userId), own: { left: left.map((a) => a.id), loans: [...data.ctx.loanAccounts], parts, told: data.told, shares: data.shares, fees: data.fees }, ctx: data.ctx };
}

/**
 * What a dashboard or report request needs next to the cached context: the balances of the accounts in view and the
 * user's own marks and expected bills, the loans of the view (`loansInView`) and the published euribor fixings they
 * follow (`loansOf` turns them into each loan's rate path). Read for each request, never cached. A balance and a
 * credit limit are the viewer's part where the view counts the account at a part.
 */
export async function requestInputs(s: Services, userId: string, accounts: readonly ScopeAccount[]): Promise<RequestInputs> {
  const repo = s.finance(userId);
  const [marks, expectedBills, loans, roles, fixings] = await Promise.all([repo.listMarks(), repo.listExpectedBills(), loansInView(s, userId, accounts), repo.payerRoles(), s.referenceRates.all()]);
  const counted = (cents: number | null, a: ScopeAccount) => (cents === null || !a.part ? cents : partCents(cents, a.part));
  // The totals and the walks count in euros: an account in another currency tells its balance beside them, never in them.
  // A balance stored before the currency was kept is the account's currency's: one whose currency is unknown is a dash.
  const balances = accounts.map((a): BalanceInput => ({
    id: a.id,
    name: a.ownerName ? `${a.name} (${a.ownerName})` : a.name,
    type: a.type,
    balanceCents: !isEuro(a.currency) ? null : a.traced && a.tracedCents !== undefined && a.balanceCents !== null ? a.tracedCents : counted(a.balanceCents, a),
    ...(!isEuro(a.currency) && isCurrencyCode(a.currency) && a.balanceCents !== null ? { foreign: { currency: a.currency.trim().toUpperCase(), cents: counted(a.balanceCents, a)! } } : {}),
    ownerName: a.ownerName,
    balanceAt: localDay(s, a.balanceAt),
    // another member's account carries no bank, as the account lists leave it out (routes/finance.ts); its mask and limit
    // are in `sharedAccounts` of /meta already, since the member may see the account it was shared
    bank: a.ownerName ? null : (a.bank ?? null),
    cardMask: a.cardMask,
    creditLimitCents: counted(a.creditLimitCents, a),
    // an account with two users is nobody's alone, whoever linked it
    ...(a.joint || (a.use?.users.length ?? 0) > 1 ? { joint: true } : {}),
    ...(a.use ? { use: a.use } : {}),
    ...(a.part ? { part: a.part } : {}),
    ...(a.traced ? { traced: true as const } : {}),
  }));
  const inputs: UserInputs = { marks, expectedBills, loans, fixings, payers: { memberId: userId, roles } };
  return { balances, inputs, stamp: stampOf(balances, inputs) };
}

/**
 * The loans to propose to the viewer: by default worked out from the viewer's own rows, marks and loans, whatever view
 * a page is in. The list in Asetukset > Lainat and the question on the front page both read this one, so the front page
 * names no proposal the list leaves out. Only the front page's total of unsaved loans asks for the view's own scope,
 * since its monthly figures follow the view (a joint loan's whole payment in the household's view).
 */
export async function proposalsFor(s: Services, userId: string, scope: Scope = "own", reads?: RequestReads): Promise<LoanProposal[]> {
  const { ctx, accounts } = await s.analysis.get(s, userId, scope, undefined, reads);
  return proposalsOf(ctx, await requestInputs(s, userId, accounts));
}

/**
 * Accounts other members shared with me, as the household view counts them.
 * A joint account linked by both partners is the same real account: only my
 * own copy is kept. The account lists use this, and the views of the dashboard,
 * the transaction list and the export keep the same rule (`accountsInView`),
 * so none of them shows a joint account twice.
 */
export async function sharedInView(s: Services, userId: string, own?: readonly StoredAccount[]): Promise<ScopeAccount[]> {
  return (await s.household.sharedWith(userId)).filter(notAmong(own ?? (await s.finance(userId).listAccounts())));
}

/**
 * Each owner's transactions are enriched on their own. Money between two members' accounts is a transfer in both
 * views by IBAN (`householdIbans`), so this pass only catches the legs that name no IBAN and are paired by amount and
 * day, and the money in that follows a payment to another member's account, which the bank gives no payer account on.
 * In the household view both legs are internal: mark them as transfers (in memory only, nothing is written back).
 */
function neutraliseTransfersBetweenMembers(txs: readonly StoredTransaction[], accounts: readonly ScopeAccount[]): StoredTransaction[] {
  // no issuer fallback: it would let a member's card make my unconnected card's bill disappear
  const owners = new Map(accounts.map((a) => [a.id, a.userId]));
  const transfers = transfersBetweenMembers(txs, accounts, (accountId) => owners.get(accountId) ?? "");
  return txs.map((t): StoredTransaction => (transfers.has(t.id) && !t.isTransfer ? { ...t, isTransfer: true, category: "transfer" } : t));
}
