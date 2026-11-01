/**
 * Asetukset > Tilit, "Täsmää pankin saldoon": the words for the answer of the server (`reconcile` of an account in
 * /api/meta). Pure, so a test reads it without a page.
 */
import { type ReconcileResult, daysBetween } from "@banking/core";
import { dateRange, money } from "../../format.ts";
import { labelTable, t, tn } from "../../text.ts";

type Interval = ReconcileResult["intervals"][number];

/** The bank's own words for why a stretch is not proved, by the id the server gives. */
const REASON_TEXT: Record<string, string> = labelTable({
  only_available: () => t("set.rec.only_the_available_balance"),
  no_reference_day: () => t("set.rec.the_bank_has_not_given"),
  type_changed: () => t("set.rec.the_type_changed"),
  too_few: () => t("set.rec.too_few_balances"),
  rows_start_later: () => t("set.rec.the_transactions_start_later"),
  foreign_rows: () => t("set.rec.some_of_the_transactions_are"),
});

/** A difference in cents as a sum; a minus is U+2212, a plus is not written. */
const differenceText = (cents: number): string => `${cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;

interface ReconcileRow {
  from: string;
  to: string;
  /** "7 päivää" */
  days: string;
  text: string;
  /** The walk from the newest day back stopped here. */
  stop: boolean;
}

interface ReconcileView {
  /** The whole line: "Täsmää pankin saldoon", "Ei täsmää pankin saldoon" or why the check cannot be made yet. */
  headline: string;
  /** The newest stretch proves: the line has a tick and no reason. */
  proved: boolean;
  /** The reason when it does not prove. */
  reason: string | null;
  /** Newest first: the stretches that match, and each interval that does not. Empty when there is nothing to open. */
  rows: ReconcileRow[];
  /** What is said of the days after the last balance of the series, when its type changed. */
  after: string | null;
}

/** Why a check cannot be made yet, in a clause after "Emme voi vielä verrata saldoa pankin tietoihin:". */
const WAIT_TEXT: Record<string, string> = labelTable({
  too_few: () => t("set.rec.there_are_too_few_balances"),
  only_available: () => t("set.rec.the_bank_gives_only_the"),
  type_changed: () => t("set.rec.the_type_of_the_balance"),
});

const reasonOf = (id: string | null): string | null => (id ? (REASON_TEXT[id] ?? null) : null);

/** The unbroken runs of matched intervals become one row; an interval that differs or is unknown stays one. */
function rowsOf(result: ReconcileResult): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  let run: { from: string; to: string } | null = null;
  const flush = () => {
    if (run) rows.push({ from: run.from, to: run.to, days: tn(daysBetween(run.from, run.to) + 1, "set.rec.day_one", "set.rec.day_many"), text: t("set.rec.matches"), stop: false });
    run = null;
  };
  for (const i of result.intervals as Interval[]) {
    if (i.state === "matched") {
      run = run ? { from: run.from, to: i.toDay } : { from: i.fromDay, to: i.toDay };
      continue;
    }
    flush();
    const text = i.state === "differs" ? t("set.rec.difference", { amount: differenceText(i.diffCents) }) : (reasonOf(i.reason) ?? t("set.rec.does_not_match"));
    rows.push({ from: i.fromDay, to: i.toDay, days: tn(daysBetween(i.fromDay, i.toDay) + 1, "set.rec.day_one", "set.rec.day_many"), text, stop: false });
  }
  flush();
  rows.reverse();
  // the walk goes from the newest day back and stops at the first row that does not match
  const stop = rows.find((r) => r.text !== t("set.rec.matches"));
  if (stop) stop.stop = true;
  return rows;
}

export function reconcileView(result: ReconcileResult): ReconcileView {
  const proved = result.status === "proved";
  const newest = result.intervals[result.intervals.length - 1];
  const reason = proved
    ? null
    : (reasonOf(result.reason) ?? (result.status === "differs" ? t("set.rec.does_not_match") : (reasonOf(newest?.reason ?? null) ?? t("set.rec.does_not_match"))));
  const waitFor = (id: string | null) => (id ? (WAIT_TEXT[id] ?? REASON_TEXT[id]) : undefined);
  const headline = proved
    ? t("set.rec.matches_the_bank_s_balance")
    : result.status === "differs"
      ? t("set.rec.does_not_match_the_bank")
      : t("set.rec.cannot_check_yet", { reason: waitFor(result.reason) ?? waitFor(newest?.reason ?? null) ?? t("set.rec.there_is_not_enough_data") });
  return {
    headline,
    proved,
    reason,
    rows: rowsOf(result),
    after: result.reason === "type_changed" && result.intervals.length ? REASON_TEXT.type_changed! : null,
  };
}

/** "1.–7.10.2026" */
export const periodText = (r: Pick<ReconcileRow, "from" | "to">): string => dateRange(r.from, r.to);
