/**
 * Loans the household pays and never typed in: a debt series that still runs every month is proposed as a loan, for the
 * page that lets the household save it (`Loan`, loans.ts) or say "Ei laina".
 *
 * What is proposed: a series of `ctx.recurring` that is active, monthly, money out, in a loan's category (mortgage,
 * loans, student_loan), with three or more charges of at least 20 € and one payment reference, or any references when
 * the payee is a lender and no instalment service (a consumer lender's invoice brings a new one each month).
 * recurring.ts owns what a monthly series is and whether it still runs. A lender's payments of about one sum, about
 * one a calendar month, that it found no monthly series in (the day moves too much for a cadence) are one more series
 * (`lenderInstalments`).
 *
 * What a proposal knows is what the bank rows show: who is paid, how much, since when. The balance and the rate are
 * not on the rows, so a proposal has neither, and nothing here guesses them.
 *
 * The key of a proposal is the series id with its payment, `out:<account>:<payee>#<cents>` (`seriesId`, ADR 0009). It
 * is what `Loan.seriesKey` holds once the loan is saved, and `loan-proposal:<key>` is the subject of the mark that
 * says "Ei laina" (`notLoanMark`). The subject is the proposal's own: Laskut marks the same series as `series:<key>`,
 * and the marks table keeps one mark for a subject, so a shared subject would let Käytössä take "Ei laina" away. The
 * payment is in the key so that a second loan from the same lender gets a key of its own.
 *
 * A payment is read at the bank's amount (`billCents`), also in a member's own view, where the rows of a joint account
 * hold the viewer's part: a loan is typed with its whole payment, so a proposal tells the whole payment, and a key
 * saved in one view names the series in the other. The key holds the bank's amount there too, also where the series id
 * holds the part (one of a lender's several series): a key is the same in every view.
 */
import { billCents } from "./account-use.ts";
import { type AnalysisContext, type AnalysisTx, standingOf } from "./analysis/context.ts";
import { covers, seriesMarkSubject } from "./analysis/subscription-alerts.ts";
import { referenceOf } from "./card-channel.ts";
import { cancelledSubjects, isCancelled, isContract } from "./commitments.ts";
import { addMonths, daysBetween, monthIndex, monthOf } from "./dates.ts";
import { loansOf, typedBill } from "./loans.ts";
import { planAnswers } from "./plan-answer.ts";
import { lexiconCategory } from "./lexicon.ts";
import { cardIssuerName, fold } from "./merchant.ts";
import { parseSeriesId, type RecurringSeries, seriesId } from "./recurring.ts";
import { STEADY_BAND, steadyBy } from "./returns.ts";
import type { IsoDate, LoanKind, UserInputs, UserMark } from "./types.ts";
import { hasLoanText, isFinanceCompanyName, withoutSwedishTwin } from "./wording-lenders.ts";
import { CONSUMER_LENDER_WORDS, hasPayeeForm, INSTALMENT_SERVICE_WORDS, housingCharge, isCarFinanceText, isHousingCompanyName, isInsuranceText, isLeaseText, isLenderName, isLoanText, isNamedLaina, isRent } from "./wording.ts";

/** A debt series that looks like a loan nobody saved. */
export interface LoanProposal {
  /** What `Loan.seriesKey` takes when the household saves the loan. */
  key: string;
  /** The series in `ctx.recurring` the proposal was made from. Its id changes when the payee gets a second series; `key` holds. */
  seriesId: string;
  /** Who is paid, as the series names it. */
  payee: string;
  accountId: string;
  /** The usual payment, positive, as the bank charges it: whole, also where the rows are cut to a part. */
  paymentCents: number;
  /** Calendar months from the first payment seen to the last, both included. */
  months: number;
  firstDate: IsoDate;
  lastDate: IsoDate;
  /** The payments' category: mortgage, loans or student_loan. */
  category: string;
  /** A first choice for the form, from the category and the payee's words. The household decides. */
  kind: LoanKind;
  /** The payment reference the payments share, null when the rows carry none. */
  reference: string | null;
  /**
   * Whether the app can place the loan: the household said what it is (`LOAN_KIND_QUESTION`), the category says (mortgage,
   * student loan), the payee is a car financer, or a payment over `MORTGAGE_PAYMENT_CENTS` of a home owner (a housing
   * company charge, no rent). Otherwise `kind` is a guess and the front page asks "Mikä laina tämä on?" once.
   */
  placed: boolean;
  /**
   * An instalment plan of a payment service (Klarna and the like): the same sum in three or more months running (`planRun`).
   * Its balance is never assumed, so it is no debt in the totals, and the household is asked how many payments are left.
   */
  plan: boolean;
  /** What the household said of a plan's end (`PlanAnswer`), null while nothing is said. Always null for a loan that is no plan. */
  planAnswer: PlanAnswer | null;
}

