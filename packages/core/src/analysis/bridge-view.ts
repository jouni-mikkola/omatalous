// Decision: move money to savings
/**
 * The figures of the "where the income went" bar (Tulojen käyttö) as the server sends them: which parts the bar and
 * the strip over it have, each part's share of its bar, the rows of the table and the shares of the income printed
 * beside them, rounded together so they add up. The web gives each key its label and colour and adds up nothing.
 */
import { coverOf, type GapCover, type PeriodTotals } from "./flows.ts";

type BridgeTotals = Pick<PeriodTotals, "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "borrowedCents" | "leftCents">;

type BridgeKey = "income" | "consumption" | "debt" | "saved" | "repaid" | "left" | "credit" | "savings" | "accounts" | "credit-left" | "savings-left";

/** A part of a bar: its sum and the share of the bar it fills (0 for a part with no length). */
interface BridgePiece {
  key: BridgeKey;
  cents: number;
  share: number;
}

/** A figure that may also be told as a share of the income. */
interface IncomeShare {
  /** The figure is a share of the income, so it is also told as one. */
  ofIncome: boolean;
  /** Whole percents of the income, rounded with the other parts so they add up (`roundedShares`); null outside that rounding. */
  incomeUnits: number | null;
  /** cents / income, for a share outside the rounding; null without income. */
  incomeShare: number | null;
}

interface BridgeFigure extends IncomeShare {
  key: BridgeKey;
  cents: number;
}

interface BridgeRow extends IncomeShare {
  key: BridgeKey | "credit-drawn" | "savings-drawn";
  cents: number;
  /** Money in, money out, or what stayed: what came in less what went out is Tulos, to the cent. */
  side: "in" | "out" | "stayed";
}

export interface BridgeView {
  totals: BridgeTotals;
  cover: GapCover;
  /** The bar is drawn: there is income and no part is below zero (ADR 0014); otherwise the table alone tells it. */
  draws: boolean;
  /** Where the money went, in the bar's fixed order. */
  parts: BridgePiece[];
  /** Where the money of the bar came from, on its axis; empty when the income was all of it. */
  sources: BridgePiece[];
  /** The figures under the bar, in reading order. */
  figures: BridgeFigure[];
  /** The bridge as a table, every row signed; the last row is Tulos. */
  rows: BridgeRow[];
}

/** A sum too small to print: whole euros, and "0 €" is no figure. */
const prints = (cents: number) => cents >= 50;

/** `n / d` rounded down, for integers: no float quotient decides it. */
const quotient = (n: number, d: number): number => (n - (n % d)) / d;

/**
 * Shares of one whole that are printed side by side, as whole units of the last printed digit (`decimals` digits after
 * the comma): each is its true value rounded down or up, and the ones with the largest lost fractions go up until the
 * units add up to `target`. The target is the whole's own printed share, by default the nearest unit to the parts' true
 * sum (100 when they are the whole). A tie goes to the earlier row, so the same data prints the same way. A part of
 * exactly 0 stays 0; a part that is null or below zero comes back null and stands outside the rounding. The sums are
 * integers (cents against cents), so no float decides a digit.
 */
export function roundedShares(parts: readonly (number | null)[], whole: number, decimals = 0, target?: number): (number | null)[] {
  const scale = 100 * 10 ** decimals;
  const valid = parts.map((p) => (p != null && p >= 0 ? p : null));
  if (!(whole > 0)) return valid.map((p) => (p === null ? null : 0));
  const down = valid.map((p) => (p === null ? null : { units: quotient(p * scale, whole), lost: (p * scale) % whole }));
  const sum = valid.reduce<number>((s, p) => s + (p ?? 0), 0);
  const nearest = quotient(2 * sum * scale + whole, 2 * whole);
  const floors = down.reduce((s, d) => s + (d?.units ?? 0), 0);
  const order = down
    .flatMap((d, i) => (d && d.lost > 0 ? [{ i, lost: d.lost }] : []))
    .sort((a, b) => b.lost - a.lost || a.i - b.i);
  const up = new Set(order.slice(0, Math.max(0, (target ?? nearest) - floors)).map((o) => o.i));
  return down.map((d, i) => (d ? d.units + (up.has(i) ? 1 : 0) : null));
}

