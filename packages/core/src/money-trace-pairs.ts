/**
 * The pair of a movement for one person: a money-in row and a money-out row for one person of exactly the same sum,
 * the out on the same day as the in or up to `days` after it, are a pair (the nearest day first, then the content
 * order; a row pairs once, and the in-row must be read before the out-row). The result maps the in-row's key to the
 * out-row's: the lots the in-row makes are kept for that out-row.
 */
import type { TraceRow } from "./money-trace.ts";

export function pairMoves(order: readonly TraceRow[], days: number): Map<string, string> {
  const position = new Map(order.map((r, i) => [r.key, i]));
  const inIndex = new Map<number, Map<number, TraceRow[]>>();
  for (const r of order) {
    if (r.cents <= 0 || r.unmatched) continue;
    let byDay = inIndex.get(r.cents);
    if (!byDay) inIndex.set(r.cents, (byDay = new Map()));
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const outOf = new Map<string, string>();
  const paired = new Set<string>();
  for (const r of order) {
    if (r.cents >= 0 || r.unmatched || typeof r.to !== "object") continue;
    const byDay = inIndex.get(-r.cents);
    if (!byDay) continue;
    const at = position.get(r.key)!;
    for (let gap = 0; gap <= days && !paired.has(r.key); gap++) {
      const hit = (byDay.get(r.day - gap) ?? []).find((c) => !outOf.has(c.key) && position.get(c.key)! < at);
      if (hit) {
        outOf.set(hit.key, r.key);
        paired.add(r.key);
      }
    }
  }
  return outOf;
}