/** The household's word on a plan's end: unknown, or the month of its last payment. */
type PlanAnswer = { known: false } | { known: true; endMonth: string };

/** What the household answered when asked what a loan is, with the loan kind each answer stands for. */
export const LOAN_KIND_ANSWERS = ["mortgage", "car", "student", "consumer", "other"] as const satisfies readonly LoanKind[];

/** The subject prefix of the answer: `question:loan-kind:<kind>:<series key>`, mark `in_use`. The latest answer for a series stands. */
const LOAN_KIND_QUESTION = "question:loan-kind:";

/** The answer's subject for a series key. */
export const loanKindSubject = (kind: (typeof LOAN_KIND_ANSWERS)[number], key: string): string => `${LOAN_KIND_QUESTION}${kind}:${key}`;

/** The kind and series key an answer's subject names, or null for any other subject and for a key no series has. The marks route asks it before it stores one. */
export function parseLoanKindSubject(subject: string): { kind: (typeof LOAN_KIND_ANSWERS)[number]; key: string } | null {
  if (!subject.startsWith(LOAN_KIND_QUESTION)) return null;
  const rest = subject.slice(LOAN_KIND_QUESTION.length);
  const kind = LOAN_KIND_ANSWERS.find((k) => rest.startsWith(`${k}:`));
  const key = kind ? rest.slice(kind.length + 1) : "";
  return kind && parseSeriesId(key)?.accountId ? { kind, key } : null;
}

/** A monthly instalment over this, paid by a home owner, is a mortgage. */
const MORTGAGE_PAYMENT_CENTS = 40000;

/** Under this a monthly charge is a fee or a small service, whatever its text says. */
const MIN_LOAN_PAYMENT_CENTS = 2000;
/** A loan's payments are told from a few separate invoices by this many charges. */
const MIN_LOAN_CHARGES = 3;

/** Interest alone is the cost of a card or an overdraft, and a collector's plan is paid to someone who lent nothing. */
const LOAN_CATEGORIES: ReadonlySet<string> = new Set(["mortgage", "loans", "student_loan"]);

const NOT_LOAN_SUBJECT = "loan-proposal:";

/**
 * The series key an "Ei laina" mark's subject names (`loan-proposal:<key>`), or null for any other subject and for a
 * key no series has. The marks route asks it before it stores such a subject.
 */
export function notLoanKey(subject: string): string | null {
  const key = subject.startsWith(NOT_LOAN_SUBJECT) ? subject.slice(NOT_LOAN_SUBJECT.length) : "";
  return parseSeriesId(key)?.accountId ? key : null;
}

/** The same payee: the same name, or two spellings of one card issuer ("Morrow Bank Asa", "Morrow Bank"), which the upgrade merged into one. */
const sameName = (a: string, b: string): boolean => a === b || (cardIssuerName(fold(a)) !== null && cardIssuerName(fold(a)) === cardIssuerName(fold(b)));

/**
 * A key with no amount names every series of its payee. Where another saved loan's key holds the same name in another
 * spelling, each of the two keeps to its own spelling: the one name is not theirs both.
 */
const spelledAlone = (key: string, others: readonly string[]): boolean =>
  parseSeriesId(key)?.product === null && others.some((other) => other !== key && sameSeriesKey(other, key));

/**
 * Whether two series keys are one series, whatever spelling of an issuer's name each was written with. `others` are
 * the other saved loans' keys: with one of them in the same name, a key with no amount matches its own spelling only.
 */
export function sameSeriesKey(a: string, b: string, others: readonly string[] = []): boolean {
  const [x, y] = [parseSeriesId(a), parseSeriesId(b)];
  if (a === b) return true;
  if (x === null || y === null || x.direction !== y.direction || x.accountId !== y.accountId || x.product !== y.product) return false;
  return spelledAlone(a, others) ? x.merchant === y.merchant : sameName(x.merchant, y.merchant);
}

/**
 * Whether a stored key (a loan's `seriesKey`, or the key of an "Ei laina" mark) names this series: the same payee,
 * account and direction, and a payment the series has charged. `covers` owns how far apart two payments of one
 * contract can be, and reads the key as a mark on the series. Every charge is asked, so a key holds after the rate has
 * moved the payment many times. A key without a payment names every series the payee has on the account.
 */
