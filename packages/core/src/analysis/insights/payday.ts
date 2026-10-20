/**
 * BA5: the days after pay take more than the days before (`paydayEffect`, D6 of the behaviour model). The gate and the
 * history rule are D6's: six closed, covered pay cycles or more, twice the pace of the week before pay (1,6 with any
 * one cycle left out), no permutation of the days beating it, 50 € a cycle. The detector judges on today, so a closed
 * past period stays quiet. Booking days are not purchase days: the figure is an estimate, told as info and never as a
 * warning, and it says nothing of the household's character.
 */
import { addDays, dayNumber, fromDayNumber } from "../../dates.ts";
import { paydayEffect, payDays } from "../../behaviour/payday.ts";
import { formatEur, formatFiDate } from "../format.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** The rows behind the figure: the after-pay rows of the newest cycles, at most this many. */
const MAX_ROWS = 60;
/** Pay day and the three days after it, as D6 counts them. */
const AFTER_DAYS = 4;

/** "2,1" */
const times = (ratio: number) => ratio.toFixed(1).replace(".", ",");

export function paydaySpending({ ctx, end }: InsightArgs): Insight[] {
  if (end !== ctx.today) return [];
  const p = paydayEffect(ctx);
  if (!p.told || !p.ratio || !p.extraCents || !p.cycles.length) return [];
  // the effect is a cycle's: a year holds as many cycles as pays came in the last 365 days (12 for a monthly pay)
  const yearAgo = dayNumber(addDays(end, -365));
  const perYear = payDays(ctx).filter((d) => d > yearAgo && d <= dayNumber(end)).length;
  const extra = p.extraCents.value;
  const yearly = extra * perYear;
  if (yearly <= 0) return [];
  const n = p.cycles.length;
  const last = p.cycles[n - 1]!;
  const mean = (f: (c: (typeof p.cycles)[number]) => number) => Math.round(p.cycles.reduce((s, c) => s + f(c), 0) / n);
  return [
    {
      id: "payday",
      tone: "info",
      title: `Palkan jälkeen rahaa menee ${times(p.ratio.value)} kertaa nopeammin`,
      detail: `Palkkapäivä ja kolme seuraavaa päivää ${n} palkkajaksossa verrattuna palkkaa edeltävään viikkoon, ${formatEur(extra, false)} jaksossa enemmän; laskut ja suuret kertaostot eivät ole mukana.`,
      yearlyCents: yearly,
      direction: 1,
      rows: p.cycles.flatMap((c) => c.rows).slice(-MAX_ROWS),
      link: { from: last.pay, to: fromDayNumber(dayNumber(last.pay) + AFTER_DAYS - 1) },
      calc: [
        { label: "Palkkajaksoja", value: String(n) },
        { label: "Palkan jälkeen, neljä päivää jaksossa", value: formatEur(mean((c) => c.afterCents), false) },
        { label: "Ennen palkkaa, seitsemän päivää jaksossa", value: formatEur(mean((c) => c.beforeCents), false) },
        { label: "Suhde viikonpäivät huomioiden", value: times(p.ratio.value) },
        { label: "Enemmän jaksossa", value: formatEur(extra, false) },
        { label: `Palkkoja vuodessa ${formatFiDate(fromDayNumber(yearAgo + 1))} alkaen`, value: String(perYear) },
        { label: "Vuodessa", value: formatEur(yearly, false) },
      ],
    },
  ];
}
