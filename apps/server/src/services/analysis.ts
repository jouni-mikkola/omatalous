/**
 * Builds and caches the analysis context (enriched transactions + recurring
 * series) per user and scope. A cache entry is valid while the instance's
 * data version is unchanged, so a dashboard request after the first one
 * only filters and sums.
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

const MAX_ENTRIES = 32;

export class AnalysisCache {
  private readonly entries = new Map<string, { version: string; data: Promise<ScopeData> }>();

  async get(s: Services, userId: string, scope: Scope): Promise<ScopeData> {
    const today = s.today();
    const key = `${userId}:${scope}:${today}`;
    const version = await s.settings.dataVersion();
    const hit = this.entries.get(key);
    // a build in progress is shared too: the dashboard and reports often ask at once
    if (hit && hit.version === version) return hit.data;

    const data = loadScope(s, userId, scope, today);
    this.entries.delete(key);
    this.entries.set(key, { version, data });
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    // a failed build is not kept
    data.catch(() => this.entries.get(key)?.data === data && this.entries.delete(key));
    return data;
  }
}

async function loadScope(s: Services, userId: string, scope: Scope, today: string): Promise<ScopeData> {
  const repo = s.finance(userId);
  const own = await repo.listAccounts();
  let accounts: ScopeAccount[] = own.map((a) => ({ ...a, ownerName: null }));
  let txs: StoredTransaction[] = await repo.allTransactions();

  if (scope === "household") {
    const shared = await sharedInView(s, userId, own);
    if (shared.length) {
      accounts = [...accounts, ...shared];
      txs = [...txs, ...(await s.household.transactionsOfAccounts(shared.map((a) => a.id)))];
      txs = neutraliseTransfersBetweenMembers(txs, accounts);
    }
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