function names(key: string, s: RecurringSeries, amounts: readonly number[], others: readonly string[] = []): boolean {
  const named = parseSeriesId(key);
  const own = parseSeriesId(s.id);
  if (!named || !own || named.direction !== own.direction || named.accountId !== own.accountId || !(spelledAlone(key, others) ? named.merchant === own.merchant : sameName(named.merchant, own.merchant))) return false;
  // a key written under an old spelling of an issuer's name holds for the series under the one name; the key itself is not changed
  const subject = seriesMarkSubject({ id: seriesId({ ...named, merchant: own.merchant }), kind: "bill", typicalAmountCents: 0 });
  if (typeof named.product !== "number") return named.product === null;
  return amounts.some((cents) => covers(subject, { id: s.id, merchant: s.merchant, kind: "subscription", typicalAmountCents: cents, priceChange: null }));
}

/**
 * The series' usual payment as the bank charges it. On rows cut to the viewer's part the series knows the part alone,
 * and the answer is the bank's amount of the charge nearest to the usual one.
 */
function wholePayment(typicalCents: number, charges: readonly AnalysisTx[]): number {
  if (charges.every((t) => t.wholeCents === undefined)) return typicalCents;
  const off = (t: AnalysisTx) => Math.abs(-t.amountCents - typicalCents);
  return -billCents(charges.reduce((nearest, t) => (off(t) < off(nearest) ? t : nearest)));
}

const CONSUMER_LENDER = new RegExp(String.raw`(?<![A-Z0-9])(?:${CONSUMER_LENDER_WORDS})(?![A-Z0-9])`);

/** A payment service whose invoices are separate purchases, unlike a bank's: Resurs Bank is a lender too and is not one. */
const INSTALMENT_SERVICE = new RegExp(INSTALMENT_SERVICE_WORDS);

/** Payments of one sum, in cents: instalments of one plan differ by the rounding of the last cent at most. */
const PLAN_BAND_CENTS = 5;
/** Plan payments in a row before a plan is told: two could be two purchases. */
const MIN_PLAN_MONTHS = 3;

/**
 * The months of the latest run of an instalment service's payments of one sum (within `PLAN_BAND_CENTS` of the latest
 * payment), a month after the month before with no gap: the rows of that run, oldest first. Fewer than
 * `MIN_PLAN_MONTHS` months is no plan: one-off or varying payments (pay later of single purchases) are none.
 */
function planRun(rows: readonly AnalysisTx[]): AnalysisTx[] {
  const sorted = [...rows].sort((a, b) => a.day - b.day);
  const latest = sorted.at(-1);
  if (!latest) return [];
  const sum = (t: AnalysisTx) => -billCents(t);
  const byMonth = new Map<string, AnalysisTx>();
  for (const t of sorted) if (Math.abs(sum(t) - sum(latest)) <= PLAN_BAND_CENTS) byMonth.set(monthOf(t.bookingDate), t);
  const run: AnalysisTx[] = [];
  for (let month = monthOf(latest.bookingDate), t = byMonth.get(month); t; month = addMonths(month, -1), t = byMonth.get(month)) run.unshift(t);
  return run.length >= MIN_PLAN_MONTHS ? run : [];
}

/** A row of an instalment service (Klarna and the like), also where its category says shopping. */
const ofService = (t: AnalysisTx): boolean => INSTALMENT_SERVICE.test(fold(`${t.merchant} ${t.counterparty ?? ""}`));

/**
 * A payee the app knows as a lender: an instalment service or a consumer lender of the word lists, a finance company
 * by the end of its name, or a company the lexicon files as credit. Its steady payment is a loan; whose it is, only
 * the household says.
 */
function isKnownLender(payee: string, text: string): boolean {
  return isLenderName(text) || CONSUMER_LENDER.test(text) || isFinanceCompanyName(payee) || lexiconCategory({ merchant: payee, counterparty: payee, description: null })?.category === "loans";
}

/** A lender's payment run counts as monthly when most of the months it spans had one: a month may go by when the next one pays twice. */
const LENDER_MONTH_SHARE = 0.75;
/** A run with no payment for this many days has stopped. A due day moved to the month's end and back stays inside. */
const LENDER_ACTIVE_DAYS = 45;

