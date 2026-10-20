/**
 * What the last fetch of each account ran into, so Asetukset > Tilit can say it on the account's row. One settings row
 * per user (`fetch_problems:<user id>`), written by the sync loop: an account's entry goes when its next fetch works.
 * The messages are the loop's own words, never the source's response text.
 */
import type { Services } from "../services/context.ts";

export const FETCH_PROBLEMS_PREFIX = "fetch_problems:";

export interface FetchProblem {
  /** not_linked: the source does not let the app read the account; failed: anything else. */
  kind: "not_linked" | "failed";
  /** After the account's name, as in the sync message. */
  message: string;
}

export type FetchProblems = Record<string, FetchProblem>;

export async function readFetchProblems(s: Services, userId: string): Promise<FetchProblems> {
  const raw = await s.settings.get(`${FETCH_PROBLEMS_PREFIX}${userId}`);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as FetchProblems) : {};
  } catch {
    return {};
  }
}

/** Keeps the entries of accounts that still exist; no row at all when nothing is wrong. */
export async function writeFetchProblems(s: Services, userId: string, problems: FetchProblems, accountIds: readonly string[]): Promise<void> {
  const kept = Object.fromEntries(Object.entries(problems).filter(([id]) => accountIds.includes(id)));
  if (Object.keys(kept).length) await s.settings.set(`${FETCH_PROBLEMS_PREFIX}${userId}`, JSON.stringify(kept));
  else await s.settings.delete(`${FETCH_PROBLEMS_PREFIX}${userId}`);
}
