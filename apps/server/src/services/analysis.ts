/**
 * Builds and caches the analysis context (enriched transactions + recurring
 * series) per user and view. A cache entry is valid while the data versions
 * it was built from are unchanged (the user's own, the owners' of shared
 * accounts in view, and the instance's) and the viewer's parts of the accounts are, so a dashboard request after the
 * first one only filters and sums. The cache holds the context only: the dashboard and the reports are built for
 * each request, with the balances and the user's marks, expected bills and loans from `requestInputs`, so those need no
 * data version.
 */
import {
  type Account,
  type AccountUse,
  type AnalysisContext,
  applyUse,
  type BalanceInput,
  billCents,
  createContext,
  detectTransfers,
  balanceDayOf,
  dayNumber,
  isNone,
  isUserOwner,
  isWhole,
  type LoanProposal,
  loanProposals,
  type Part,
  partCents,
  type RowShare,
  type WhyCollector,
  type UserInputs,
} from "@banking/core";
import { isCurrencyCode, isEuro } from "../connectors/balance-sign.ts";
import type { OwnRows } from "../db/finance-repo.ts";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount, StoredTransaction } from "../db/rows.ts";
import { todayIn } from "../platform/config.ts";
import { isPool, usesInView } from "./account-use.ts";
import type { Services } from "./context.ts";
import { historyOf } from "./coverage.ts";
import { foreignDaysOf } from "./foreign-rows.ts";
import { loansInView } from "./loans-in-view.ts";
import { statementsInView } from "./statements.ts";
import { ensureTrace, settledTrace, sharesOf, type SettledTrace, type TraceFacts } from "./money-trace.ts";

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
}

/** Cached transaction rows over all entries. A context costs about 0.8 KB a row, so this is roughly 200 MB. */
const MAX_CACHED_ROWS = 250_000;
/** An entry nobody asked for in this long is dropped. */
const IDLE_MS = 60 * 60_000;