/**
 * Payments to a lender that recurring.ts found no monthly series in: money out in a loan's category, on one account
 * to one payee, of about one sum (`steadyBy`) in three or more months, in most of the months they span and seldom twice
 * in a month. The day of the month moves too much for a cadence (paid on the 2nd one month and the 27th the next),
 * but a loan it is, paid each month. Each run is told as a monthly bill whose cost is its usual payment, so the
 * proposals, the fixed costs and the debts read it as they read any monthly series. Rows of a monthly series are
 * never in one, so nothing counts twice; the rows of an everyday habit series may be, and a habit is no fixed cost.
 * `recurring` and `today` read the series as they were on an earlier day (`recurringAt`).
 */
export function lenderInstalments(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, recurring: readonly RecurringSeries[] = ctx.recurring, today: IsoDate = ctx.today): RecurringSeries[] {
  const held = new Set(recurring.filter((s) => s.kind !== "habit").flatMap((s) => s.transactionIds));
  const groups = new Map<string, AnalysisTx[]>();
  const plans = new Map<string, AnalysisTx[]>();
  for (const t of standingOf(ctx).txs) {
    if (t.bookingDate > today || t.amountCents >= 0 || t.isTransfer || held.has(t.id) || -billCents(t) < MIN_LOAN_PAYMENT_CENTS) continue;
    // an instalment service's payments are read as plans below, in any category
    if (ofService(t)) {
      const key = seriesId({ direction: "out", accountId: t.accountId, merchant: t.merchant, product: null });
      plans.set(key, [...(plans.get(key) ?? []), t]);
      continue;
    }
    if (!LOAN_CATEGORIES.has(t.category)) continue;
    const key = seriesId({ direction: "out", accountId: t.accountId, merchant: t.merchant, product: null });
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  const out: RecurringSeries[] = [];
  const asSeries = (key: string, steady: readonly AnalysisTx[], typical: number, span: number, months: number) => {
    const first = steady[0]!;
    const last = steady.at(-1)!;
    const cents = -typical;
    out.push({
      id: seriesId({ ...parseSeriesId(key)!, product: cents }),
      merchant: last.merchant,
      category: last.category,
      kind: "bill",
      cadence: "monthly",
      intervalDays: 30,
      occurrences: steady.length,
      firstDate: first.bookingDate,
      lastDate: last.bookingDate,
      nextDate: null,
      typicalAmountCents: cents,
      lastAmountCents: -last.amountCents,
      monthlyCents: cents,
      yearlyCents: cents * 12,
      perMonth: 1,
      monthsActive: span,
      active: daysBetween(last.bookingDate, today) <= LENDER_ACTIVE_DAYS,
      overdue: false,
      review: false,
      confidence: Math.round((months / span) * 100) / 100,
      priceChange: null,
      transactionIds: steady.map((t) => t.id),
    });
  };
  for (const [key, rows] of plans) {
    const run = planRun(rows);
    if (run.length) asSeries(key, run, run.at(-1)!.amountCents, run.length, run.length);
  }
  for (const [key, rows] of groups) {
    const typical = steadyBy(rows, () => "run").get("run");
    if (typical === undefined) continue;
    const steady = rows.filter((t) => Math.abs(t.amountCents - typical) <= Math.abs(typical) * STEADY_BAND).sort((a, b) => a.day - b.day);
    const first = steady[0]!;
    const last = steady.at(-1)!;
    const span = monthIndex(monthOf(last.bookingDate)) - monthIndex(monthOf(first.bookingDate)) + 1;
    const months = new Set(steady.map((t) => monthOf(t.bookingDate))).size;
    if (months < MIN_LOAN_CHARGES || months < LENDER_MONTH_SHARE * span || steady.length > span + 1) continue;
    asSeries(key, steady, typical, span, months);
  }
  return out;
}

/** The kind the category and the words place, and whether they do. A car financer is a lender too: the car comes first. */
function kindOf(category: string, text: string): { kind: LoanKind; placed: boolean } {
  if (category === "mortgage") return { kind: "mortgage", placed: true };
  if (category === "student_loan") return { kind: "student", placed: true };
  if (isCarFinanceText(text)) return { kind: "car", placed: true };
  return { kind: isLenderName(text) ? "instalment" : "consumer", placed: false };
}

/**
 * The household pays a housing company's charge and no rent: the payee of a big instalment is then the lender of its
 * home. Read as Asuminen reads the charges (`buildHousing`): the words of the latest payment of an active contract.
 */
function ownsHome(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing">): boolean {
  const byId = new Map(standingOf(ctx).txs.map((t) => [t.id, t]));
  let charged = false;
  for (const s of ctx.recurring) {
    if (s.category !== "housing" || !isContract(s)) continue;
    const last = s.transactionIds.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t).sort((a, b) => a.day - b.day).at(-1);
    const kind = housingCharge(fold(s.merchant), fold(`${last?.counterparty ?? ""} ${last?.description ?? ""}`), false)?.kind;
    if (kind === "rent" || kind === "occupancy") return false;
    if (kind === "financing" || kind === "capital" || kind === "maintenance" || kind === "charge") charged = true;
  }
  return charged;
}

