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
 * `named` is the month the readout names: its name prints too, in the picked weight, unless it would stand within 44 px
 * of a month in `must`. A regular name closer than 44 px to either gives way.
 */
export function printedMonths(count: number, slot: number, must: ReadonlySet<number>, named: number | null): Set<number> {
  const step = Math.max(1, Math.ceil(MONTH_LABEL_ROOM / Math.max(slot, 1)));
  const clear = (i: number, from: Iterable<number>) => [...from].every((k) => Math.abs(k - i) * slot >= MONTH_LABEL_ROOM);
  const kept = new Set(must);
  if (named !== null && !kept.has(named) && clear(named, must)) kept.add(named);
  const printed = new Set(kept);
  for (let i = count - 1; i >= 0; i -= step) if (!kept.has(i) && clear(i, kept)) printed.add(i);
  return printed;
}
