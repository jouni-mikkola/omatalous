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
 */
import type { AnalysisContext, AnalysisTx } from "./analysis/context.ts";
import { covers, seriesMarkSubject } from "./analysis/subscription-alerts.ts";
import { referenceOf } from "./card-channel.ts";
import { cancelledSubjects, isCancelled } from "./commitments.ts";
import { loansOf } from "./loans.ts";
import { fold } from "./merchant.ts";
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
  /** The usual payment, positive. */
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

/**
 * Whether a stored key (a loan's `seriesKey`, or the key of an "Ei laina" mark) names this series: the same payee,
 * account and direction, and a payment the series has charged. `covers` owns how far apart two payments of one
 * contract can be, and reads the key as a mark on the series. Every charge is asked, so a key holds after the rate has
 * moved the payment many times. A key without a payment names every series the payee has on the account.
 */
function names(key: string, s: RecurringSeries, amounts: readonly number[]): boolean {
  const subject = seriesMarkSubject({ id: key, kind: "bill", typicalAmountCents: 0 });
  const named = parseSeriesId(key);
  const own = parseSeriesId(s.id);
  if (!named || !own || named.direction !== own.direction || named.accountId !== own.accountId || named.merchant !== own.merchant) return false;
  if (typeof named.product !== "number") return named.product === null;
  return amounts.some((cents) => covers(subject, { id: s.id, merchant: s.merchant, kind: "subscription", typicalAmountCents: cents, priceChange: null }));
}

function kindOf(category: string, text: string): LoanKind {
  if (category === "mortgage") return "mortgage";
  if (category === "student_loan") return "student";
  if (isLenderName(text)) return "instalment";
  return isCarFinanceText(text) ? "car" : "consumer";
}

/** The mark that says a proposal is no loan: the series stays out of `loanProposals` until the mark is taken away. */
export function notLoanMark(proposal: Pick<LoanProposal, "key">): Pick<UserMark, "subject" | "mark"> {
  return { subject: NOT_LOAN_SUBJECT + proposal.key, mark: "dismissed" };
}

/**
 * The loans to propose today, the largest payment first. A series the household marked "Ei laina" or cancelled, and one
 * a saved loan is linked to, is left out.
 */
export function loanProposals(ctx: Pick<AnalysisContext, "txs" | "recurring">, inputs: UserInputs): LoanProposal[] {
  const candidates = ctx.recurring.filter((s) => s.active && s.cadence === "monthly" && (s.kind === "bill" || s.kind === "subscription") && LOAN_CATEGORIES.has(s.category));
  if (!candidates.length) return [];
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const taken = [...loansOf(inputs).map((loan) => loan.seriesKey), ...inputs.marks.filter((m) => m.mark === "dismissed").map((m) => notLoanKey(m.subject))].filter((key): key is string => !!key);
  const cancelled = cancelledSubjects(inputs);

  const out: LoanProposal[] = [];
  for (const s of candidates) {
    const parts = parseSeriesId(s.id);
    if (!parts || parts.direction !== "out" || parts.product === "habit") continue;
    const charges = s.transactionIds.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t && -t.amountCents >= MIN_LOAN_PAYMENT_CENTS);
    if (charges.length < MIN_LOAN_CHARGES || s.typicalAmountCents < MIN_LOAN_PAYMENT_CENTS) continue;
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
    const amounts = [s.typicalAmountCents, ...charges.map((t) => -t.amountCents)];
    if (taken.some((key) => names(key, s, amounts))) continue;
    out.push({
      key: seriesId({ ...parts, product: parts.product ?? s.typicalAmountCents }),
      seriesId: s.id,
      payee: s.merchant,
      accountId: parts.accountId,
      paymentCents: s.typicalAmountCents,
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