/** What the household answered of a series, asked of the series and its charges as `takenSeries` is: the latest answer whose key names it. */
function answeredKind(inputs: UserInputs): (s: RecurringSeries, charges: Charges) => LoanKind | null {
  const answers = inputs.marks.flatMap((m) => {
    const a = parseLoanKindSubject(m.subject);
    return a ? [{ ...a, at: m.markedAt }] : [];
  });
  if (!answers.length) return () => null;
  const loanKeys = loansOf(inputs).flatMap((loan) => loan.seriesKey ?? []);
  return (s, charges) => {
    const amounts = amountsOf(s, charges);
    return answers.filter((a) => names(a.key, s, amounts, loanKeys)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]?.kind ?? null;
  };
}

/** What the household said of a plan's end, asked of the series and its charges as `answeredKind` is: the latest answer whose key names it. */
function answeredPlan(inputs: UserInputs): (s: RecurringSeries, charges: Charges) => PlanAnswer | null {
  const answers = [...planAnswers(inputs)];
  if (!answers.length) return () => null;
  const loanKeys = loansOf(inputs).flatMap((loan) => loan.seriesKey ?? []);
  return (s, charges) => {
    const amounts = amountsOf(s, charges);
    const found = answers.find(([key]) => names(key, s, amounts, loanKeys));
    return found ? (found[1] === null ? { known: false } : { known: true, endMonth: found[1] }) : null;
  };
}

/**
 * Whether a series is spoken for, asked of the series and its charges: a saved loan is linked to it (`Loan.seriesKey`),
 * or the household said "Ei laina" of it. A key holds the payment as it was in the view that saved it, so the part
 * and the bank's amount of every charge are asked. The proposals and the home loans of the first page read the one
 * answer (`housing.ts`).
 */
export function takenSeries(inputs: UserInputs): (s: RecurringSeries, charges: Charges) => boolean {
  const keys = [...loansOf(inputs).map((loan) => loan.seriesKey), ...inputs.marks.filter((m) => m.mark === "dismissed").map((m) => notLoanKey(m.subject))].filter((key): key is string => !!key);
  const loanKeys = loansOf(inputs).flatMap((loan) => loan.seriesKey ?? []);
  return (s, charges) => {
    if (!keys.length) return false;
    const amounts = amountsOf(s, charges);
    return keys.some((key) => names(key, s, amounts, loanKeys));
  };
}

type Charges = readonly Pick<AnalysisTx, "amountCents" | "wholeCents">[];

/** The payments a key is asked against: the usual one and every charge, as the bank charged it and as the view holds it. */
const amountsOf = (s: RecurringSeries, charges: Charges): number[] => [s.typicalAmountCents, ...charges.flatMap((t) => [-t.amountCents, -billCents(t)])];

/**
 * Whether a payment typed for a loan that no series is linked to fits a series: asked as a stored key is (`names`), of
 * the series' own payee and account with the typed payment as its price, so `covers` owns how far apart the two may be.
 * The payment is the bank's, whole, also in a view that holds a part of the series.
 */
export function fitsPayment(paymentCents: number, s: RecurringSeries, charges: Charges): boolean {
  const own = parseSeriesId(s.id);
  return own !== null && names(seriesId({ ...own, product: paymentCents }), s, amountsOf(s, charges));
}

/** The mark that says a proposal is no loan: the series stays out of `loanProposals` until the mark is taken away. */
export function notLoanMark(proposal: Pick<LoanProposal, "key">): Pick<UserMark, "subject" | "mark"> {
  return { subject: NOT_LOAN_SUBJECT + proposal.key, mark: "dismissed" };
}

/**
 * The loans to propose today, the largest payment first. A series the household marked "Ei laina" or cancelled, and one
 * a saved loan is linked to, is left out.
 */
