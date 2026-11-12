// Decision: which bills, contracts and subscriptions the household has, in one list where each stands once
import { addMonthsToDate, isCancelled, isContract, isEndedContract, isSavingsPlan, isSubscription, missedOn, seriesMarkSubject, type UserMark } from "@banking/core";
import { t } from "../../text.ts";
import type { Recurring as Series, ReportsData } from "../../types.ts";

export type TypedBill = ReportsData["upcoming"]["manual"][number];

/** What a row is. A series is one of these by core's own definitions; a bill the household typed in is its own. */
export type Kind = "bill" | "subscription" | "contract" | "saving" | "ended" | "typed";

export const kindLabel = (kind: Kind): string => t(`bills.kind_${kind}`);

/**
 * The subject of the mark (`dismissed`) that says a found bill is no recurring bill: `not-recurring:` and the key a mark
 * on the series carries. The server leaves the series out of what is coming while the mark stands (its
 * services/wrong-bills.ts).
 */
export const wrongBillSubject = (s: Pick<Series, "id" | "kind" | "typicalAmountCents">): string => `not-recurring:${seriesMarkSubject(s).slice("series:".length)}`;

export interface Item {
  key: string;
  kind: Kind;
  name: string;
  category: string | null;
  /** The next due day, null for an ended series. */
  next: string | null;
  /** One charge, positive. */
  cents: number;
  /** A month's share of it, null for a bill typed in (it has no cadence of a month). */
  monthlyCents: number | null;
  series?: Series;
  typed?: TypedBill;
  /** Bills typed in under this series' name: the series carries them (one bill, counted once), so they are no rows and the drill offers their removal. */
  twins?: TypedBill[];
  /** A subscription marked as cancelled while its charges go on, or a bill that did not come answered as ended. */
  stopped: boolean;
  /** The household marked it, or the payments say, that it ended. */
  ended: boolean;
  /** The day its charge was due and did not come (core `missedOn`), null when none is late. */
  missed: string | null;
}

/** What has ended and is not pay or a shop habit: those have no place on a page about bills. */
const hasEnded = (s: Series) => !s.active && s.kind !== "habit" && s.kind !== "income";

/** A contract that ended in the last two years stays; older ones are history the transactions keep. */
const CONTRACT_YEARS = 2;

/**
 * The one list of Laskut. Each series is one row and takes its kind from core (`isSubscription`, `isContract`,
 * `isSavingsPlan`); a subscription marked as cancelled and a contract that ended are "Päättynyt", and a bill typed in is
 * a row of its own. Live rows come first by their next day, the ended last.
 */
export function billItems({ series, typed, cancelled, marks, today }: { series: readonly Series[]; typed: readonly TypedBill[]; cancelled: ReadonlySet<string>; marks: ReadonlyMap<string, UserMark>; today: string }): Item[] {
  const since = addMonthsToDate(today, -12 * CONTRACT_YEARS);
  const fromSeries = series.flatMap((s): Item[] => {
    const missed = missedOn(s, today);
    // a bill that did not come is read as the live series it was until the payments say it ended: its kind, its row
    const live = missed && !s.active ? { ...s, active: true } : s;
    // a subscription marked as cancelled, or a bill that did not come and was answered as ended (Tarkistettavat)
    const stopped = (isSubscription(live) || missed !== null) && isCancelled(cancelled, s);
    const base = { key: s.id, name: s.merchant, category: s.category, cents: s.typicalAmountCents, monthlyCents: s.monthlyCents, series: s, stopped, missed: null };
    if (stopped) return [{ ...base, kind: "ended", next: null, ended: true }];
    if (isEndedContract(s, marks, today) && s.contract!.lastDate >= since) return [{ ...base, kind: "ended", next: null, ended: true }];
    // past `active` the fixed costs over the table leave a missed bill out, so its row shows no month's share either
    const on = { ...base, next: s.nextDate, ended: false, missed, ...(live !== s ? { monthlyCents: null } : {}) };
    if (isSubscription(live)) return [{ ...on, kind: "subscription" }];
    if (isContract(live)) return [{ ...on, kind: "contract" }];
    if (isSavingsPlan(s)) return [{ ...on, kind: "saving" }];
    if (hasEnded(live)) return [{ ...base, kind: "ended", next: null, ended: true }];
    return live.active && s.kind === "bill" ? [{ ...on, kind: "bill" }] : [];
  });
  const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fi") === b.trim().toLocaleLowerCase("fi");
  // a bill typed in under the name of a live series is that bill, which the series carries: it is no row of its own. A
  // missed one carries none: the forecast takes the typed bill for its own once the series is overdue (core
  // analysis/forecast.ts, `active && !overdue`), and `missed` starts on the same day, so the typed bill is a row then
  const hostOf = (b: TypedBill) => fromSeries.find((i) => !i.ended && i.kind !== "saving" && !i.missed && sameName(i.name, b.name));
  const hosted = fromSeries.map((i) => {
    const mine = typed.filter((b) => hostOf(b)?.key === i.key);
    return mine.length ? { ...i, twins: mine } : i;
  });
  const own = typed.filter((b) => !hostOf(b)).map((b): Item => ({ key: `typed:${b.id}`, kind: "typed", name: b.name, category: b.category, next: b.nextDate, cents: b.amountCents, monthlyCents: null, typed: b, stopped: false, ended: false, missed: null }));
  const live = [...hosted, ...own].filter((i) => !i.ended).sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || b.cents - a.cents);
  const done = hosted.filter((i) => i.ended).sort((a, b) => (b.series?.lastDate ?? "").localeCompare(a.series?.lastDate ?? ""));
  return [...live, ...done];
}
