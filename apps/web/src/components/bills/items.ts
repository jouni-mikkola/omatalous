// Decision: which bills, contracts and subscriptions the household has, in one list where each stands once
import { addMonthsToDate, isCancelled, isContract, isEndedContract, isSavingsPlan, isSubscription, seriesMarkSubject, type UserMark } from "@banking/core";
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
  /** A subscription marked as cancelled while its charges go on. */
  stopped: boolean;
  /** The household marked it, or the payments say, that it ended. */
  ended: boolean;
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
    const stopped = isSubscription(s) && isCancelled(cancelled, s);
    const base = { key: s.id, name: s.merchant, category: s.category, cents: s.typicalAmountCents, monthlyCents: s.monthlyCents, series: s, stopped };
    if (stopped) return [{ ...base, kind: "ended", next: null, ended: true }];
    if (isEndedContract(s, marks, today) && s.contract!.lastDate >= since) return [{ ...base, kind: "ended", next: null, ended: true }];
    if (isSubscription(s)) return [{ ...base, kind: "subscription", next: s.nextDate, ended: false }];
    if (isContract(s)) return [{ ...base, kind: "contract", next: s.nextDate, ended: false }];
    if (isSavingsPlan(s)) return [{ ...base, kind: "saving", next: s.nextDate, ended: false }];
    if (hasEnded(s)) return [{ ...base, kind: "ended", next: null, ended: true }];
    return s.active && s.kind === "bill" ? [{ ...base, kind: "bill", next: s.nextDate, ended: false }] : [];
  });
  const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fi") === b.trim().toLocaleLowerCase("fi");
  // a bill typed in under the name of a live series is that bill, which the series carries: it is no row of its own
  const hostOf = (b: TypedBill) => fromSeries.find((i) => !i.ended && i.kind !== "saving" && sameName(i.name, b.name));
  const hosted = fromSeries.map((i) => {
    const mine = typed.filter((b) => hostOf(b)?.key === i.key);
    return mine.length ? { ...i, twins: mine } : i;
  });
  const own = typed.filter((b) => !hostOf(b)).map((b): Item => ({ key: `typed:${b.id}`, kind: "typed", name: b.name, category: b.category, next: b.nextDate, cents: b.amountCents, monthlyCents: null, typed: b, stopped: false, ended: false }));
  const live = [...hosted, ...own].filter((i) => !i.ended).sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || b.cents - a.cents);
  const done = hosted.filter((i) => i.ended).sort((a, b) => (b.series?.lastDate ?? "").localeCompare(a.series?.lastDate ?? ""));
  return [...live, ...done];
}
