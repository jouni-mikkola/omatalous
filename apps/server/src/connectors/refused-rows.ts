/**
 * The rows of each account's last fetch that the source sent and the app could not read (a status other than booked or
 * pending, no amount, no date), by reason, so Tietojen laatu can say how many were left out. One settings row per user
 * (`refused_rows:<user id>`), written by the sync loop: an account's entry goes when its next fetch reads every row.
 */
import type { Services } from "../services/context.ts";
import type { RefusedRows } from "./types.ts";

const PREFIX = "refused_rows:";

export type RefusedByAccount = Record<string, RefusedRows>;

export async function readRefusedRows(s: Services, userId: string): Promise<RefusedByAccount> {
  const raw = await s.settings.get(`${PREFIX}${userId}`);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RefusedByAccount) : {};
  } catch {
    return {};
  }
}

/** Keeps the entries of accounts that still exist; no row at all when every row was read. */
export async function writeRefusedRows(s: Services, userId: string, refused: RefusedByAccount, accountIds: readonly string[]): Promise<void> {
  const kept = Object.fromEntries(Object.entries(refused).filter(([id, counts]) => accountIds.includes(id) && Object.keys(counts).length > 0));
  if (Object.keys(kept).length) await s.settings.set(`${PREFIX}${userId}`, JSON.stringify(kept));
  else await s.settings.delete(`${PREFIX}${userId}`);
}
