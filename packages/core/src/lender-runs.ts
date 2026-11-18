/**
 * A lender's rows that the monthly series do not tell, for the loan proposals (`loan-detect.ts`): the plans of an
 * instalment service, one per sum, and the payments to a lender too few or too small for a series, with the credit the
 * lender paid out (`credit_draw`) and what of it is owed at least.
 */
import { billCents } from "./account-use.ts";
import type { AnalysisTx } from "./analysis/context.ts";
import { addMonths, daysBetween, monthIndex, monthOf } from "./dates.ts";
import { lexiconCategory } from "./lexicon.ts";
import { fold } from "./merchant.ts";
import type { RecurringSeries } from "./recurring.ts";
import { seriesId } from "./series-id.ts";
import type { IsoDate, LoanKind } from "./types.ts";
import { hasLoanText, isFinanceCompanyName } from "./wording-lenders.ts";
import { loanKindOfType } from "./wording-loan-pages.ts";
import { CONSUMER_LENDER_WORDS, INSTALMENT_SERVICE_WORDS, isInstalmentPlanText, isLenderName } from "./wording.ts";

/** Under this a monthly charge is a fee or a small service, whatever its text says, and a credit paid in a refund. */
export const MIN_LOAN_PAYMENT_CENTS = 2000;
/** Interest alone is the cost of a card or an overdraft, and a collector's plan is paid to someone who lent nothing. */
export const LOAN_CATEGORIES: ReadonlySet<string> = new Set(["mortgage", "loans", "student_loan"]);
/** A run with no payment for this many days has stopped. A due day moved to the month's end and back stays inside. */
export const LENDER_ACTIVE_DAYS = 45;

const CONSUMER_LENDER = new RegExp(String.raw`(?<![A-Z0-9])(?:${CONSUMER_LENDER_WORDS})(?![A-Z0-9])`);

/** A payment service whose invoices are separate purchases, unlike a bank's: Resurs Bank is a lender too and is not one. */
export const INSTALMENT_SERVICE = new RegExp(INSTALMENT_SERVICE_WORDS);

/** A row of an instalment service (Klarna and the like), also where its category says shopping. */
export const ofService = (t: AnalysisTx): boolean => INSTALMENT_SERVICE.test(fold(`${t.merchant} ${t.counterparty ?? ""}`));

/**
 * A payee the app knows as a lender: an instalment service or a consumer lender of the word lists, a finance company
 * by the end of its name, or a company the lexicon files as credit. Its steady payment is a loan; whose it is, only
 * the household says.
 */
export function isKnownLender(payee: string, text: string): boolean {
  return isLenderName(text) || CONSUMER_LENDER.test(text) || isFinanceCompanyName(payee) || lexiconCategory({ merchant: payee, counterparty: payee, description: null })?.category === "loans";
}

/** A payment to a known lender, or to a payee named for a loan, and no instalment service: a loan's at any sum. */
export const isLenderPayment = (payee: string, text: string): boolean => (isKnownLender(payee, text) || hasLoanText(payee)) && !INSTALMENT_SERVICE.test(text);

/** Payments of one sum, in cents: instalments of one plan differ by the rounding of the last cent at most. */
const PLAN_BAND_CENTS = 5;
/** Plan payments in a row before a plan is told: two could be two purchases. */
const MIN_PLAN_MONTHS = 3;
/** Plan payments in a row before a plan is told where each row says it is one: two instalments are consumer credit. */
const MIN_TOLD_PLAN_MONTHS = 2;

