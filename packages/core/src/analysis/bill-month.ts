/**
 * Decision: which bill of the month to chase now, and how much of the month's bills is still to leave.
 *
 * The month board of Laskut (RES1 idea 3, PD-laskut). Every subscription and bill of the month is in one of three
 * states: paid (a charge of the series, or a payment elsewhere that settled it, is booked in the month), missing (the
 * series is overdue: its next date passed more than the grace `recurring.ts` allows with no charge), or coming (a
 * projected date of the month not yet charged). A missed bill is never hidden: in the running month it stays on the
 * board whatever month its date was in, until a charge comes or the series ends. What is a bill is the forecast's own
 * definition (`isBillSeries`), so savings plans and pay are not; a series marked as cancelled is out, as in every other
 * total (`isCancelled`), and so is an instalment plan whose answered last month has passed (`cancelledSubjects` with the day).
 */
import { fixedMonthlyCents, isBillSeries, isCancelled } from "../commitments.ts";
import { addMonths, dateIn, monthEnd, monthOf } from "../dates.ts";
import { parseSeriesId, projectDates } from "../recurring.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext } from "./context.ts";

export type BillState = "missing" | "coming" | "paid";

export interface BillBoardRow {
  seriesId: string;
  merchant: string;
  category: string;
  state: BillState;
  /** Paid: the booking day. Missing and coming: the day the series expects the charge (for a missing bill it can be in an earlier month). */
  date: IsoDate;
  /** Positive. Paid: what the row took. Missing and coming: the series' typical charge. */
  cents: number;
  /** A coming or missing charge of a bill whose sum varies: the figure is the typical one, shown with "≈". */
  estimate: boolean;
  /** Paid only: the row that paid it (for a payment elsewhere, that payment), when the view holds it. */
  txId?: string;
  /** Paid only: the typical charge, when the row took another sum. */
  usualCents?: number;
  /** The series is charged to a credit card: it leaves no account on its day, it is in the card's bill. */
  onCard?: true;
  /** Paid by a payment from another account or under another payee (`settled`). */
  settledElsewhere?: true;
}

export interface BillBoard {
  /** `YYYY-MM`. */
  month: string;
  from: IsoDate;
  to: IsoDate;
  /** Missing first (oldest date first), then coming by date, then paid by date; within a day the larger first. */
  rows: BillBoardRow[];
  /** Each positive; `dueCents` is the three added up, the datum of the panel. */
  totals: { paidCents: number; comingCents: number; missingCents: number; dueCents: number };
  /** The fixed costs of a month as the series run today (`fixedMonthlyCents`), beside the month's own bills. */
  fixedMonthlyCents: number;
  /** The months the board can be moved to: twelve back, one ahead. */
  earliest: string;
  latest: string;
}

const MONTHS_BACK = 12;
const ORDER: Record<BillState, number> = { missing: 0, coming: 1, paid: 2 };

/** The month of the board, clamped to the months it can show. */
export function billMonthOf(today: IsoDate, asked: string | undefined): string {
  const now = monthOf(today);
  const earliest = addMonths(now, -MONTHS_BACK);
  const latest = addMonths(now, 1);
  if (!asked || !/^\d{4}-\d{2}$/u.test(asked)) return now;
  return asked < earliest ? earliest : asked > latest ? latest : asked;
}

export function billMonth(ctx: AnalysisContext, month: string, cancelled: ReadonlySet<string>): BillBoard {
  const now = monthOf(ctx.today);
  const from = dateIn(month, 1);
  const to = monthEnd(month);
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const rows: BillBoardRow[] = [];
  for (const s of ctx.recurring) {
    if (!isBillSeries(s) || isCancelled(cancelled, s)) continue;
    const base = { seriesId: s.id, merchant: s.merchant, category: s.category, ...(cards.has(parseSeriesId(s.id)?.accountId ?? "") ? { onCard: true as const } : {}) };
    for (const id of s.transactionIds) {
      const t = byId.get(id);
      if (!t || t.bookingDate < from || t.bookingDate > to || t.amountCents >= 0) continue;
      const cents = -t.amountCents;
      rows.push({ ...base, state: "paid", date: t.bookingDate, cents, estimate: false, txId: t.id, ...(cents !== s.typicalAmountCents ? { usualCents: s.typicalAmountCents } : {}) });
    }
    for (const o of s.settled ?? []) {
      if (o.paidOn < from || o.paidOn > to) continue;
      const t = byId.get(o.id);
      rows.push({ ...base, state: "paid", date: o.paidOn, cents: t ? Math.abs(t.amountCents) : s.typicalAmountCents, estimate: !t, ...(t ? { txId: t.id } : {}), settledElsewhere: true });
    }
    if (!s.active || month < now) continue;
    const estimate = s.kind === "bill";
    if (s.overdue && s.nextDate) {
      // the running month carries every missed bill; a later month does not repeat it
      if (month === now && s.nextDate <= to) rows.push({ ...base, state: "missing", date: s.nextDate, cents: s.typicalAmountCents, estimate });
      continue;
    }
    for (const d of projectDates(s, to)) if (d >= from || month === now) rows.push({ ...base, state: "coming", date: d, cents: s.typicalAmountCents, estimate });
  }
  rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.date.localeCompare(b.date) || b.cents - a.cents);
  const sum = (state: BillState) => rows.filter((r) => r.state === state).reduce((n, r) => n + r.cents, 0);
  const totals = { paidCents: sum("paid"), comingCents: sum("coming"), missingCents: sum("missing"), dueCents: 0 };
  totals.dueCents = totals.paidCents + totals.comingCents + totals.missingCents;
  return { month, from, to, rows, totals, fixedMonthlyCents: fixedMonthlyCents(ctx.recurring, cancelled), earliest: addMonths(now, -MONTHS_BACK), latest: addMonths(now, 1) };
}
