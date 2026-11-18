/**
 * What core's settlement reads from the store besides the trace and the agreements: the stored closed months, and the
 * days the household said what a pool's months are settled by (ADR 0017). A closed month is compared with today only on
 * the rows something said after its closing reads anew. A use and a split a member chose are dated by when they were
 * said; a split the app set is no word of the household and has no day. What was taken back is gone with its day.
 */
import type { ClosedMonth } from "@banking/core";
import type { StoredClosedMonth } from "../db/agreement-repo.ts";
import { todayIn } from "../platform/config.ts";
import type { Services } from "./context.ts";

/** A stored month as core reads it; a row that is no month's settlement (nobody writes one) is no snapshot. */
export function closedOf(row: StoredClosedMonth): ClosedMonth | null {
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

/** The local day an instant falls on, in the instance's time zone: the books count local days. */
export function localDayOf(s: Services, at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at.slice(0, 10) : todayIn(s.instance.current.timezone, when);
}

/** By account key (the pool's and its cards'), the local day a member last said its use or chose its split. */
export async function usesSaidOn(s: Services, keys: readonly string[]): Promise<Map<string, string>> {
  const [uses, splits] = await Promise.all([s.household.useRows(keys), s.household.splitRows(keys)]);
  const said = [...uses.map((u) => ({ key: u.key, at: u.saidAt })), ...splits.filter((r) => r.setBy !== null).map((r) => ({ key: r.key, at: r.setAt }))];
  const out = new Map<string, string>();
  for (const { key, at } of said) {
    const day = localDayOf(s, at);
    if (!out.has(key) || out.get(key)! < day) out.set(key, day);
  }
  return out;
}