/** A row that says it pays a purchase in parts, filed as a loan for it (categorize.ts). */
const toldPlan = (t: AnalysisTx): boolean => t.category === "loans" && isInstalmentPlanText(fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`));

/**
 * The plans in an instalment service's payments: for each sum (within `PLAN_BAND_CENTS` of the latest payment of it),
 * the latest run of months, a month after the month before with no gap, as its rows oldest first. Two plans of other
 * sums run side by side. A run of fewer than `MIN_PLAN_MONTHS` months is no plan: one-off or varying payments (pay later
 * of single purchases) are none. A run of `MIN_TOLD_PLAN_MONTHS` whose rows each say they pay in parts (`toldPlan`) is one.
 */
export function planRuns(rows: readonly AnalysisTx[]): AnalysisTx[][] {
  const sum = (t: AnalysisTx) => -billCents(t);
  const sorted = [...rows].sort((a, b) => a.day - b.day);
  const banded = new Set<AnalysisTx>();
  const runs: AnalysisTx[][] = [];
  // the newest payment of a sum leads its band; a payment in a band already read leads none
  for (const lead of [...sorted].reverse()) {
    if (banded.has(lead)) continue;
    const byMonth = new Map<string, AnalysisTx>();
    for (const t of sorted) {
      if (Math.abs(sum(t) - sum(lead)) > PLAN_BAND_CENTS) continue;
      banded.add(t);
      byMonth.set(monthOf(t.bookingDate), t);
    }
    const run: AnalysisTx[] = [];
    for (let month = monthOf(lead.bookingDate), t = byMonth.get(month); t; month = addMonths(month, -1), t = byMonth.get(month)) run.unshift(t);
    if (run.length >= MIN_PLAN_MONTHS || (run.length >= MIN_TOLD_PLAN_MONTHS && run.every(toldPlan))) runs.push(run);
  }
  return runs;
}

/** The credit lenders paid in: money in filed as a credit draw, of a loan's size, by today. */
export const creditDraws = (txs: readonly AnalysisTx[], today: IsoDate): AnalysisTx[] =>
  txs.filter((t) => t.category === "credit_draw" && billCents(t) >= MIN_LOAN_PAYMENT_CENTS && !t.isTransfer && t.bookingDate <= today);

/** The words of a name that are no word of a loan or its type ("Esimerkki Rahoitus Joustoluotot" is "ESIMERKKI RAHOITUS"). */
const nameWords = (name: string): string[] => fold(name).split(/\s+/).filter((w) => w && !hasLoanText(w) && loanKindOfType(w) === null);

/**
 * Whether a draw's payer is the payee of a loan's payments. A lender names its credit by the product ("Esimerkki
 * Rahoitus Joustoluotot") and is paid under its company's name ("Esimerkki Rahoitus Oy"), so one name, without its
 * words of a loan, begins the other with two words or more, or the two are the same.
 */
function drawnBy(drawName: string, payee: string): boolean {
  const [a, b] = [nameWords(drawName), nameWords(payee)];
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length > 0 && (short.length >= 2 || short.length === long.length) && short.every((w, i) => long[i] === w);
}

/** The one kind the draws of a payee name ("Joustoluotot" a credit line), or null for none and for two. */
export function drawnKind(draws: readonly AnalysisTx[], payee: string): LoanKind | null {
  const kinds = new Set(draws.filter((d) => drawnBy(d.merchant, payee)).flatMap((d) => loanKindOfType(fold(`${d.merchant} ${d.counterparty ?? ""} ${d.description ?? ""}`)) ?? []));
  return kinds.size === 1 ? [...kinds][0]! : null;
}

/** What a payee's credits leave owed (`owedAtLeast`), and the day its payments last brought that to zero. */
interface DrawLedger {
  /** The credits paid in since `repaidOn`, less the payments since the first of them; null with no credit since. */
  owed: { cents: number; since: IsoDate } | null;
  /** The latest day a payment paid back every credit before it, or null where none was. */
  repaidOn: IsoDate | null;
}

/**
 * The credits a payee paid in and its payments, by day (a credit before a payment of the same day), with the payments
 * matched to the payee as the credits are (`drawnBy`): the company's name and its product's both. A payment before any
 * credit, or past a credit paid back in full, pays nothing off. Where the payments brought what was owed to zero, the
 * credits and payments before that day are done: a credit paid back in full hides no later loan.
 */
function drawLedger(txs: readonly AnalysisTx[], draws: readonly AnalysisTx[], payee: string, today: IsoDate): DrawLedger {
  const own = draws.filter((d) => drawnBy(d.merchant, payee));
  const paid = txs.filter((t) => t.amountCents < 0 && !t.isTransfer && t.bookingDate <= today && drawnBy(t.merchant, payee));
  const events = [...own.map((t) => ({ t, drawn: true })), ...paid.map((t) => ({ t, drawn: false }))].sort((a, b) => a.t.day - b.t.day || Number(b.drawn) - Number(a.drawn));
  let owed: DrawLedger["owed"] = null;
  let repaidOn: IsoDate | null = null;
  for (const { t, drawn } of events) {
    if (drawn) owed = { cents: (owed?.cents ?? 0) + billCents(t), since: owed?.since ?? t.bookingDate };
    else if (owed) {
      const left: number = owed.cents + billCents(t);
      if (left > 0) owed = { cents: left, since: owed.since };
      else {
        owed = null;
        repaidOn = t.bookingDate;
      }
    }
  }
  return { owed, repaidOn };
}

/**
 * What a payee is owed at least, from the rows: the credits it paid in since its payments last paid back every credit
 * before, less the payments since the first of them. Interest and fees are not on the rows, so the debt is this or
 * more. Null for a payee with no such credit: none paid in, or every one paid back.
 */
export const owedAtLeast = (txs: readonly AnalysisTx[], draws: readonly AnalysisTx[], payee: string, today: IsoDate): { cents: number; since: IsoDate } | null => drawLedger(txs, draws, payee, today).owed;

/** A lender's payments no monthly series tells, as a series of no monthly figure, with what the payee is owed at least. */
interface FewPayments {
  series: RecurringSeries;
  owedAtLeastCents: number | null;
}

/**
 * The payments to a known lender (no instalment service) that none of `series` holds, by payee and account: two or
 * more, or one or more after a credit the payee paid in that is not paid back yet, the latest in the last
 * `LENDER_ACTIVE_DAYS`. Only the payments after a credit paid back in full count (`drawLedger`). Any sum and any number
 * of months: a short or small loan is a loan too. A payee with a running series has its loan told there. The series has
 * no monthly figure, since the rows show no plan; its id names the account and the sum of the latest payment.
 */
export function fewPayments(txs: readonly AnalysisTx[], series: readonly RecurringSeries[], today: IsoDate): FewPayments[] {
  const held = new Set(series.flatMap((s) => s.transactionIds));
  const running = new Set(series.filter((s) => s.active).map((s) => fold(s.merchant)));
  const byPayee = new Map<string, AnalysisTx[]>();
  for (const t of txs) {
    if (t.amountCents >= 0 || t.isTransfer || t.bookingDate > today || held.has(t.id) || !LOAN_CATEGORIES.has(t.category) || running.has(fold(t.merchant))) continue;
    const key = `${t.accountId}\u0000${fold(t.merchant)}`;
    byPayee.set(key, [...(byPayee.get(key) ?? []), t]);
  }
  const draws = creditDraws(txs, today);
  const out: FewPayments[] = [];
  for (const payments of byPayee.values()) {
    payments.sort((a, b) => a.day - b.day);
    const last = payments.at(-1)!;
    const payee = fold(last.merchant);
    const text = fold([last.merchant, last.counterparty, last.description].filter(Boolean).join(" "));
    if (!isLenderPayment(payee, text) || daysBetween(last.bookingDate, today) > LENDER_ACTIVE_DAYS) continue;
    const { owed, repaidOn } = drawLedger(txs, draws, last.merchant, today);
    // a credit paid back in full is no debt, however many payments it took; the payments after it may be a new loan's
    const rows = repaidOn === null ? payments : payments.filter((t) => t.bookingDate > repaidOn);
    const first = rows[0];
    if (!first || (owed === null ? rows.length < 2 : last.bookingDate < owed.since)) continue;
    const cents = -billCents(last);
    out.push({
      series: {
        id: seriesId({ direction: "out", accountId: last.accountId, merchant: last.merchant, product: cents }),
        merchant: last.merchant,
        category: last.category,
        kind: "bill",
        cadence: null,
        intervalDays: 0,
        occurrences: rows.length,
        firstDate: first.bookingDate,
        lastDate: last.bookingDate,
        nextDate: null,
        typicalAmountCents: cents,
        lastAmountCents: cents,
        monthlyCents: 0,
        yearlyCents: 0,
        perMonth: 0,
        monthsActive: monthIndex(monthOf(last.bookingDate)) - monthIndex(monthOf(first.bookingDate)) + 1,
        active: true,
        overdue: false,
        review: false,
        confidence: 0,
        priceChange: null,
        transactionIds: rows.map((t) => t.id),
      },
      owedAtLeastCents: owed?.cents ?? null,
    });
  }
  return out;
}
