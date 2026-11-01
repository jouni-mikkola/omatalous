import type { AreaView, Finding } from "./types.ts";

/**
 * The tips of every area in one list, the largest effect a year first: the figure a tip shows is its order. A tip with
 * no euro figure (a day to decide by only) follows the ones with one, soonest day first; a tie falls back on the id,
 * so the order is the same on every load. A tip with a day to decide by is in the list like any other.
 */
export function byYearlyEffect(areas: readonly Pick<AreaView, "findings">[]): Finding[] {
  return areas
    .flatMap((a) => a.findings)
    .sort((a, b) => Number(!a.euros) - Number(!b.euros) || (b.euros?.midCents ?? 0) - (a.euros?.midCents ?? 0) || (a.decideBy ?? "").localeCompare(b.decideBy ?? "") || a.id.localeCompare(b.id));
}
