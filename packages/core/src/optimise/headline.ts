/**
 * The headline of Säästövinkit and each area's share of it: what the tips are worth a year without counting a saving
 * twice, and how that stands against the money the tips live in.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { monthOf } from "../dates.ts";
import { netCost } from "./common.ts";
import { measureRows } from "./state.ts";
import type { AreaReach, AreaView, Finding, Headline } from "./types.ts";

/** Rule 6: mid summed largest first, a finding sharing over half its claims with one counted is skipped. */
export function headlineOf(findings: readonly Finding[]): Headline {
  const candidates = findings
    .filter((f) => f.euros && !f.shared && f.certainty.level !== "matala")
    .sort((a, b) => b.euros!.midCents - a.euros!.midCents || a.id.localeCompare(b.id));
  const counted: Finding[] = [];
  for (const f of candidates) {
    const overlaps = counted.some((c) => {
      const theirs = new Set(c.claims);
      return f.claims.filter((k) => theirs.has(k)).length > f.claims.length / 2;
    });
    if (!overlaps) counted.push(f);
  }
  return counted.reduce((h, f) => ({ lowCents: h.lowCents + f.euros!.lowCents, midCents: h.midCents + f.euros!.midCents, highCents: h.highCents + f.euros!.highCents, count: h.count + 1 }), {
    lowCents: 0,
    midCents: 0,
    highCents: 0,
    count: 0,
  });
}

/**
 * Each area's tips against the money they live in: the euros `headlineOf` gives the area's findings, and the spending
 * of `months` on the rows any of them measures, each row once. Areas whose headline is empty are left out; the largest
 * mid comes first, so the page reads where the most is without comparing euros itself.
 */
export function reachOf(ctx: Pick<AnalysisContext, "txs" | "recurring">, areas: readonly AreaView[], months: readonly string[]): AreaReach[] {
  const window = new Set(months);
  const out: AreaReach[] = [];
  for (const area of areas) {
    const { lowCents, midCents, highCents, count } = headlineOf(area.findings);
    if (!count) continue;
    const measured = area.findings.filter((f) => f.measure.kind !== "none").map((f) => measureRows(ctx, f.measure));
    let spendCents: number | null = null;
    if (measured.length) {
      spendCents = 0;
      for (const t of ctx.txs) if (window.has(monthOf(t.bookingDate)) && measured.some((m) => m(t))) spendCents += netCost(t);
    }
    out.push({ area: area.id, euros: { lowCents, midCents, highCents }, count, spendCents, share: spendCents ? midCents / spendCents : null });
  }
  return out.sort((x, y) => y.euros.midCents - x.euros.midCents || x.area.localeCompare(y.area));
}