export function loanProposals(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "today">, inputs: UserInputs): LoanProposal[] {
  const monthly = ctx.recurring.filter((s) => s.active && s.cadence === "monthly" && (s.kind === "bill" || s.kind === "subscription") && (LOAN_CATEGORIES.has(s.category) || INSTALMENT_SERVICE.test(fold(s.merchant))));
  const candidates = [...monthly, ...lenderInstalments(ctx).filter((s) => s.active)];
  if (!candidates.length) return [];
  const byId = new Map(standingOf(ctx).txs.map((t) => [t.id, t]));
  const taken = takenSeries(inputs);
  // a saved loan with a typed payment and no series linked takes one series it fits, as in Asuminen (housing.ts)
  const unlinked = loansOf(inputs).flatMap((loan) => (loan.seriesKey ? [] : [typedBill(loan, ctx.today)].filter((c): c is number => c !== null)));
  const cancelled = cancelledSubjects(inputs);
  const said = answeredKind(inputs);
  const planned = answeredPlan(inputs);
  const owner = ownsHome(ctx);

  const out: LoanProposal[] = [];
  for (const s of candidates) {
    const parts = parseSeriesId(s.id);
    if (!parts || parts.direction !== "out" || parts.product === "habit") continue;
    const charges = s.transactionIds.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t && -billCents(t) >= MIN_LOAN_PAYMENT_CENTS);
    if (charges.length < MIN_LOAN_CHARGES) continue;
    const paymentCents = wholePayment(s.typicalAmountCents, charges);
    if (paymentCents < MIN_LOAN_PAYMENT_CENTS) continue;
    charges.sort((a, b) => a.day - b.day);
    const latest = charges.slice(-MIN_LOAN_CHARGES);
    const last = latest.at(-1)!;
    const payee = fold(last.counterparty ?? s.merchant);
    const text = fold([s.merchant, last.counterparty, last.description].filter(Boolean).join(" "));
    // separate invoices each bring their own reference and a contract keeps one, but a lender's monthly invoice names
    // the month; an instalment service's invoices are separate purchases
    const references = new Set(latest.map(referenceOf).filter((r) => r !== ""));
    // an instalment service is a plan only for the same sum in three months running; its other payments are purchases
    const plan = INSTALMENT_SERVICE.test(text);
    if (plan && planRun(charges).length === 0) continue;
    const invoicedLoan = (isKnownLender(payee, text) && !INSTALMENT_SERVICE.test(text)) || hasLoanText(payee);
    if (references.size > 1 && !invoicedLoan && !plan) continue;
    // an insurer, a landlord, a lessor and a housing company charging for its own loan are paid no loan of the household's
    if (isInsuranceText(text) || isRent(text) || isLeaseText(text) || isHousingCompanyName(payee)) continue;
    // Laina is a first name too: a person so named is a lender only when the payment text names the loan
    if (isNamedLaina(payee) && !hasPayeeForm(payee) && !isLoanText(fold(last.description ?? ""))) continue;
    if (isCancelled(cancelled, s)) continue;
    if (taken(s, charges)) continue;
    const fits = unlinked.findIndex((bill) => fitsPayment(bill, s, charges));
    if (fits >= 0) {
      unlinked.splice(fits, 1);
      continue;
    }
    // one of a lender's several series has its payment in the series id, and on rows cut to a part that is the part
    const cut = charges.some((t) => t.wholeCents !== undefined);
    const told = said(s, charges);
    const placing = kindOf(s.category, text);
    // a known lender's payment of about one sum month after month is a loan with no question: the kind stays a guess for the form
    const lender = steadyBy(charges, () => "series").size > 0 && isKnownLender(payee, text);
    const home = !placing.placed && owner && paymentCents > MORTGAGE_PAYMENT_CENTS;
    out.push({
      key: seriesId({ ...parts, product: cut ? paymentCents : (parts.product ?? paymentCents) }),
      seriesId: s.id,
      payee: withoutSwedishTwin(s.merchant),
      accountId: parts.accountId,
      paymentCents,
      months: s.monthsActive,
      firstDate: s.firstDate,
      lastDate: s.lastDate,
      category: s.category,
      kind: told ?? (home ? "mortgage" : placing.kind),
      placed: told !== null || home || placing.placed || lender || plan,
      plan,
      planAnswer: plan ? planned(s, charges) : null,
      reference: references.size === 1 ? [...references][0]! : null,
    });
  }
  return out.sort((a, b) => b.paymentCents - a.paymentCents || (a.key < b.key ? -1 : 1));
}