/** Each part's share of the bar the parts with a length make. */
function pieces(parts: { key: BridgeKey; cents: number }[]): BridgePiece[] {
  const whole = parts.reduce((s, p) => s + Math.max(0, p.cents), 0);
  return parts.map((p) => ({ ...p, share: whole > 0 && p.cents > 0 ? p.cents / whole : 0 }));
}

export function bridgeView(totals: BridgeTotals): BridgeView {
  const c = coverOf(totals);
  const draws = totals.incomeCents > 0 && totals.consumptionCents >= 0 && totals.debtCents >= 0;
  // money taken out of savings is no part of where the money went: it is one of the sources
  const went = pieces([
    { key: "consumption", cents: totals.consumptionCents },
    { key: "debt", cents: totals.debtCents },
    { key: "saved", cents: Math.max(0, totals.savedCents) },
    ...(c.creditRepaidCents > 0 ? [{ key: "repaid" as const, cents: c.creditRepaidCents }] : []),
    { key: "left", cents: Math.max(0, totals.leftCents) },
  ]);
  // the income pays first; what it did not pay was covered with credit, savings and the accounts or a card (`coverOf`)
  const sources =
    !c.creditDrawnCents && !c.savingsDrawnCents && !c.accountsCents
      ? []
      : pieces([
          { key: "income", cents: totals.incomeCents },
          { key: "credit", cents: c.creditCents },
          { key: "savings", cents: c.savingsCents },
          { key: "accounts", cents: c.accountsCents },
          { key: "credit-left", cents: c.creditLeftCents },
          { key: "savings-left", cents: c.savingsLeftCents },
        ]);
  // what stayed is a share of the income only when the income was all the money
  const leftOfIncome = draws && totals.leftCents >= 0 && sources.length === 0;

  type Raw = Omit<BridgeRow, "incomeUnits" | "incomeShare">;
  const rawRows: Raw[] = ([
    { key: "income", cents: totals.incomeCents, side: "in", ofIncome: draws },
    { key: "credit-drawn", cents: c.creditDrawnCents, side: "in", ofIncome: false },
    { key: "savings-drawn", cents: c.savingsDrawnCents, side: "in", ofIncome: false },
    ...went.filter((p) => p.key !== "left").map((p): Raw => ({ key: p.key, cents: p.cents, side: "out", ofIncome: draws && p.key !== "repaid" })),
  ] satisfies Raw[]).filter((r) => r.cents > 0 || r.key === "income" || r.key === "consumption" || r.key === "debt" || (r.key === "saved" && totals.savedCents >= 0));
  rawRows.push({ key: "left", cents: totals.leftCents, side: "stayed", ofIncome: leftOfIncome });

  // the parts told as shares are rounded together, so the table and the legend both add up to the 100 % they are
  // parts of; the income's own row is that whole
  const rounded = rawRows.filter((r) => r.ofIncome && r.key !== "income");
  const units = new Map<string, number | null>(roundedShares(rounded.map((r) => r.cents), totals.incomeCents).map((u, i) => [rounded[i]!.key, u]));
  const shareOf = (key: string, cents: number, ofIncome: boolean): IncomeShare => ({
    ofIncome,
    incomeUnits: ofIncome ? (units.get(key) ?? null) : null,
    incomeShare: ofIncome && totals.incomeCents !== 0 ? cents / totals.incomeCents : null,
  });

  const cover = sources.filter((p) => (p.key === "credit" || p.key === "savings" || p.key === "accounts") && prints(p.cents));
  const figures: BridgeFigure[] = [
    { key: "income" as const, cents: totals.incomeCents, ...shareOf("income", totals.incomeCents, false) },
    ...went.filter((p) => p.key !== "left" && (p.key !== "saved" || totals.savedCents >= 0)).map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, p.key !== "repaid") })),
    ...cover.map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, false) })),
    ...(totals.leftCents >= 0 ? went.filter((p) => p.key === "left").map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, leftOfIncome) })) : []),
  ];
  return { totals, cover: c, draws, parts: went, sources, figures, rows: rawRows.map((r) => ({ ...r, ...shareOf(r.key, r.cents, r.ofIncome) })) };
}
