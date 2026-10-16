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
import { cancelledSubjects, isCancelled, isContract } from "./commitments.ts";
import { loansOf } from "./loans.ts";
import { lexiconCategory } from "./lexicon.ts";
import { cardIssuerName, fold } from "./merchant.ts";
import { parseSeriesId, type RecurringSeries, seriesId } from "./recurring.ts";
import { steadyBy } from "./returns.ts";
import type { IsoDate, LoanKind, UserInputs, UserMark } from "./types.ts";
import { isFinanceCompanyName } from "./wording-lenders.ts";
import { CONSUMER_LENDER_WORDS, hasPayeeForm, housingCharge, isCarFinanceText, isHousingCompanyName, isInsuranceText, isLeaseText, isLenderName, isLoanText, isNamedLaina, isRent } from "./wording.ts";

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
}

/** What the household answers when asked what a loan is, with the loan kind each answer stands for. */
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

/**
 * A payee the app knows as a lender: an instalment service or a consumer lender of the word lists, a finance company
 * by the end of its name, or a company the lexicon files as credit. Its steady payment is a loan; whose it is, only
 * the household says.
 */
function isKnownLender(payee: string, text: string): boolean {
  return isLenderName(text) || CONSUMER_LENDER.test(text) || isFinanceCompanyName(payee) || lexiconCategory({ merchant: payee, counterparty: payee, description: null })?.category === "loans";
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
  const said = answeredKind(inputs);
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
    const told = said(s, charges);
    const placing = kindOf(s.category, text);
    // a known lender's payment of about one sum month after month is a loan with no question: the kind stays a guess for the form
    const lender = steadyBy(charges, () => "series").size > 0 && isKnownLender(payee, text);
    const home = !placing.placed && owner && paymentCents > MORTGAGE_PAYMENT_CENTS;
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
      kind: told ?? (home ? "mortgage" : placing.kind),
      placed: told !== null || home || placing.placed || lender,
      reference: [...references][0] ?? null,
    });
  }
  return out.sort((a, b) => b.paymentCents - a.paymentCents || (a.key < b.key ? -1 : 1));
}
