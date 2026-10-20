/**
 * Grocery days and basket (R1 §3.2). A shopping day is a day with a grocery purchase; a visit is one (day, merchant)
 * pair, so two purchases in one shop the same day are one visit; a basket is a visit's net purchase. A kiosk is
 * groceries in the rules but a top-up, not a shop visit: it is counted apart. Days are booking days until the purchase
 * day is stored (`dayKind`), so a Saturday booked on Monday is a Monday.
 */
import type { AnalysisTx } from "../analysis/context.ts";
import { fold } from "../merchant.ts";
import { isKiosk } from "../wording-shops.ts";
import { type Covers, type Span, WINDOWS, type Windows, mondayOf, usualWeekly } from "./week.ts";

/** Visits a mean basket needs. */
const MIN_BASKET_VISITS = 4;
/** Shopping days above usual by this many or more. */
const ABOVE_BY = 2;

interface ShopFigures extends Span {
  days: number;
  visits: number;
  /** The mean basket of a visit in cents (its net purchases, kiosks left out); null under four visits. The money of the line is Raportit > Ruoka's. */
  basketCents: number | null;
  kioskVisits: number;
  covered: boolean;
}

export interface GroceriesBehaviour {
  week: ShopFigures;
  month: ShopFigures;
  lastMonth: ShopFigures;
  dayKind: "booking";
  /** The median shopping days a week over the covered weeks before; null without it. */
  usual: number | null;
  above: boolean;
  covered: boolean;
  confidence: "known" | "estimated";
  evidenceIds: string[];
  /** Is the row a grocery purchase, a kiosk's too? The one definition, which `analysis/food.ts` reads too. */
  isGroceryPurchase: (t: AnalysisTx) => boolean;
}

class Visits {
  readonly days = new Set<number>();
  readonly visits = new Map<string, number>();
  readonly kiosks = new Set<string>();
  readonly ids: string[] = [];

  add(day: number, t: AnalysisTx, cents: number): void {
    const key = `${day}|${t.merchant}`;
    this.ids.push(t.id);
    if (isKiosk(fold(t.merchant))) return void this.kiosks.add(key);
    this.days.add(day);
    this.visits.set(key, (this.visits.get(key) ?? 0) + cents);
  }

  figures(span: Span, covered: boolean): ShopFigures {
    let cents = 0;
    for (const c of this.visits.values()) cents += c;
    const n = this.visits.size;
    return { ...span, days: this.days.size, visits: n, basketCents: n >= MIN_BASKET_VISITS ? Math.round(cents / n) : null, kioskVisits: this.kiosks.size, covered };
  }
}

/** The grocery visits by week and in the windows told, filled one row at a time. */
export class Shops {
  private readonly weeks = new Map<number, Visits>();
  private readonly windows = { week: new Visits(), month: new Visits(), lastMonth: new Visits() };
  private readonly w: Windows;
  constructor(w: Windows) {
    this.w = w;
  }

  add(day: number, t: AnalysisTx, cents: number): void {
    const monday = mondayOf(day);
    let v = this.weeks.get(monday);
    if (!v) this.weeks.set(monday, (v = new Visits()));
    v.add(day, t, cents);
    WINDOWS.forEach((key, i) => day >= this.w.days[i]![0] && day <= this.w.days[i]![1] && this.windows[key].add(day, t, cents));
  }

  result(covers: Covers, isGroceryPurchase: (t: AnalysisTx) => boolean): GroceriesBehaviour {
    const { w, windows } = this;
    const week = windows.week.figures(w.week, covers(w.week.from, w.week.to));
    const days = new Map([...this.weeks].map(([m, v]) => [m, v.days.size] as const));
    const usual = usualWeekly(days, w, covers);
    return {
      week,
      month: windows.month.figures(w.month, covers(w.month.from, w.month.to)),
      lastMonth: windows.lastMonth.figures(w.lastMonth, covers(w.lastMonth.from, w.lastMonth.to)),
      dayKind: "booking",
      usual: usual?.usual ?? null,
      above: !!usual && week.days >= usual.usual + ABOVE_BY,
      covered: week.covered,
      confidence: week.covered ? "known" : "estimated",
      evidenceIds: windows.week.ids,
      isGroceryPurchase,
    };
  }
}
