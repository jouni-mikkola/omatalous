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
 * edge. Any printed name whose box would run into the next printed one (the readout's month beside the newest) ends
 * just before it instead. A name that then falls off the plot's start (the running month first, the picked one beside it)
 * starts at the plot's start, and the names after it move right as far as they must, so the names sit side by side.
 */
export function monthNamePlaces(centres: readonly number[], slot: number, innerW: number, names: readonly string[], printed: ReadonlySet<number>): { x: number; anchor: "middle" | "start" | "end" }[] {
  const places = centres.map((x) => ({ x, anchor: "middle" as "middle" | "start" | "end" }));
  const last = centres.length - 1;
  if (slot >= MONTH_LABEL_ROOM) return places;
  const edge = innerW + RIGHT_EDGE;
  if (printed.has(last)) places[last] = { x: edge, anchor: "end" };
  // from the right: a name that reaches into the one after it ends 3 px before it
  let limit = Infinity;
  for (let i = last; i >= 0; i--) {
    if (!printed.has(i)) continue;
    const width = (names[i] ?? "").length * LABEL_CHAR_W;
    const place = places[i]!;
    const right = place.anchor === "end" ? place.x : place.x + width / 2;
    if (right > limit && limit - width >= 0) places[i] = { x: limit, anchor: "end" };
    limit = (places[i]!.anchor === "end" ? places[i]!.x : places[i]!.x + width / 2) - width - 3;
  }
  // from the left: nothing starts before the plot or inside the name before it; a name pinned at the end stays
  let floor = 0;
  for (let i = 0; i <= last; i++) {
    if (!printed.has(i)) continue;
    const width = (names[i] ?? "").length * LABEL_CHAR_W;
    const place = places[i]!;
    if (place.anchor !== "end") {
      const left = place.x - width / 2;
      if (left < floor) places[i] = { x: floor, anchor: "start" };
    }
    const now = places[i]!;
    floor = (now.anchor === "end" ? now.x : now.anchor === "start" ? now.x + width : now.x + width / 2) + 3;
  }
  return places;
}
