/**
 * The money of a category told a level under it: what a build's extension knows of single rows (`AnalysisContext.rowParts`)
 * summed over the rows of the category. A part is never a category of its own: each row keeps its category, its flow and
 * its amount, and the parts of a category add up to its spending to the cent, the rows the extension says nothing of as
 * one part. The shared build fills no row, so no category has parts.
 */

/** One part of a row's money, of the sign of spending: a purchase is positive. */
interface RowPart {
  /** Stable within the extension; the same id on two rows is one part of the category. */
  id: string;
  label: string;
  cents: number;
  /** `apart`: listed after the others and never folded into "Muut"; `rest`: the extension's own "Muut", which the fold joins. */
  kind?: "apart" | "rest";
}

/** What an extension tells of one row: its parts, which add up to the row's whole spending, and how sure the tie to the row is. */
export interface RowParts {
  /** The category the parts are of: a row counted in another one (the user moved it) shows none. */
  category: string;
  parts: readonly RowPart[];
  /** The tie of the parts to the row is a guess: the figure wears ≈. */
  estimated: boolean;
}

/** One part of a category's spending: summed from its rows' parts, "Muut", or the rows with none (`unsplit`). */
export interface CategoryPart {
  id: string;
  label: string;
  cents: number;
  /** Some of its cents come from a row whose tie is a guess. */
  estimated: boolean;
}

/** A category reads at a glance: past this many parts, "Muut" not counted, the smallest go to "Muut". */
const MAX_PARTS = 7;
const UNSPLIT = "unsplit";
const REST = "rest";

/**
 * `parts` cut to `target` cents: the running sums are rounded, so the parts add up to the target exactly whatever their
 * signs, and a part of 0 stays out.
 */
function scaled(parts: readonly RowPart[], target: number): { part: RowPart; cents: number }[] {
  const whole = parts.reduce((sum, p) => sum + p.cents, 0);
  if (whole === target) return parts.map((part) => ({ part, cents: part.cents }));
  if (whole === 0) return [];
  let run = 0;
  let before = 0;
  return parts.map((part) => {
    run += part.cents;
    const at = Math.round((run * target) / whole);
    const cents = at - before;
    before = at;
    return { part, cents };
  });
}

/**
 * The parts of the spending of `rows` (one category's rows of `spendRows`, as a report counts them), or null when no row has parts of
 * that category. Each row's parts are cut to what the row counts in the view (`spend`: a part of a joint account, a bill
 * its statement lowered); a row with no parts, or parts that no longer add up to anything, is in `unsplit`. The named
 * parts come largest first, "Muut" (the extension's own and those past the limit) after them, then the parts kept
 * apart and `unsplit`: at most seven and "Muut", unless the parts kept apart fill them.
 */
export function categoryParts(rows: readonly { id: string; category: string; spend: number }[], rowParts: ReadonlyMap<string, RowParts> | undefined, category: string): CategoryPart[] | null {
  if (!rowParts?.size) return null;
  const sums = new Map<string, CategoryPart & { kind?: RowPart["kind"] }>();
  const add = (id: string, label: string, cents: number, estimated: boolean, kind?: RowPart["kind"]) => {
    const was = sums.get(id);
    if (was) {
      was.cents += cents;
      was.estimated ||= estimated;
    } else sums.set(id, { id, label, cents, estimated, kind });
  };
  let told = false;
  let unsplit = 0;
  for (const t of rows) {
    if (!t.spend) continue;
    const of = rowParts.get(t.id);
    const cut = of && of.category === category && t.category === category ? scaled(of.parts, t.spend) : [];
    if (cut.length === 0) {
      unsplit += t.spend;
      continue;
    }
    told = true;
    for (const { part, cents } of cut) add(part.kind === "rest" ? REST : part.id, part.kind === "rest" ? "Muut" : part.label, cents, of!.estimated, part.kind);
  }
  if (!told) return null;
  const all = [...sums.values()].filter((p) => p.cents !== 0);
  const apart = all.filter((p) => p.kind === "apart");
  const named = all.filter((p) => !p.kind).sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
  const rest = all.find((p) => p.id === REST);
  const tail = [...apart, ...(unsplit ? [{ id: UNSPLIT, label: "Erittelemättä", cents: unsplit, estimated: false }] : [])];
  const room = Math.max(1, MAX_PARTS - tail.length);
  const plain = ({ id, label, cents, estimated }: CategoryPart) => ({ id, label, cents, estimated });
  if (named.length <= room) return [...named, ...(rest ? [rest] : []), ...tail].map(plain);
  const kept = named.slice(0, room);
  const folded = named.slice(room);
  const muut = { id: REST, label: "Muut", cents: folded.reduce((s, p) => s + p.cents, rest?.cents ?? 0), estimated: folded.some((p) => p.estimated) || !!rest?.estimated };
  return [...kept, ...(muut.cents ? [muut] : []), ...tail].map(plain);
}
