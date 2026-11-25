import { LABEL_CHAR_W } from "../draw.ts";

/** A name set at the end of a bar or a line, cut to `maxChars` characters with an ellipsis, so it never runs out of its room. */
export function fitLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return maxChars < 2 ? "" : `${text.slice(0, maxChars - 1)}…`;
}

/** Room one month name needs on a monthly axis, in pixels: no two printed names stand closer than this. */
const MONTH_LABEL_ROOM = 44;

/**
 * The months whose name is printed on a monthly axis: every `ceil(44 / slot)` months counted from the newest, so the
 * newest always has its name. `must` are the months that always print (the running one, which says it is not whole).
 * `named` is the month the readout names: its name always prints, in the picked weight, and `monthNamePlaces` keeps it
 * clear of the newest month's name. A regular name closer than 44 px to either gives way.
 */
export function printedMonths(count: number, slot: number, must: ReadonlySet<number>, named: number | null): Set<number> {
  const step = Math.max(1, Math.ceil(MONTH_LABEL_ROOM / Math.max(slot, 1)));
  const clear = (i: number, from: Iterable<number>) => [...from].every((k) => Math.abs(k - i) * slot >= MONTH_LABEL_ROOM);
  const kept = new Set(must);
  if (named !== null) kept.add(named);
  const printed = new Set(kept);
  for (let i = count - 1; i >= 0; i -= step) if (!kept.has(i) && clear(i, kept)) printed.add(i);
  return printed;
}

/** How far past the plot's end a name may run: the chart's right margin. */
const RIGHT_EDGE = 4;

/**
 * Where each month's name stands. A name is centred under its column, except when the slots are narrower than a name
 * needs (under 44 px): the newest month's name, a long one such as "marras" with "kesken" under it, then ends at the plot's
 * edge, and the readout's month, when it is within 44 px of the newest, ends just before it. The two names sit side by
 * side instead of one over the other.
 */
export function monthNamePlaces(centres: readonly number[], slot: number, innerW: number, names: readonly string[], printed: ReadonlySet<number>, named: number | null): { x: number; anchor: "middle" | "end" }[] {
  const places = centres.map((x) => ({ x, anchor: "middle" as "middle" | "end" }));
  const last = centres.length - 1;
  if (slot >= MONTH_LABEL_ROOM || !printed.has(last)) return places;
  const edge = innerW + RIGHT_EDGE;
  places[last] = { x: edge, anchor: "end" };
  if (named !== null && named < last && (last - named) * slot < MONTH_LABEL_ROOM) {
    const half = ((names[named] ?? "").length * LABEL_CHAR_W) / 2;
    places[named] = { x: Math.min(centres[named]! + half, edge - (names[last] ?? "").length * LABEL_CHAR_W - 3), anchor: "end" };
  }
  return places;
}
