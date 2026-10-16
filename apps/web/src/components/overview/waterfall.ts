/**
 * The waterfall of Tulot ja menot: the month's money as one bar per item, each starting where the one before ended. Pure,
 * so a test reads the rows, the sentences and the table without a page. The server gives the bars as signed changes that
 * add up to Yli jäi; nothing is summed again here except the running total.
 */
import { money } from "../../format.ts";
import type { SettlementAnswer, WaterfallAnswer } from "../../types.ts";

export const EMPTY_MONTH = "Tässä kuussa ei ole vielä tapahtumia.";
export const EVEN = "Yhteiset menot ovat tasan.";

/** How a bar is told apart without its colour: up is solid, down is hatched, the last is the whole. */
export type BarKind = "up" | "down" | "left";

export interface WaterfallRow {
  key: string;
  label: string;
  cents: number;
  /** The running total after the bar. */
  total: number;
  kind: BarKind;
  /** The bar's start and length on the track, in percent of the track. */
  at: number;
  span: number;
  /** The place of zero on the track, in percent. */
  zero: number;
  /** "+1 200,00 €", "−300,00 €"; the last bar has no sign. */
  text: string;
}

const signed = (cents: number): string => `${cents < 0 ? "−" : "+"}${money(Math.abs(cents))}`;

/** The name a bar is shown under: the category's own name, else the fixed names. */
function labelOf(key: string, categories: ReadonlyMap<string, string>): string {
  if (key.startsWith("category:")) return categories.get(key.slice("category:".length)) ?? key.slice("category:".length);
  return { income: "Tulot", other: "Muut menot", transfers: "Säästöt ja luotot", unknown: "Ei tiedossa" }[key] ?? key;
}

/** A bar of nothing is left out, the last bar stays whatever it is. */
export function waterfallRows(w: WaterfallAnswer, categories: ReadonlyMap<string, string>): WaterfallRow[] {
  const bars = w.bars.filter((b) => b.cents !== 0);
  const steps: { key: string; label: string; cents: number; from: number; to: number; kind: BarKind }[] = [];
  let total = 0;
  for (const b of bars) {
    steps.push({ key: b.key, label: labelOf(b.key, categories), cents: b.cents, from: total, to: total + b.cents, kind: b.cents > 0 ? "up" : "down" });
    total += b.cents;
  }
  steps.push({ key: "left", label: "Yli jäi", cents: w.leftCents, from: 0, to: w.leftCents, kind: "left" });
  const edges = steps.flatMap((s) => [s.from, s.to]);
  const lo = Math.min(0, ...edges);
  const span = Math.max(0, ...edges) - lo || 1;
  const at = (cents: number) => ((cents - lo) / span) * 100;
  return steps.map((s) => ({
    key: s.key,
    label: s.label,
    cents: s.cents,
    total: s.to,
    kind: s.kind,
    at: at(Math.min(s.from, s.to)),
    span: Math.max((Math.abs(s.to - s.from) / span) * 100, 0.8),
    zero: at(0),
    text: s.kind === "left" ? money(s.cents) : signed(s.cents),
  }));
}

/** The month's one sentence for a reader who does not see the bars. */
export function summaryOf(w: WaterfallAnswer): string {
  const income = w.bars.filter((b) => b.key === "income").reduce((s, b) => s + b.cents, 0);
  // everything that went out net of what came in, so income less spending is Yli jäi to the cent
  const spent = income - w.leftCents;
  if (w.leftCents < 0) return `Tuloja ${money(income)}, menoja ${money(spent)}. Menoja oli ${money(-w.leftCents)} enemmän kuin tuloja.`;
  return `Tuloja ${money(income)}, menoja ${money(spent)}. Yli jäi ${money(w.leftCents)}.`;
}

/**
 * What to say of the pools: the member who is furthest from their share, one sentence for each pool that is not even.
 * When every pool is even, one sentence says so; no pool, nothing.
 */
export function settlementSentences(pools: readonly SettlementAnswer[]): string[] {
  if (!pools.length) return [];
  const out: string[] = [];
  for (const pool of pools) {
    let far: SettlementAnswer["lines"][number] | undefined;
    for (const l of pool.lines) if (l.overCents !== 0 && (!far || Math.abs(l.overCents) > Math.abs(far.overCents))) far = l;
    if (far) out.push(far.overCents > 0 ? `${far.name} on maksanut ${money(far.overCents)} enemmän kuin osuutensa.` : `${far.name} on maksanut ${money(-far.overCents)} vähemmän kuin osuutensa.`);
  }
  return out.length ? out : [EVEN];
}
