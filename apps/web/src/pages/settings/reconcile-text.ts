/**
 * Asetukset > Tilit, "Täsmää pankin saldoon": the words for the answer of the server (`reconcile` of an account in
 * /api/meta). Pure, so a test reads it without a page.
 */
import { type ReconcileResult, daysBetween } from "@banking/core";
import { date, money, plural } from "../../format.ts";

type Interval = ReconcileResult["intervals"][number];

/** The bank's own words for why a stretch is not proved, by the id the server gives. */
const REASON_TEXT: Record<string, string> = {
  only_available: "vain käytettävissä oleva saldo",
  no_reference_day: "ei viitepäivää",
  type_changed: "tyyppi vaihtui",
  too_few: "liian vähän saldoja",
  rows_start_later: "rivit alkavat myöhemmin",
  foreign_rows: "sisältää rivejä muussa valuutassa",
};

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
  /** The newest stretch proves: the line has a tick and no reason. */
  proved: boolean;
  /** The reason when it does not prove. */
  reason: string | null;
  /** Newest first: the stretches that match, and each interval that does not. Empty when there is nothing to open. */
  rows: ReconcileRow[];
  /** What is said of the days after the last balance of the series, when its type changed. */
  after: string | null;
}

const reasonOf = (id: string | null): string | null => (id ? (REASON_TEXT[id] ?? null) : null);

/** The unbroken runs of matched intervals become one row; an interval that differs or is unknown stays one. */
function rowsOf(result: ReconcileResult): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  let run: { from: string; to: string } | null = null;
  const flush = () => {
    if (run) rows.push({ from: run.from, to: run.to, days: plural(daysBetween(run.from, run.to) + 1, "päivä", "päivää"), text: "täsmää", stop: false });
    run = null;
  };
  for (const i of result.intervals as Interval[]) {
    if (i.state === "matched") {
      run = run ? { from: run.from, to: i.toDay } : { from: i.fromDay, to: i.toDay };
      continue;
    }
    flush();
    const text = i.state === "differs" ? `ero ${differenceText(i.diffCents)}` : (reasonOf(i.reason) ?? "ei täsmää");
    rows.push({ from: i.fromDay, to: i.toDay, days: plural(daysBetween(i.fromDay, i.toDay) + 1, "päivä", "päivää"), text, stop: false });
  }
  flush();
  rows.reverse();
  // the walk goes from the newest day back and stops at the first row that does not match
  const stop = rows.find((r) => r.text !== "täsmää");
  if (stop) stop.stop = true;
  return rows;
}

export function reconcileView(result: ReconcileResult): ReconcileView {
  const proved = result.status === "proved";
  const newest = result.intervals[result.intervals.length - 1];
  const reason = proved
    ? null
    : (reasonOf(result.reason) ?? (result.status === "differs" ? "ei täsmää" : (reasonOf(newest?.reason ?? null) ?? "ei täsmää")));
  return {
    proved,
    reason,
    rows: rowsOf(result),
    after: result.reason === "type_changed" && result.intervals.length ? REASON_TEXT.type_changed! : null,
  };
}

/** "1.10.2026–7.10.2026" */
export const periodText = (r: Pick<ReconcileRow, "from" | "to">): string => `${date(r.from)}–${date(r.to)}`;
