/**
 * Ruoka: what the household's food money bought, line by line (Ruokakauppa, Ravintolat ja kahvilat, Ruoan
 * kotiinkuljetus, Alko), over the window of the themes report (`themeWindow`).
 *
 * - The lines are the themes report's own: a line's sum is its rows' `spend` as `themeOf` places them, a large
 *   purchase is in none, and the lines' cents a month are shared out by `sharedOut` as the report does, so the four
 *   add up to the theme `food` of `themesReport` to the cent. Money back lowers the line in the month it comes.
 * - A purchase is a row of the line with `netPurchase` over 0 that is not a payment to a person (`isPurchase`):
 *   money back is none, and a MobilePay to a friend filed under restaurants stays in the line's sum but is no
 *   purchase. A delivery and a grocery purchase are what `behaviourOf` counts (one definition): a recurring delivery
 *   fee is none. The mean purchase is the net purchases over their count, not the line's sum, which holds money back
 *   for older purchases. Under six purchases the mean, the visits a month and the weekdays are none.
 * - A week is the line's sum over the window's days (ISO days, so no summer-time hour), rounded for each line alone.
 * - A change is told over nine months or more, when the mean of the newest three is outside the lowest-to-highest
 *   of the six before them and the difference to their usual level is over `gateFor` of it.
 * - Card bills in the window are a row of their own: the line sums never read as all the food money.
 */
import { behaviourOf, isPurchase } from "../behaviour/index.ts";
import { dateIn, daysBetween, fromMonthIndex, monthEnd, weekdayOf } from "../dates.ts";
import { THEMES, themeOf } from "../themes.ts";
import { cardBillsByMonth } from "./card-bills.ts";
import { type AnalysisContext, type AnalysisTx, netPurchase } from "./context.ts";
import { sharedOut, themeWindow } from "./themes-report.ts";
import { gateFor, usualCents } from "./usual.ts";

/** Purchases a line needs before its mean, its visits a month and its weekdays are told. */
const MIN_PURCHASES = 6;
/** The payees a line lists before the rest. */
const PAYEES = 5;
/** The months the basket looks at now, and as many before them. */
const SIDE = 3;
/** The months before the newest three whose usual level a change is told against. */
const USUAL_SIDE = 6;
/** The lines where a purchase is a visit, so the weekday says something; a delivery is an order. */
const VISITS: ReadonlySet<string> = new Set(["groceries", "restaurants", "alcohol"]);

const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
/** `n / d` to the nearest whole number for integers, a half up; no float quotient decides it. */
const rounded = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

interface Side {
  purchases: number;
  /** The mean purchase in cents; null when either side of the basket has under six purchases. */
  meanCents: number | null;
  /** Purchases a month, one decimal; null when either side of the basket has under six purchases. */
  perMonth: number | null;
}

interface FoodLine {
  /** The category id: groceries, restaurants, food_delivery or alcohol. */
  id: string;
  heading: string;
  /** The line's sum in the window, a minus when more came back than was spent. */
  cents: number;
  /** The line's cents a month: the same figure as the line of `themesReport`. */
  monthlyCents: number;
  /** The line's sum by month, the window's months in order. */
  monthCents: number[];
  /** The index in `monthCents` of the dearest month; null when no month is over 0. */
  dearest: number | null;
  /** A week of the line's spending; null for a line at or under 0. */
  weekCents: number | null;
  /** Purchases in the window. */
  purchases: number;
  /** The mean purchase and the visits a month; null under six purchases and for a line at or under 0. */
  meanCents: number | null;
  perMonth: number | null;
  /** The five payees with most spending, largest first, and the rest of the line in one sum: they add up to `cents`. */
  payees: { payee: string; cents: number }[];
  otherCents: number;
  /** Purchases by weekday, Monday first, for a line where a purchase is a visit; null for another line or under six purchases. */
  weekdays: number[] | null;
  /** The newest three months' mean less the usual of the six before, when it is a change (see the head); null otherwise. */
  changeCents: number | null;
}

export interface FoodReport {
  /** The months the figures are of, as in `themesReport`: `first` to `last`, how many, and the days in them. */
  window: { first: string; last: string; months: number; days: number };
  lines: FoodLine[];
  /** The four lines together: the theme `food` of `themesReport`. */
  cents: number;
  monthlyCents: number;
  /** Card bills of the window, which hold purchases in no line; null when there are none. */
  cardBills: { cents: number; monthlyCents: number } | null;
  /** Ruokakauppa's purchases in the newest three months and in the three before them; null under six months. */
  basket: { now: Side; before: Side } | null;
}

/** The change of a line: see the head of the file. */
function changeOf(monthCents: readonly number[]): number | null {
  const n = monthCents.length;
  if (n < SIDE + USUAL_SIDE) return null;
  const before = monthCents.slice(n - SIDE - USUAL_SIDE, n - SIDE);
  const recent = Math.round(sum(monthCents.slice(n - SIDE)) / SIDE);
  const usual = usualCents(before);
  if (usual === null || (recent >= Math.min(...before) && recent <= Math.max(...before))) return null;
  return Math.abs(recent - usual) > gateFor(usual) ? recent - usual : null;
}

