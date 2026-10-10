/**
 * Builds and caches the analysis context (enriched transactions + recurring
 * series) per user and scope. A cache entry is valid while the data versions
 * it was built from are unchanged (the user's own, the owners' of shared
 * accounts in view, and the instance's), so a dashboard request after the
 * first one only filters and sums.
 */
import { type Account, type AnalysisContext, createContext, detectTransfers } from "@banking/core";
import type { StoredAccount, StoredTransaction } from "../db/rows.ts";
import type { Services } from "./context.ts";

/** own = my accounts; household = mine + accounts other members shared with me. */
export type Scope = "own" | "household";

export function parseScope(value: string | undefined): Scope {
  return value === "household" ? "household" : "own";
}

export interface ScopeAccount extends StoredAccount {
  /** Display name of the owner when the account belongs to someone else. */
  ownerName: string | null;
}

export interface ScopeData {
  ctx: AnalysisContext;
  accounts: ScopeAccount[];
}

/** Cached transaction rows over all entries. A context costs about 0.8 KB a row, so this is roughly 200 MB. */
const MAX_CACHED_ROWS = 250_000;
/** An entry nobody asked for in this long is dropped. */
const IDLE_MS = 60 * 60_000;

interface Entry {
  /** The data versions it was built from (instance, the user and the owners of the shared accounts in view). */
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
 * One entry per user and scope. The day and the data versions are kept in the entry, so a new day or a change
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

  async get(s: Services, userId: string, requested: Scope): Promise<ScopeData> {
    const today = s.today();
    // the household view of a member nobody shares with is their own view: one entry, not two
    const shared = requested === "household" ? await sharedInView(s, userId) : [];
    const scope: Scope = shared.length ? "household" : "own";
    const version = await s.settings.dataVersionOf([userId, ...shared.map((a) => a.userId)]);
    // which accounts are in view belongs to the version: a share that changes it must not serve the old view
    const versionKey = shared.length ? `${version}|${shared.map((a) => a.id).sort().join(",")}` : version;
    const key = `${userId}:${scope}`;
    // shares that ended: the old household entry would only wait for the idle limit
    if (requested === "household" && scope === "own") this.entries.delete(`${userId}:household`);
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

    const entry: Entry = { version: versionKey, today, data: loadScope(s, userId, scope, today, shared), rows: 0, lastUsed: now };
    this.entries.set(key, entry);
    // a failed build is not kept
    entry.data.catch(() => this.entries.get(key) === entry && this.entries.delete(key));
    void entry.data.then((d) => {
      entry.rows = d.ctx.txs.length;
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

async function loadScope(s: Services, userId: string, scope: Scope, today: string, shared: readonly ScopeAccount[]): Promise<ScopeData> {
  const repo = s.finance(userId);
  const own = await repo.listAccounts();
  let accounts: ScopeAccount[] = own.map((a) => ({ ...a, ownerName: null }));
  let txs: StoredTransaction[] = await repo.allTransactions();

  if (scope === "household" && shared.length) {
    accounts = [...accounts, ...shared];
    txs = [...txs, ...(await s.household.transactionsOfAccounts(shared.map((a) => a.id)))];
    txs = neutraliseTransfersBetweenMembers(txs, accounts);
  }
  return { ctx: createContext(txs, accounts, today), accounts };
}

/**
 * Accounts other members shared with me, as the household view counts them.
 * A joint account linked by both partners is the same real account: only my
 * own copy is kept. The dashboard, the transaction list and the export all
 * use this, so none of them shows a joint account twice.
 */
export async function sharedInView(s: Services, userId: string, own?: readonly StoredAccount[]): Promise<ScopeAccount[]> {
  const mine = own ?? (await s.finance(userId).listAccounts());
  const ownIdentities = new Set(mine.map((a) => a.identity).filter(Boolean));
  return (await s.household.sharedWith(userId)).filter((a) => !a.identity || !ownIdentities.has(a.identity));
}

/**
 * Each owner's transactions are enriched on their own, so money sent from my
 * account to my partner's is "other" for me and "income" for them. In the
 * household view both legs are internal: mark them as transfers (in memory
 * only, nothing is written back).
 */
function neutraliseTransfersBetweenMembers(txs: StoredTransaction[], accounts: Account[]): StoredTransaction[] {
  // the issuer fallback would let a member's card make my unconnected card's bill disappear
  const transfers = detectTransfers(txs, accounts, { issuerFallback: false });
  return txs.map((t): StoredTransaction => (transfers.has(t.id) && !t.isTransfer ? { ...t, isTransfer: true, category: "transfer" } : t));
}


