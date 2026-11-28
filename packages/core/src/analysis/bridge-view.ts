// Decision: move money to savings
// No page draws this view now; bridgeView stays exported because the frozen module-host surface lists it (contracts/*/module-host.json).
/**
 * The figures of the "where the income went" bar (Tulojen käyttö) as the server sends them: which parts the bar and
 * the strip over it have, each part's share of its bar, the rows of the table and the shares of the income printed
 * beside them, rounded together so they add up. The web gives each key its label and colour and adds up nothing.
 */
import type { DebtSplit } from "./debt-split.ts";
import { coverOf, type GapCover, type PeriodTotals } from "./flows.ts";

type BridgeTotals = Pick<PeriodTotals, "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "borrowedCents" | "leftCents">;

/** `interest`, `debt` and `principal` are the parts of the debt service when it is told apart; `debt` is then what no evidence splits. `subtotal` is the income less the spending and the interest, before the repayments. */
type BridgeKey = "income" | "consumption" | "interest" | "debt" | "subtotal" | "principal" | "saved" | "repaid" | "left" | "credit" | "savings" | "accounts" | "credit-left" | "savings-left";

/** A part of a bar: its sum and the share of the bar it fills (0 for a part with no length). */
interface BridgePiece {
  key: BridgeKey;
  cents: number;
  share: number;
}

/** A figure that may also be told as a share of the income. */
interface IncomeShare {
  /** The figure is a share of the money the period had (the income, and what was taken out of savings or drawn on credit and stayed), so it is also told as one. */
  ofIncome: boolean;
  /** Whole percents of that money, rounded with the other parts so they add up (`roundedShares`); null outside that rounding. */
  incomeUnits: number | null;
  /** cents / that money, for a share outside the rounding; null without income. */
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
  /** The debt service is told in interest and repayments (`DebtSplit`): the rows `interest` and `principal` stand where `debt` stood. False when it is told whole. */
  debtSplit: boolean;
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

/**
 * The bridge of a period. `split` is the debt service in its kinds (`debtSplit`): with interest or repayments in it the
 * debt is told as Korot ja luottokulut, what no evidence splits and Lyhennykset, and the sum of the first two and the
 * spending is taken off the income before the repayments. Without it, or when it tells no interest and no repayment,
 * the debt is one part, as it always was.
 */
export function bridgeView(totals: BridgeTotals, split?: DebtSplit): BridgeView {
  const c = coverOf(totals);
  const told = split !== undefined && (split.interestCents !== 0 || split.principalCents !== 0);
  const debtParts: { key: BridgeKey; cents: number }[] = told
    ? [
        { key: "interest", cents: split.interestCents },
        { key: "debt", cents: split.unsplitCents },
        { key: "principal", cents: split.principalCents },
      ]
    : [{ key: "debt", cents: totals.debtCents }];
  const draws = totals.incomeCents > 0 && totals.consumptionCents >= 0 && debtParts.every((p) => p.cents >= 0);
  // money taken out of savings is no part of where the money went: it is one of the sources
  const went = pieces([
    { key: "consumption", cents: totals.consumptionCents },
    ...debtParts,
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
  // The income paid everything (no gap): what was taken out of savings or drawn on credit then stayed, so the parts and what
  // stayed add up to the income and that money together, and their shares are shares of it. With a gap, the income alone is
  // the base and what stayed is no share of it.
  const shared = draws && c.gapCents === 0;
  const whole = shared ? totals.incomeCents + c.creditLeftCents + c.savingsLeftCents : totals.incomeCents;
  const leftOfIncome = shared && totals.leftCents >= 0;

  type Raw = Omit<BridgeRow, "incomeUnits" | "incomeShare">;
  const rawRows: Raw[] = ([
    { key: "income", cents: totals.incomeCents, side: "in", ofIncome: draws },
    { key: "credit-drawn", cents: c.creditDrawnCents, side: "in", ofIncome: false },
    { key: "savings-drawn", cents: c.savingsDrawnCents, side: "in", ofIncome: false },
    ...went.filter((p) => p.key !== "left").map((p): Raw => ({ key: p.key, cents: p.cents, side: "out", ofIncome: draws && p.key !== "repaid" })),
  ] satisfies Raw[]).filter((r) => r.cents > 0 || r.key === "income" || r.key === "consumption" || (r.key === "debt" && !told) || (r.key === "saved" && totals.savedCents >= 0));
  rawRows.push({ key: "left", cents: totals.leftCents, side: "stayed", ofIncome: leftOfIncome });

  // the parts told as shares are rounded together, so the table and the legend both add up to the 100 % they are
  // parts of; the income's own row is that whole
  const rounded = rawRows.filter((r) => r.ofIncome && r.key !== "income");
  const units = new Map<string, number | null>(roundedShares(rounded.map((r) => r.cents), whole).map((u, i) => [rounded[i]!.key, u]));
  const shareOf = (key: string, cents: number, ofIncome: boolean): IncomeShare => ({
    ofIncome,
    incomeUnits: ofIncome ? (units.get(key) ?? null) : null,
    incomeShare: ofIncome && whole !== 0 ? cents / whole : null,
  });

  const cover = sources.filter((p) => (p.key === "credit" || p.key === "savings" || p.key === "accounts") && prints(p.cents));
  // what is left of the money in after the costs, before the repayments: the money in is the income and what was drawn and stayed
  const stayed = c.gapCents === 0 ? c.creditLeftCents + c.savingsLeftCents : 0;
  const subtotal: BridgeFigure = { key: "subtotal", cents: totals.incomeCents + stayed - totals.consumptionCents - (split?.interestCents ?? 0) - (split?.unsplitCents ?? 0), ...shareOf("subtotal", 0, false) };
  const spent = went
    .filter((p) => p.key !== "left" && (p.key !== "saved" || totals.savedCents >= 0) && !(told && (p.key === "interest" || p.key === "debt" || p.key === "principal") && p.cents === 0))
    .map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, p.key !== "repaid") }));
  // the subtotal stands after the last cost and before the repayments
  if (told) {
    let at = 0;
    spent.forEach((f, i) => {
      if (f.key === "consumption" || f.key === "interest" || f.key === "debt") at = i + 1;
    });
    spent.splice(at, 0, subtotal);
  }
  const figures: BridgeFigure[] = [
    { key: "income" as const, cents: totals.incomeCents, ...shareOf("income", totals.incomeCents, false) },
    // what was drawn and stayed is money in beside the income: without its row the parts and Tulos add up to more than the
    // income. It is a source, not a part, so it has no share of its own. With a gap it is no row: the list then adds up to
    // the income and the cover, and Tulos is the drawn money that covered nothing, so no row names it by another sum.
    ...sources
      .filter((p) => c.gapCents === 0 && (p.key === "credit-left" || p.key === "savings-left") && prints(p.cents))
      .map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, false) })),
    ...spent,
    ...cover.map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, false) })),
    ...(totals.leftCents >= 0 ? went.filter((p) => p.key === "left").map((p) => ({ key: p.key, cents: p.cents, ...shareOf(p.key, p.cents, leftOfIncome) })) : []),
  ];
  return { totals, cover: c, debtSplit: told, draws, parts: went, sources, figures, rows: rawRows.map((r) => ({ ...r, ...shareOf(r.key, r.cents, r.ofIncome) })) };
}
