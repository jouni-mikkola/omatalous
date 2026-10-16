/**
 * Loans the household pays and never typed in: a debt series that still runs every month is proposed as a loan, for the
 * page that lets the household save it (`Loan`, loans.ts) or say "Ei laina".
 *
 * What is proposed: a series of `ctx.recurring` that is active, monthly, money out, in a loan's category (mortgage,
 * loans, student_loan), with three or more charges of at least 20 € and one payment reference. recurring.ts owns what
 * a monthly series is and whether it still runs; nothing here measures days again.
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
import { cancelledSubjects, isCancelled } from "./commitments.ts";
import { loansOf } from "./loans.ts";
import { cardIssuerName, fold } from "./merchant.ts";
import { parseSeriesId, type RecurringSeries, seriesId } from "./recurring.ts";
import type { IsoDate, LoanKind, UserInputs, UserMark } from "./types.ts";
import { hasPayeeForm, isCarFinanceText, isHousingCompanyName, isInsuranceText, isLeaseText, isLenderName, isLoanText, isNamedLaina, isRent } from "./wording.ts";

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
}

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

function kindOf(category: string, text: string): LoanKind {
  if (category === "mortgage") return "mortgage";
  if (category === "student_loan") return "student";
  if (isLenderName(text)) return "instalment";
  return isCarFinanceText(text) ? "car" : "consumer";
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
export function loanProposals(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing">, inputs: UserInputs): LoanProposal[] {
  const candidates = ctx.recurring.filter((s) => s.active && s.cadence === "monthly" && (s.kind === "bill" || s.kind === "subscription") && LOAN_CATEGORIES.has(s.category));
  if (!candidates.length) return [];
  const byId = new Map(standingOf(ctx).txs.map((t) => [t.id, t]));
  const taken = takenSeries(inputs);
  const cancelled = cancelledSubjects(inputs);

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
    // separate invoices each bring their own reference; a contract keeps one
    const references = new Set(latest.map(referenceOf).filter((r) => r !== ""));
    if (references.size > 1) continue;
    // an insurer, a landlord, a lessor and a housing company charging for its own loan are paid no loan of the household's
    const last = latest.at(-1)!;
    const payee = fold(last.counterparty ?? s.merchant);
    const text = fold([s.merchant, last.counterparty, last.description].filter(Boolean).join(" "));
    if (isInsuranceText(text) || isRent(text) || isLeaseText(text) || isHousingCompanyName(payee)) continue;
    // Laina is a first name too: a person so named is a lender only when the payment text names the loan
    if (isNamedLaina(payee) && !hasPayeeForm(payee) && !isLoanText(fold(last.description ?? ""))) continue;
    if (isCancelled(cancelled, s)) continue;
    if (taken(s, charges)) continue;
    // one of a lender's several series has its payment in the series id, and on rows cut to a part that is the part
    const cut = charges.some((t) => t.wholeCents !== undefined);
    out.push({
      key: seriesId({ ...parts, product: cut ? paymentCents : (parts.product ?? paymentCents) }),
      seriesId: s.id,
      payee: s.merchant,
      accountId: parts.accountId,
      paymentCents,
      months: s.monthsActive,
      firstDate: s.firstDate,
      lastDate: s.lastDate,
      category: s.category,
      kind: kindOf(s.category, text),
      reference: [...references][0] ?? null,
    });
  }
  return out.sort((a, b) => b.paymentCents - a.paymentCents || (a.key < b.key ? -1 : 1));
}
