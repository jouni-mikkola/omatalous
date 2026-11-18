/** The accounts a viewer may see, with the use of each and the trace of each pool among them: what every view of the analysis is cut from. */
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import { isPool, usesInView } from "./account-use.ts";
import type { Services } from "./context.ts";
import { ensureTrace } from "./money-trace.ts";
import type { TraceFacts } from "./money-trace-parts.ts";
import type { RequestReads } from "./request-reads.ts";

type SharedAccount = StoredAccount & { ownerName: string };
type UsesWithTraces = { uses: Awaited<ReturnType<typeof usesInView>>; traces: Map<string, TraceFacts> };

/**
 * The use of each account, with the trace of every pool among them made sure of first: a pool whose parts were built
 * from something else than the household holds now is built again, and the app may set its split. The uses are read
 * again when that changed what they say (the mode, whether the account is traced). `reads` is the request's memo: the
 * same accounts asked twice in one request are read once.
 */
export async function usesWithTraces(s: Services, userId: string, accounts: readonly StoredAccount[], reads?: RequestReads): Promise<UsesWithTraces> {
  return reads ? reads.once("uses", `${userId}|${accounts.map((a) => a.id).sort().join(",")}`, () => readUsesWithTraces(s, userId, accounts, reads)) : readUsesWithTraces(s, userId, accounts);
}

async function readUsesWithTraces(s: Services, userId: string, accounts: readonly StoredAccount[], reads?: RequestReads): Promise<UsesWithTraces> {
  let uses = await usesInView(s, userId, accounts);
  const keys = [...new Set(accounts.filter((a) => isPool(uses.get(a.id)?.use)).map(accountKey))];
  const found = new Map((await Promise.all(keys.map(async (key) => [key, await ensureTrace(s, key, reads)] as const))).flatMap(([key, facts]) => (facts ? [[key, facts] as const] : [])));
  const traces = new Map(accounts.flatMap((a): [string, TraceFacts][] => (found.has(accountKey(a)) ? [[a.id, found.get(accountKey(a))!]] : [])));
  const moved = [...traces].some(([id, f]) => !!f.traced !== !!uses.get(id)!.traced || !!f.split !== (uses.get(id)!.use.mode === "source"));
  if (moved) uses = await usesInView(s, userId, accounts);
  return { uses, traces };
}

/**
 * The accounts the viewer may see (their own and those shared with them, a joint account linked by both once) with the
 * use of each and the trace of each pool among them. Every view is cut from this; a request reads it once.
 */
export async function visibleTo(s: Services, userId: string, reads?: RequestReads): Promise<UsesWithTraces & { own: StoredAccount[]; offered: SharedAccount[]; shared: SharedAccount[] }> {
  const read = async () => {
    const own = await s.finance(userId).listAccounts();
    const offered = await s.household.sharedWith(userId);
    const shared = offered.filter(notAmong(own));
    return { own, offered, shared, ...(await usesWithTraces(s, userId, [...own, ...shared], reads)) };
  };
  return reads ? reads.once("visible", userId, read) : read();
}

/** Whether an account is another real account than each of `own`: my copy of a joint account wins over the partner's. */
export function notAmong(own: readonly StoredAccount[]): (a: StoredAccount) => boolean {
  const identities = new Set(own.map((a) => a.identity).filter(Boolean));
  return (a) => !a.identity || !identities.has(a.identity);
}