function sideOf(rows: readonly AnalysisTx[]): Side {
  return { purchases: rows.length, meanCents: rows.length ? rounded(sum(rows.map(netPurchase)), rows.length) : null, perMonth: Math.round((rows.length * 10) / SIDE) / 10 };
}

/** The food of the last complete months; null without a window (see `themeWindow`) and without food in it. */
export function foodReport(ctx: AnalysisContext): FoodReport | null {
  const w = themeWindow(ctx);
  if (!w) return null;
  const { months, rows, cars, large } = w;
  const n = months.length;
  const food = THEMES.find((theme) => theme.id === "food")!;
  const counts = behaviourOf(ctx);
  /** Is the row a purchase of its line? */
  const bought = (t: AnalysisTx, line: string) =>
    line === "food_delivery" ? counts.delivery.isDeliveryPurchase(t) : line === "groceries" ? counts.groceries.isGroceryPurchase(t) : isPurchase(t);
  const placed: { t: AnalysisTx; line: string }[] = [];
  for (const t of rows) {
    if (!t.spend || large.has(ctx.returns.get(t.id) ?? t.id)) continue;
    const at = themeOf(ctx, t, cars);
    if (at.theme === "food") placed.push({ t, line: at.line });
  }
  const cents = food.lines.map((l) => sum(placed.filter((p) => p.line === l.id).map((p) => p.t.spend)));
  const total = sum(cents);
  if (!total) return null;
  const monthly = Math.round(total / n) || 0;
  // as the themes report does: the cents a month are shared out among the lines that have a sum
  const listed = food.lines.map((_, i) => i).filter((i) => cents[i]);
  const shared = sharedOut(listed.map((i) => cents[i]!), n, monthly);
  const days = daysBetween(dateIn(fromMonthIndex(months[0]!), 1), monthEnd(fromMonthIndex(months[n - 1]!))) + 1;

  const lines = food.lines.map((l, i): FoodLine => {
    const own = placed.filter((p) => p.line === l.id).map((p) => p.t);
    const monthCents = months.map((m) => sum(own.filter((t) => t.month === m).map((t) => t.spend)));
    const purchases = own.filter((t) => bought(t, l.id));
    const told = cents[i]! > 0 && purchases.length >= MIN_PURCHASES;
    const byPayee = new Map<string, number>();
    for (const t of own) byPayee.set(t.merchant, (byPayee.get(t.merchant) ?? 0) + t.spend);
    const payees = [...byPayee]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, PAYEES)
      .map(([payee, c]) => ({ payee, cents: c }));
    const weekdays = Array.from({ length: 7 }, () => 0);
    for (const t of purchases) weekdays[weekdayOf(t.bookingDate)]!++;
    const top = Math.max(0, ...monthCents);
    return {
      id: l.id,
      heading: l.heading,
      cents: cents[i]!,
      monthlyCents: listed.includes(i) ? shared[listed.indexOf(i)]! : 0,
      monthCents,
      dearest: top > 0 ? monthCents.indexOf(top) : null,
      weekCents: cents[i]! > 0 ? rounded(cents[i]! * 7, days) : null,
      purchases: purchases.length,
      meanCents: told ? rounded(sum(purchases.map(netPurchase)), purchases.length) : null,
      perMonth: told ? Math.round((purchases.length * 10) / n) / 10 : null,
      payees,
      otherCents: cents[i]! - sum(payees.map((p) => p.cents)),
      weekdays: VISITS.has(l.id) && purchases.length >= MIN_PURCHASES ? weekdays : null,
      changeCents: cents[i]! > 0 ? changeOf(monthCents) : null,
    };
  });

  let basket: FoodReport["basket"] = null;
  if (n >= 2 * SIDE) {
    const shop = placed.filter((p) => p.line === "groceries" && bought(p.t, p.line)).map((p) => p.t);
    const now = sideOf(shop.filter((t) => months.slice(n - SIDE).includes(t.month)));
    const before = sideOf(shop.filter((t) => months.slice(n - 2 * SIDE, n - SIDE).includes(t.month)));
    const both = now.purchases >= MIN_PURCHASES && before.purchases >= MIN_PURCHASES;
    const told = (s: Side): Side => (both ? s : { ...s, meanCents: null, perMonth: null });
    basket = { now: told(now), before: told(before) };
  }

  const bills = sum(cardBillsByMonth(ctx, months));
  return {
    window: { first: fromMonthIndex(months[0]!), last: fromMonthIndex(months[n - 1]!), months: n, days },
    lines,
    cents: total,
    monthlyCents: monthly,
    cardBills: bills > 0 ? { cents: bills, monthlyCents: Math.round(bills / n) } : null,
    basket,
  };
}