interface Entry {
  /** What it was built from: the data versions (instance, the user and the owners of the shared accounts in view) and the viewer's part of each account. */
  version: string;
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
    this.maxRows = opts.maxRows ?? MAX_CACHED_ROWS;
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.clock = opts.clock ?? Date.now;
  }

  /** What the cache holds now (tests and the health of the process). */
  stats(): { entries: number; rows: number } {
    return { entries: this.entries.size, rows: [...this.entries.values()].reduce((n, e) => n + e.rows, 0) };
  }

  async get(s: Services, userId: string, requested: View): Promise<ScopeData> {
    const today = s.today();
    // a view with nothing of its own to show is the own view: one entry, not two
    const inView = await accountsInView(s, userId, requested);
    const version = await s.settings.dataVersionOf([userId, ...inView.accounts.map((a) => a.userId)]);
    // which accounts are in view and at what part belongs to the version: a share or a use that changes it must not
    // serve the old view, and a use derived from the holders' names changes with no data version moving. So does what a
    // traced account's rows were cut with
    const versionKey = `${version}|${[...inView.parts].map(([id, part]) => `${id}:${part.from}-${part.to}/${part.of}`).sort().join(",")}|${[...inView.traces].map(([id, f]) => `${id}:${f.signature}`).sort().join(",")}`;
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

    const entry: Entry = { version: versionKey, today, data: loadScope(s, userId, inView, today), rows: 0, lastUsed: now };
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
 * The use of each account, with the trace of every pool among them made sure of first: a pool whose parts were built
 * from something else than the household holds now is built again, and the app may set its split. The uses are read
 * again when that changed what they say (the mode, whether the account is traced).
 */
export async function usesWithTraces(s: Services, userId: string, accounts: readonly StoredAccount[]): Promise<{ uses: Awaited<ReturnType<typeof usesInView>>; traces: Map<string, TraceFacts> }> {
  let uses = await usesInView(s, userId, accounts);
  const keys = [...new Set(accounts.filter((a) => isPool(uses.get(a.id)?.use)).map(accountKey))];
  const found = new Map((await Promise.all(keys.map(async (key) => [key, await ensureTrace(s, key)] as const))).flatMap(([key, facts]) => (facts ? [[key, facts] as const] : [])));
  const traces = new Map(accounts.flatMap((a): [string, TraceFacts][] => (found.has(accountKey(a)) ? [[a.id, found.get(accountKey(a))!]] : [])));
  const moved = [...traces].some(([id, f]) => !!f.traced !== !!uses.get(id)!.traced || !!f.split !== (uses.get(id)!.use.mode === "source"));
  if (moved) uses = await usesInView(s, userId, accounts);
  return { uses, traces };
}

/**
 * Which accounts a view holds. The own view: the viewer's accounts and the ones shared with them, each when the viewer
 * has a part of it. The household view: all of them, whole; it is the own view when nobody shares with the viewer and
 * every account of theirs is theirs whole. `used` is the own view's accounts counted whole, and the own view itself
 * when that cuts nothing.
 */
async function accountsInView(s: Services, userId: string, requested: View): Promise<InView> {
  const own = await s.finance(userId).listAccounts();
  const offered = await s.household.sharedWith(userId);
  const shared = offered.filter(notAmong(own));
  const { uses, traces } = await usesWithTraces(s, userId, [...own, ...shared]);
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

/** A view built again, uncached, with the reasons its rows count as they do collected: what "Miksi?" reads. */
export async function scopeWithReasons(s: Services, userId: string, requested: Scope, why: WhyCollector): Promise<ScopeData> {
  return loadScope(s, userId, await accountsInView(s, userId, requested), s.today(), why);
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
async function tracedShares(s: Services, userId: string, accounts: readonly ScopeAccount[], today: string): Promise<{ accounts: ScopeAccount[]; shares: Map<string, RowShare> }> {
  const shares = new Map<string, RowShare>();
  const counted = await Promise.all(
    accounts.map(async (a): Promise<ScopeAccount> => {
      const t = a.traced && a.part ? await settledTrace(s, accountKey(a)) : null;
      if (!t || !a.part) {
        const { traced: _traced, ...rest } = a;
        return rest;
      }
      const own = sharesOf(t, userId, a.part);
      for (const [id, share] of own) shares.set(id, share);
      return { ...a, tracedCents: tracedBalance(t, userId, a.part, dayNumber(balanceDayOf(localDay(s, a.balanceAt), today)), own) };
    }),
  );
  return { accounts: counted, shares };
}

async function loadScope(s: Services, userId: string, inView: InView, today: string, why?: WhyCollector): Promise<ScopeData> {
  const { view, left, parts } = inView;
  const traced = view === "own" ? await tracedShares(s, userId, inView.accounts, today) : { accounts: inView.accounts, shares: new Map<string, RowShare>() };
  const { accounts, shares } = traced;
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
    // what is ahead keeps the stable cut: only a view with a pool cut by who paid reads the rows cut by the parts as well
    if (shares.size) standing = applyUse(txs, read, parts, owners);
    txs = applyUse(txs, read, parts, owners, shares, why);
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
  return { ctx: createContext(txs, accounts, today, standing, await foreignDaysOf(s, userId, accounts), await historyOf(s, accounts), statements, why), accounts, shares, told };
}

/**
 * What the lists and sums read in SQL need of a view: the other members' accounts in it, and for the own view the
 * accounts it leaves out, the parts it cuts amounts by and the rows it counts otherwise than they are stored. The same
 * accounts and the same rows as the cached context of the view: the rows come from it. A view that cuts nothing
 * counts every row as it is stored, so no context is asked for.
 */
export async function rowsInView(s: Services, userId: string, scope: Scope): Promise<{ shared: ScopeAccount[]; own: OwnRows }> {
  const { view, accounts, left } = await accountsInView(s, userId, scope);
  const parts = new Map(accounts.flatMap((a): [string, ViewPart][] => (a.part && (a.traced || !isWhole(a.part)) ? [[a.id, a.traced ? { ...a.part, viewer: `u:${userId}` } : a.part]] : [])));
  const data = view === "own" && (left.length || parts.size) ? await s.analysis.get(s, userId, "own") : null;
  return { shared: accounts.filter((a) => a.userId !== userId), own: { left: left.map((a) => a.id), parts, told: data?.told ?? new Map(), shares: data?.shares ?? new Map() } };
}

/**
 * What a dashboard or report request needs next to the cached context: the balances of the accounts in view and the
 * user's own marks and expected bills, and the loans of the view (`loansInView`). Read for each request, never
 * cached. A balance and a credit limit are the viewer's part where the view counts the account at a part.
 */
export async function requestInputs(s: Services, userId: string, accounts: readonly ScopeAccount[]): Promise<{ balances: BalanceInput[]; inputs: UserInputs }> {
  const repo = s.finance(userId);
  const [marks, expectedBills, loans, roles] = await Promise.all([repo.listMarks(), repo.listExpectedBills(), loansInView(s, userId, accounts), repo.payerRoles()]);
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
  return { balances, inputs: { marks, expectedBills, loans, payers: { memberId: userId, roles } } };
}

/**
 * The loans to propose to the viewer: worked out from the viewer's own rows, marks and loans, whatever view a page
 * is in. The list in Asetukset > Lainat and the question on the front page both read this one, so the front page
 * names no proposal the list leaves out.
 */
export async function proposalsFor(s: Services, userId: string): Promise<LoanProposal[]> {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const { inputs } = await requestInputs(s, userId, accounts);
  return loanProposals(ctx, inputs);
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

/** Whether an account is another real account than each of `own`: my copy of a joint account wins over the partner's. */
function notAmong(own: readonly StoredAccount[]): (a: StoredAccount) => boolean {
  const identities = new Set(own.map((a) => a.identity).filter(Boolean));
  return (a) => !a.identity || !identities.has(a.identity);
}

/**
 * Each owner's transactions are enriched on their own, so money sent from my
 * account to my partner's is "other" for me and "income" for them. In the
 * household view both legs are internal: mark them as transfers (in memory
 * only, nothing is written back).
 */
function neutraliseTransfersBetweenMembers(txs: readonly StoredTransaction[], accounts: Account[]): StoredTransaction[] {
  // the issuer fallback would let a member's card make my unconnected card's bill disappear
  const transfers = detectTransfers(txs, accounts, { issuerFallback: false });
  return txs.map((t): StoredTransaction => (transfers.has(t.id) && !t.isTransfer ? { ...t, isTransfer: true, category: "transfer" } : t));
}
