/** The pure steps of the money trace service: the window of the split, the offer of a traced split and the parts a settled trace stores. */
import { dayNumber, isUserOwner, type SourcePart, splitOf, type Trace, type TraceUser } from "@banking/core";
import type { PartRow } from "../db/household-repo.ts";

/** The first day and the last of the three complete calendar months before today's month. */
export function windowOf(today: string): { from: number; to: number } {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const back = year * 12 + (month - 1) - 3;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: dayNumber(`${Math.floor(back / 12)}-${pad((back % 12) + 1)}-01`), to: dayNumber(`${today.slice(0, 7)}-01`) - 1 };
}

/** The traced split of the window in whole percents against the weights', as `splitOf` rounds both. */
export function offerOf(raw: Trace, users: readonly TraceUser[], window: { from: number; to: number }, c: ReturnType<typeof splitOf>): { userId: string | null; percent: number }[] | null {
  if (!c.c3 || !c.c4) return null;
  // the weights as the cost of one row cut at them: the same rounding, and no second copy of it
  const weights = splitOf(
    { ...raw, rows: [{ key: "w", ids: [], day: window.from, cents: -1, what: "all", parts: users.map((u) => ({ owner: u.owner, kind: "own", cents: u.weight })) }] },
    [],
    users,
    window,
  );
  const same = c.percents.every((p) => p.percent === weights.percents.find((w) => w.owner === p.owner)?.percent);
  return same ? null : c.percents.map((p) => ({ userId: p.owner === "u:" ? null : p.owner.slice(2), percent: p.percent }));
}

/** The stored parts of a settled trace, by row id: users' by owner, the rest as `?` (a question stands for it) or `-` (unknown), summed by the key of the table. */
export function partRowsOf(t: { trace: Trace; open: (p: SourcePart) => boolean }): Map<string, PartRow[]> {
  const out = new Map<string, PartRow[]>();
  for (const row of t.trace.rows) {
    const merged = new Map<string, PartRow>();
    for (const p of row.parts) {
      const user = isUserOwner(p.owner);
      const part: PartRow = { owner: user ? p.owner : t.open(p) ? "?" : "-", kind: p.kind, grp: user ? "" : p.owner, cents: p.cents, passed: !!p.passed };
      const k = `${part.owner}|${part.kind}|${part.grp}`;
      const have = merged.get(k);
      if (have) {
        have.cents += part.cents;
        have.passed ||= part.passed;
      } else merged.set(k, part);
    }
    for (const id of row.ids) out.set(id, [...merged.values()]);
  }
  return out;
}
