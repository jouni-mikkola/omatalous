import { dayNumber as d } from "../src/dates.ts";
import type { SourcePart, TraceRow } from "../src/money-trace.ts";
import { rng } from "./gen.ts";

/** A seeded history of booked rows: money in of every kind, costs for all and for one, refunds, money back, pending. */
export function history(seed: number, owners: readonly string[], count: number): TraceRow[] {
  const next = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const groups = ["g:text:ESIMERKKI OY", "g:iban:FI0000000001", "g:text:KAUPPA"];
  const rows: TraceRow[] = [];
  const purchases: TraceRow[] = [];
  let day = d("2025-01-01");
  for (let i = 0; i < count; i++) {
    day += Math.floor(next() * 2);
    const kind = next();
    const cents = 1 + Math.floor(next() * 60000);
    const base = { key: `${day}|${i}|r${i}|00000`, ids: [`r${i}`], day };
    if (kind < 0.22) rows.push({ ...base, cents, from: { owner: pick(owners), kind: "own" } });
    else if (kind < 0.3) rows.push({ ...base, cents, from: { owner: pick(owners), kind: "payment" } });
    else if (kind < 0.38) rows.push({ ...base, cents: cents * 2, group: pick(groups) });
    else if (kind < 0.42) {
      const a = Math.floor(cents / 3);
      const parts: SourcePart[] = [
        { owner: owners[0]!, kind: "pool", cents: a },
        { owner: pick(owners), kind: "pool", cents: cents - a },
      ];
      rows.push({ ...base, cents, from: { parts: parts.filter((p) => p.cents > 0) } });
    } else if (kind < 0.76) {
      const r = { ...base, cents: -cents };
      rows.push(r);
      purchases.push(r);
    } else if (kind < 0.84) rows.push({ ...base, cents: -cents, to: { owner: pick(owners) } });
    else if (kind < 0.87) rows.push({ ...base, cents: -cents, to: "pool" });
    else if (kind < 0.93 && purchases.length) {
      const p = pick(purchases);
      rows.push({ ...base, cents: 1 + Math.floor(next() * (Math.abs(p.cents) + 500)), from: { refundOf: p.key } });
    } else if (kind < 0.96) rows.push({ ...base, cents: Math.floor(cents / 10) + 1, from: "back", group: pick(groups) });
    else rows.push({ ...base, cents: -cents, pending: true });
  }
  return rows;
}
