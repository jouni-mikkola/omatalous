// The geometry of a line of days: where a dot, a label and a step of the balance stand, in pixels of a line `width` wide.
// The days are `columns` equal columns; a dot stands on the middle of its day. Nothing here knows what a bill is.

/** The dot of the smallest sum and of the largest, at full scale. A dot is never smaller than `FLOOR` pixels. */
const MIN_DOT = 12;
const MAX_DOT = 38;
const FLOOR = 6;
/** The space between two dots, and between the dots and the axis. */
const GAP = 3;
const LIFT = 5;
/** The dots' field is at least this high and grows with the stacks; a stack that would pass the cap shrinks its dots first. */
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 168;
/** The share of a day's column a label needs, in pixels: a weekday and a day number. */
const LABEL_WIDTH = 26;
/** The height of the field the balance steps in. */
export const STEPS_HEIGHT = 96;
const STEPS_PAD = 6;

export interface DotIn {
  column: number;
  /** The sum, in positive cents. It sets the size and the tone unless `fixed` is given. */
  cents: number;
  /** A mark whose size is its own, in pixels: it takes a place and does not tell a sum. */
  fixed?: number;
}

interface Dot {
  /** The middle of the dot, from the left edge of the line. */
  x: number;
  /** The lower edge of the dot, above the axis. */
  y: number;
  size: number;
  /** 1 for the smallest sums to 4 for the largest. */
  tone: 1 | 2 | 3 | 4;
}

/** The share of the largest sum, 0 to 1 by the square root so that the area of a dot follows the sum. */
function share(cents: number, largest: number): number {
  const s = Math.sqrt(Math.max(0, cents) / largest);
  return Number.isFinite(s) ? Math.min(1, s) : 0;
}

const toneOf = (s: number): Dot["tone"] => (s < 0.34 ? 1 : s < 0.6 ? 2 : s < 0.82 ? 3 : 4);

/** The middle of a column. */
export const columnX = (width: number, columns: number, column: number): number => ((column + 0.5) * width) / Math.max(1, columns);

/**
 * Sets the dots on the line, one by one in the order given, each at its day and as low as it goes without touching one
 * set before it: dots of one day stack, and a big dot beside a big dot of the next day goes up a little. So none hides
 * another, however many stand on one day. The dots grow with the line's width up to the full size; a field that would
 * pass `MAX_HEIGHT` is packed again with smaller dots, to the floor. `height` is the field's height.
 */
export function placeDots(width: number, columns: number, input: readonly DotIn[]): { dots: Dot[]; height: number } {
  const largest = Math.max(0, ...input.filter((d) => d.fixed === undefined).map((d) => d.cents));
  let k = Math.min(1, Math.max(0.6, width / Math.max(1, columns) / 34));
  for (;;) {
    const dots = pack(width, columns, input, largest, k);
    const height = Math.max(MIN_HEIGHT, ...dots.map((d) => d.y + d.size + GAP + 4));
    if (height <= MAX_HEIGHT || k <= 0.3) return { dots, height };
    k *= 0.85;
  }
}

function pack(width: number, columns: number, input: readonly DotIn[], largest: number, k: number): Dot[] {
  const placed: Dot[] = [];
  for (const d of input) {
    const s = d.fixed === undefined ? share(d.cents, largest) : 0;
    const size = d.fixed ?? Math.max(FLOOR, Math.round((MIN_DOT + (MAX_DOT - MIN_DOT) * s) * k));
    const r = size / 2;
    // a dot stays inside the line: the first and the last day's dots lean in
    const x = Math.min(Math.max(columnX(width, columns, d.column), r), Math.max(r, width - r));
    const clear = (y: number) => placed.every((p) => Math.hypot(x - p.x, y + r - (p.y + p.size / 2)) >= r + p.size / 2 + GAP - 1e-6);
    // the lowest place that is clear: the floor, resting on a dot beside, or above every dot
    const tries = [LIFT, Math.max(LIFT, ...placed.map((p) => p.y + p.size + GAP))];
    for (const p of placed) {
      const reach = r + p.size / 2 + GAP;
      const dx = Math.abs(x - p.x);
      if (dx < reach) tries.push(p.y + p.size / 2 + Math.sqrt(reach * reach - dx * dx) - r);
    }
    const y = Math.min(...tries.filter((t) => t >= LIFT && clear(t)));
    placed.push({ x, y, size, tone: toneOf(s) });
  }
  return placed;
}

/** Which of the days carry a label: every one when each has the room, else every second, third or seventh, counted back from the last day. */
export function labelled(width: number, columns: number): (column: number) => boolean {
  const room = width / Math.max(1, columns);
  const step = [1, 2, 3].find((s) => room * s >= LABEL_WIDTH) ?? 7;
  return (column) => (columns - 1 - column) % step === 0;
}

/** Where an arrow key, Home or End takes the dot at place `at` of `count` dots in the order of the days: the new place, or null for any other key. */
export function nextDot(key: string, at: number, count: number): number | null {
  const go = (to: number) => Math.min(count - 1, Math.max(0, to));
  if (key === "ArrowRight" || key === "ArrowDown") return go(at + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return go(at - 1);
  if (key === "Home") return 0;
  return key === "End" ? go(count - 1) : null;
}

interface Steps {
  /** The balance as a line of steps, from the left edge to the middle of the last day. */
  path: string;
  /** The same path closed under itself, for the fill. */
  area: string;
  /** The place of the balance at the left edge's level and after each day's payments: `at[column]`, for every column. */
  at: { x: number; y: number }[];
}

/**
 * The balance walked down by the payments: it starts at `startCents`, and on a day with payments it steps down by their
 * sum at the middle of the day. The scale leaves room above the start and below the end, so a long step is not at the
 * frame. Nothing is added: a pay is a mark of the line and never a step.
 */
export function stepLine(width: number, columns: number, startCents: number, drops: readonly { column: number; cents: number }[]): Steps {
  const due = drops.reduce((sum, d) => sum + Math.max(0, d.cents), 0);
  const top = startCents + due * 0.08;
  const bottom = startCents - due - due * 0.45;
  const y = (v: number) => (top > bottom ? STEPS_PAD + (1 - (v - bottom) / (top - bottom)) * (STEPS_HEIGHT - 2 * STEPS_PAD) : STEPS_HEIGHT / 2);
  const dropOn = Array.from({ length: columns }, (_, c) => drops.filter((d) => d.column === c).reduce((sum, d) => sum + Math.max(0, d.cents), 0));
  let left = startCents;
  const at = dropOn.map((cents, c) => {
    left -= cents;
    return { x: columnX(width, columns, c), y: y(left) };
  });
  let path = `M0,${round(y(startCents))}`;
  dropOn.forEach((cents, c) => {
    if (cents > 0) path += `H${round(at[c]!.x)}V${round(at[c]!.y)}`;
  });
  path += `H${round(at[columns - 1]!.x)}`;
  return { path, area: `${path}V${STEPS_HEIGHT}H0Z`, at };
}

const round = (v: number) => Math.round(v * 10) / 10;
