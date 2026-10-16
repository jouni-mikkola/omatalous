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
  /** What the bar is made of, as the server's parts give it, with the bar's sign; none for Yli jäi, which does not open. */
  lines: DetailLine[];
  /** "Näytä kaikki tapahtumat": where the bar's rows are, for the bars that have a page of their own. */
  all: string | null;
  /** "Syyskuu: 412,00 €": what the month before had in the same row, for Tulot and a category when the months compare; else null. */
  before: string | null;
}

/** What the month before had, from the dashboard's own fields; null when the months do not compare (`comparable`). */
export interface Before {
  /** The month before's name as a head: "Syyskuu". */
  name: string;
  incomeCents: number;
  /** A category's sum in the month before, by the category's id. */
  categories: ReadonlyMap<string, number>;
}

/** One line under an open bar: the part's name, its sum, and where its rows are when it is a category or a payee. */
interface DetailLine {
  key: string;
  label: string;
  text: string;
  href: string | null;
}

/** Where the lines of a bar lead: the category's rows in the month, a payee's rows in the month, the month's income rows. */
export interface Hrefs {
  category: (id: string) => string;
  payee: (name: string) => string;
  income: string;
}

/** The one open row and the month it was opened in: a month other than that one shows every row closed. */
export type OpenRow = { month: string; key: string } | null;

/** The key of the row that is open in `month`, null when none is. */
export const openKey = (open: OpenRow, month: string): string | null => (open && open.month === month ? open.key : null);

/** The row after a click on `key`: it closes when it was the open one, and otherwise it opens and the one before closes. */
export const toggledRow = (open: OpenRow, month: string, key: string): OpenRow => (openKey(open, month) === key ? null : { month, key });

/** The lines' label for a part that is no payee and no category. */
const PART_NAMES: Record<string, string> = { saved: "Säästöt", borrowed: "Luotonnostot" };

const signed = (cents: number): string => `${cents < 0 ? "−" : "+"}${money(Math.abs(cents))}`;

const categoryName = (id: string, categories: ReadonlyMap<string, string>): string => categories.get(id) ?? id;

/** The name a bar is shown under: the category's own name, the rest as the category table names it, else the fixed names. */
function labelOf({ key, count }: WaterfallAnswer["bars"][number], categories: ReadonlyMap<string, string>): string {
  if (key.startsWith("category:")) return categoryName(key.slice("category:".length), categories);
  if (key === "other") return count ? `Muut (${count})` : "Muut menot";
  return { income: "Tulot", transfers: "Säästöt ja luotot" }[key] ?? key;
}

/** The lines under a bar, one for each part the server gives; the payees past the named ones are its "Muut (n)". */
function linesOf(bar: WaterfallAnswer["bars"][number], categories: ReadonlyMap<string, string>, hrefs: Hrefs): DetailLine[] {
  return bar.parts.map((p) => {
    const id = p.key.startsWith("category:") ? p.key.slice("category:".length) : null;
    const payee = p.key.startsWith("payee:") ? p.key.slice("payee:".length) : null;
    const label = id !== null ? categoryName(id, categories) : p.key === "rest" ? `Muut (${p.count})` : (payee ?? PART_NAMES[p.key] ?? p.key);
    return { key: p.key, label, text: signed(p.cents), href: id !== null ? hrefs.category(id) : payee !== null ? hrefs.payee(payee) : null };
  });
}

/** A bar of nothing is left out, the last bar stays whatever it is. */
export function waterfallRows(w: WaterfallAnswer, categories: ReadonlyMap<string, string>, hrefs: Hrefs, before: Before | null = null): WaterfallRow[] {
  const bars = w.bars.filter((b) => b.cents !== 0);
  const steps: { key: string; label: string; cents: number; from: number; to: number; kind: BarKind; lines: DetailLine[]; all: string | null; before: string | null }[] = [];
  let total = 0;
  for (const b of bars) {
    const all = b.key === "income" ? hrefs.income : b.key.startsWith("category:") ? hrefs.category(b.key.slice("category:".length)) : null;
    const was = !before ? null : b.key === "income" ? before.incomeCents : b.key.startsWith("category:") ? (before.categories.get(b.key.slice("category:".length)) ?? 0) : null;
    steps.push({ key: b.key, label: labelOf(b, categories), cents: b.cents, from: total, to: total + b.cents, kind: b.cents > 0 ? "up" : "down", lines: linesOf(b, categories, hrefs), all, before: was === null ? null : `${before!.name}: ${money(was)}` });
    total += b.cents;
  }
  steps.push({ key: "left", label: "Yli jäi", cents: w.leftCents, from: 0, to: w.leftCents, kind: "left", lines: [], all: null, before: null });
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
    lines: s.lines,
    all: s.all,
    before: s.before,
  }));
}

/**
 * The month's one sentence for a reader who does not see the bars: the figures of the table under it, then what went to
 * savings and credit, which the table's Menot leaves out. The bars add up to Yli jäi, so the sentence does too.
 */
export function summaryOf(w: WaterfallAnswer): string {
  const sum = (keep: (key: string) => boolean) => w.bars.filter((b) => keep(b.key)).reduce((s, b) => s + b.cents, 0);
  const income = sum((k) => k === "income");
  const spent = -sum((k) => k === "other" || k.startsWith("category:"));
  const moved = -sum((k) => k === "transfers");
  const first = `Tuloja ${money(income)}, menoja ${money(spent)}.`;
  const last = w.leftCents < 0 ? `Rahaa meni ${money(-w.leftCents)} enemmän kuin tuli.` : `Yli jäi ${money(w.leftCents)}.`;
  if (moved === 0) return `${first} ${last}`;
  const middle = moved > 0 ? `Säästöihin ja luottoihin meni ${money(moved)}.` : `Säästöistä ja luotoista tuli ${money(-moved)}.`;
  return `${first} ${middle} ${last}`;
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
