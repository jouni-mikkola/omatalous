import { getCategory } from "../categories.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { formatEur } from "../analysis/format.ts";
import { addDays } from "../dates.ts";
import { type Cadence, projectDates } from "../recurring.ts";
import type { IsoDate } from "../types.ts";

/** Bills that come every second month or less often: the ones a household forgets. */
const RARE: ReadonlySet<Cadence> = new Set(["bimonthly", "quarterly", "semiannual", "yearly"]);
const HORIZON_DAYS = 92;
/** Shops and visits: a quarterly pet food order is a purchase, not a bill. */
const PURCHASE_LIKE = new Set(["groceries", "restaurants", "food_delivery", "alcohol", "shopping", "home", "entertainment", "travel", "personal_care", "gifts_donations", "gambling", "pets", "health", "other"]);
/** A small yearly charge (a 2 € storage plan) is not worth a line. */
const MIN_CENTS = 1000;

export interface UpcomingBill {
  merchant: string;
  category: string;
  cadence: Cadence;
  /** Expected date; today for a charge that is a few days late. */
  date: IsoDate;
  /** What the last charges were, positive. */
  amountCents: number;
}

export interface UpcomingReport {
  from: IsoDate;
  to: IsoDate;
  /** Date ascending. */
  items: UpcomingBill[];
  totalCents: number;
  /** What the bills mean and what to do, in one sentence or two; "" without bills. */
  advice: string;
}

/**
 * Bills in the next three months that do not come every month: quarterly
 * insurance, yearly taxes and memberships. The monthly ones are in the
 * forecast and on the recurring page; these are the ones that surprise.
 * Always about today, whatever period the page shows.
 */
export function upcomingReport(ctx: AnalysisContext): UpcomingReport {
  const from = ctx.today;
  const to = addDays(from, HORIZON_DAYS);
  const items: UpcomingBill[] = [];
  for (const s of ctx.recurring) {
    if (!s.active || s.overdue || !s.cadence || !RARE.has(s.cadence) || (s.kind !== "subscription" && s.kind !== "bill")) continue;
    const kind = getCategory(s.category).kind;
    if ((kind !== "expense" && kind !== "debt") || s.category === "card_bill" || PURCHASE_LIKE.has(s.category) || s.typicalAmountCents < MIN_CENTS) continue;
    for (const d of projectDates(s, to)) {
      if (d > to) continue;
      items.push({ merchant: s.merchant, category: s.category, cadence: s.cadence, date: d < from ? from : d, amountCents: s.typicalAmountCents });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);
  return { from, to, items, totalCents, advice: items.length ? advice(items, totalCents) : "" };
}

function advice(items: readonly UpcomingBill[], total: number): string {
  const when = "Seuraavan kolmen kuukauden aikana erääntyy";
  return items.length === 1
    ? `${when} yksi lasku, jota ei makseta joka kuukausi. Jätä rahaa tilille ennen eräpäivää.`
    : `${when} ${items.length} laskua, joita ei makseta joka kuukausi, yhteensä ${formatEur(total, false)}. Jätä rahaa tilille ennen kutakin eräpäivää.`;
}
