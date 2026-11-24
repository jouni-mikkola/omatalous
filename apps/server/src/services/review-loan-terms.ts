/**
 * Tarkistettavat's questions about the member's own debts, from the view the queue read once (`OwnView`):
 * - `loan_terms_list`, Täydennä lainat: one item that lists every debt whose balance or payment is not known, each
 *   once and the largest year of payments first (core `loanTermsList`). A debt is
 *   - a saved loan still owing whose plan lacks a fact the review asks (core `openLoanGaps`, kept to `ASKED_GAPS`: the
 *     interval, the payment, the last due date of a bullet loan): its own form answers it (PUT /api/loans/:id). A card
 *     saved by hand with no account linked and no rate lacks its rate, answered as a connected card's is (below). A plan
 *     at 0 % whose fee nothing tells (`debtCost` is unknown by `fee`) lacks the fee of each payment, which "0 €"
 *     answers. A loan that lacks only its rate, reference rate, margin, review day or way of paying back is not listed;
 *   - a connected card that owes while its rate is unknown: the bank tells the balance and nothing of its terms. Whether
 *     the household pays the card in full each month answers it: yes saves a rate of 0, no asks the rate, on a new loan
 *     linked to the card or on the linked loan that saved no rate. A card the rows show paid in full each month costs
 *     no interest (`debtsOf`), and a saved rate of 0 is a rate, so neither is listed;
 *   - a loan the rows show and nobody saved (core `loanProposals`), whose one question is what it owes now: saved with
 *     its series key (POST /api/loans), set aside with "En tiedä" while its monthly payment stays what it was
 *     (`loanUnknownSubject`), or marked "Ei ole velan maksu"; an instalment plan of two or more payments, answered by its end (`planSubject`). A credit
 *     of unknown kind (`kindUnknown`) is saved as the card, credit line or consumer credit the household picks, or told
 *     as one of those saved already with no link (`savedCards`);
 *   - a card the household pays the bills of and has not connected (core `unconnectedCards`), saved as a loan of kind
 *     card with the series key, or told as a card loan saved already (`savedCards`);
 *   - a card whose purchases the twelve complete months lack (core `cardGaps`, `card_gap`): its statement brings them in,
 *     and one that is not connected is connected or saved as a card loan as above. A connected card's debt is its
 *     account's, so its row asks for nothing else.
 *   - payments to a lender or card issuer that stopped inside the twelve complete months (core `endedCredits`), no
 *     debt service and in no card gap: one row asks whether the credit was paid off ("Maksettu pois", a mark that holds
 *     for good), is a card or credit still owed (the form of a credit of unknown kind), or is no debt payment. It owes
 *     nothing known, so it is no debt without a balance in the figures at the top;
 *   "En tiedä" sets a card aside until its monthly bill, or the sum of its missing bills, rises (`cardUnknownAsked`).
 *   The figures at the top are the queue's own: what the household owes as the debt pages count it (`debtsOf`), null
 *   while a loan's balance is dated after the day, and how many debts of the list have no balance.
 * - `loan_drift`, a payment of a saved loan's series that the loan's plan did not expect (core `loanDrift`): the loan's
 *   form opens with the payment the bank took, and the item goes when the loan is saved after that row or a later payment
 *   fits. A loan listed in Täydennä lainat has no drift asked.
 * What a linked loan owes is what its account says, as the debt pages count it (`householdDebts`). "Älä muistuta tästä
 * enää" is the mark `dismissed` on a saved loan's `subject`, and it holds for every fact but the rate and the payment,
 * which keep asking (`loanTermsDismissible`).
 */
import {
  balanceDayOf,
  billCents,
  debtPayments,
  debtsOf,
  endedCredits,
  hasMonthly,
  hasReferenceRate,
  inferLoanTerms,
  type InferredLoanTerms,
  isRevolving,
  lenderInstalments,
  type Loan,
  type LoanKind,
  loanDrift,
  loansOf,
  loanFeeGaps,
  loanTermsDismissed,
  type ListedDebt,
  loanTermsList,
  loanTermsListCents,
  type LoanTermsMissing,
  loanTermsSubject,
  openCardRows,
  openLoanGaps,
  paymentOf,
  savedLoanYearCents,
  unlinkedCardLoans,
  unlinkedCreditLoans,
  unsavedDebtAnswered,
} from "@banking/core";
import { todayIn } from "../platform/config.ts";
import type { Services } from "./context.ts";
import { memoOn } from "./context-memo.ts";
import { proposalsOf } from "./request-inputs.ts";
import type { OwnView } from "./review-own.ts";

/** Where a debt of the list comes from, which says how its row is saved. */
type LoanTermsSource = "loan" | "card" | "proposal" | "plan" | "card_bill" | "card_gap" | "ended";

/** One debt of Täydennä lainat, with what is known of it to fill its row. */
interface LoanTermsDebt {
  id: string;
  source: LoanTermsSource;
  /** The saved loan's name, the card account's name, or the payee of the rows. */
  name: string;
  /** The saved loan, null for none. A connected card with a saved loan names both. */
  loanId: string | null;
  /** The connected card, null for none. */
  accountId: string | null;
  /** The series key a loan saved from the rows is linked by, null for a saved loan or a connected card. */
  key: string | null;
  /** The saved kind, or the kind the rows suggest. */
  kind: LoanKind;
  /** Whether the kind is known: one the rows only suggest is asked. */
  placed: boolean;
  /** A credit whose kind the rows do not tell (core `LoanProposal.kindUnknown`): `kind` is no guess, and the row asks card, credit line or consumer credit. Absent otherwise. */
  kindUnknown?: true;
  /** The member's part of a month of payments, null when no monthly payment is known. */
  monthlyCents: number | null;
  /** The latest payment as the bank took it, filled in as the payment; null when the rows tell no monthly one. */
  latestCents: number | null;
  /** The day of the latest payment the rows show, null for a saved loan or a connected card. */
  lastDate: string | null;
  /** What the debt owes and the day that balance is of, null while it is not known. */
  owedCents: number | null;
  balanceDate: string | null;
  /** The facts a saved loan lacks (core `openLoanGaps`), the rate for a connected card, none for a debt of the rows. */
  gaps: LoanTermsMissing[];
  /** The mark "Älä muistuta tästä enää" goes on, for a saved loan; null for the others. */
  subject: string | null;
  /** What the rows tell of a loan's terms, null where they tell nothing. */
  terms: InferredLoanTerms | null;
  /**
   * The loans saved with no link that the debt may be: the card loans for a card that is not connected, and the card,
   * credit line and consumer credit loans for a credit of unknown kind.
   */
  savedCards: { id: string; name: string }[];
  /** A card whose purchases are missing (`card_gap`): the sum of its bills that pay them (null: none) and the day a connected card's rows begin (null: before the twelve months). Absent otherwise. */
  missing?: { cents: number | null; since: string | null };
}

export interface LoanTermsListItem {
  kind: "loan_terms_list";
  id: "loan-terms";
  cents: number;
  debts: LoanTermsDebt[];
  /** What the household owes in all, null while a loan's balance is dated after the day (`totalKnown`). */
  debtsCents: number | null;
  /** How many debts of the list have no balance. */
  noBalance: number;
  /** The queue's own fields of every item: the list has no rows of its own. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

/** A payment of a saved loan that its plan did not expect: what the bank took, what the plan said, and what the form is filled with. */
export interface LoanDriftItem {
  kind: "loan_drift";
  id: string;
  cents: number;
  loanId: string;
  name: string;
  /** The day of the payment and what the bank took of it, whole. */
  date: string;
  paidCents: number;
  /** What the loan's plan expected on the nearest due date. */
  expectedCents: number;
  /** The payment to fill in the loan's form, and for a loan on a reference rate the day to fill in as its review day. */
  newPaymentCents: number;
  reviewDate: string | null;
  /** The payment's row, shown as the bank charged it. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

/** The member's own saved loans of the view: a loan another member typed in, paid from a shared account, is not asked of the viewer. */
const ownLoans = ({ inputs }: OwnView): Loan[] => (inputs.loans ?? []).filter((loan) => loan.typedBy === undefined);

type Listed = LoanTermsDebt & ListedDebt;

const debt = (fields: Omit<Listed, "loanId" | "accountId" | "key" | "monthlyCents" | "latestCents" | "lastDate" | "owedCents" | "balanceDate" | "gaps" | "subject" | "terms" | "savedCards"> & Partial<Listed>): Listed => ({
  loanId: null,
  accountId: null,
  key: null,
  monthlyCents: null,
  latestCents: null,
  lastDate: null,
  owedCents: null,
  balanceDate: null,
  gaps: [],
  subject: null,
  terms: null,
  savedCards: [],
  ...fields,
});

/**
 * The facts of a saved loan's plan the review asks. The rate with its reference rate, margin and review day, and the way
 * of paying back, are edited at the loan: a loan that lacks only those is not listed.
 */
const ASKED_GAPS: readonly LoanTermsMissing[] = ["interval", "payment", "end_date", "fee"];

/** The saved loans that lack a fact the review asks and the connected cards whose rate is unknown. */
function savedDebts(view: OwnView): Listed[] {
  const { ctx, balances, inputs } = view;
  const saved = ownLoans(view);
  const own = balances.filter((b) => b.ownerName === null);
  const debts = debtsOf(ctx, own, { ...inputs, loans: saved });
  const seriesKeys = saved.flatMap((loan) => loan.seriesKey ?? []);
  // a connected card that owes at an unknown rate and no saved loan holds may be the very card saved by hand: its row asks once
  const looseCard = debts.sources.some((src, at) => !src.linked && own.some((b) => b.id === src.accountId && b.type === "credit_card") && debts.connected[at]!.balanceCents > 0 && debts.connected[at]!.rateBp === null);
  const loans = saved.flatMap((loan): Listed[] => {
    // a loan linked to its account owes what the account says, unless the typed balance is the newer word of the two
    const at = debts.sources.findIndex((src) => src.linked && src.loanId === loan.id);
    const account = at < 0 ? undefined : own.find((b) => b.id === debts.sources[at]!.accountId);
    const told = account !== undefined && balanceDayOf(account.balanceAt, debts.day) >= loan.balanceDate;
    const owedCents = told ? debts.connected[at]!.balanceCents : loan.balanceCents;
    const planGaps = openLoanGaps(loan, owedCents, loanTermsDismissed(inputs.marks, loan.id)).filter((gap) => ASKED_GAPS.includes(gap));
    // a card saved by hand with no link to an account and no rate has no plan to ask: whether it is paid in full each month is the one question (a linked one is the card's, below)
    const bareRate = at < 0 && !looseCard && loan.kind === "card" && owedCents > 0 && loan.rateBp === null && !hasReferenceRate(loan);
    // a plan at 0 % that nothing tells the fee of has no cost: its fee is asked when the plan has no other gap
    const gaps = planGaps.length ? planGaps : bareRate ? (["rate"] satisfies LoanTermsMissing[]) : isRevolving(loan.kind) ? [] : loanFeeGaps({ ...loan, balanceCents: owedCents }, debts.day, debtPayments(ctx, loan, seriesKeys));
    if (!gaps.length) return [];
    const yearCents = savedLoanYearCents(loan);
    return [
      debt({
        id: `loan:${loan.id}`,
        // the loan's own series, so a proposal of the same series is no second row
        seriesId: loan.seriesKey ?? null,
        yearCents,
        source: "loan",
        name: loan.name,
        loanId: loan.id,
        kind: loan.kind,
        placed: true,
        // a payment of every few months is told as its month's share, as a year of it is a twelfth of that a month
        monthlyCents: yearCents === null ? null : Math.round(yearCents / 12),
        owedCents,
        balanceDate: told ? balanceDayOf(account.balanceAt, debts.day) : loan.balanceDate,
        gaps,
        subject: loanTermsSubject(loan.id),
      }),
    ];
  });
  // a card with no saved loan paid in full is told as interest 0 (`settledCardLoan`): the debts without the saved loans show which linked card is too
  let bare: ReturnType<typeof debtsOf> | undefined;
  const paidInFull = (accountId: string): boolean => {
    bare ??= debtsOf(ctx, own, { ...inputs, loans: [] });
    const at = bare.sources.findIndex((src) => src.accountId === accountId);
    return at >= 0 && bare.connected[at]!.rateBp === 0;
  };
  const cards = debts.sources.flatMap((src, at): Listed[] => {
    const owed = debts.connected[at]!;
    const account = own.find((b) => b.id === src.accountId);
    // a card owing nothing has no rate to ask, a linked pair included; a credit line drawn on another kind of account is no card. A card's rate keeps asking: no mark sets it aside.
    if (!account || account.type !== "credit_card" || !isRevolving(owed.kind) || owed.balanceCents <= 0 || owed.rateBp !== null || (src.linked && paidInFull(account.id))) return [];
    const loan = src.linked ? saved.find((l) => l.id === src.loanId) : undefined;
    // a typed balance newer than the account's is the newer word of the two, as for a saved loan
    const accountDay = balanceDayOf(account.balanceAt, debts.day);
    const balanceDate = loan !== undefined && accountDay < loan.balanceDate ? loan.balanceDate : accountDay;
    return [debt({ id: `card:${account.id}`, seriesId: null, yearCents: null, source: "card", name: account.name, loanId: loan?.id ?? null, accountId: account.id, kind: loan?.kind ?? "card", placed: true, owedCents: owed.balanceCents, balanceDate, gaps: ["rate"] })];
  });
  return [...loans, ...cards];
}

/** The loans and instalment plans the rows show and nobody saved, with what their rows tell of the terms. */
function proposedDebts({ ctx, inputs, stamp }: OwnView): Listed[] {
  const series = memoOn(ctx, "review:loan-series", null, () => new Map([...ctx.recurring, ...lenderInstalments(ctx)].map((r) => [r.id, r.transactionIds])));
  const byId = memoOn(ctx, "review:rows-by-id", null, () => new Map(ctx.txs.map((t) => [t.id, t])));
  return proposalsOf(ctx, { inputs, stamp }).flatMap((p): Listed[] => {
    // a plan is asked its end once; a loan until it is saved, marked "Ei ole velan maksu", or said "En tiedä" at this
    // monthly payment. The first page reads the same answer, so it links here only while this list asks.
    if (unsavedDebtAnswered(inputs.marks, { proposal: p })) return [];
    const monthly = hasMonthly(p) ? paymentOf(p) : null;
    const common = { seriesId: p.seriesId, yearCents: monthly === null ? null : 12 * monthly.part, name: p.payee, key: p.key, monthlyCents: monthly?.part ?? null, latestCents: monthly?.whole ?? null, lastDate: p.lastDate };
    if (p.plan) return [debt({ ...common, id: `plan:${p.key}`, source: "plan", kind: "instalment", placed: true })];
    // a lender's few payments are no series: the proposal holds its rows, at the bank's whole charge as the payment is
    const rowIds = series.get(p.seriesId) ?? [...(p.rowIds ?? [])];
    const terms = inferLoanTerms(rowIds.flatMap((id) => byId.get(id) ?? []).map((t) => ({ date: t.bookingDate, cents: Math.abs(billCents(t)) })));
    if (p.kindUnknown) {
      const savedCards = unlinkedCreditLoans(inputs).map((loan) => ({ id: loan.id, name: loan.name }));
      return [debt({ ...common, id: `proposal:${p.key}`, source: "proposal", kind: p.kind, placed: p.placed, kindUnknown: true, terms, savedCards })];
    }
    return [debt({ ...common, id: `proposal:${p.key}`, source: "proposal", kind: p.kind, placed: p.placed, terms })];
  });
}

/** The payments to a lender that stopped inside the twelve months and that nothing else asks of: a credit of unknown kind that may be paid off. */
function endedDebts({ ctx, inputs }: OwnView): Listed[] {
  const savedCards = unlinkedCreditLoans(inputs).map((loan) => ({ id: loan.id, name: loan.name }));
  return endedCredits(ctx, inputs).map((e) => debt({ id: `ended:${e.key}`, seriesId: null, yearCents: null, source: "ended", name: e.payee, key: e.key, kind: "card", placed: false, kindUnknown: true, lastDate: e.lastDate, savedCards }));
}

/** The cards the household pays the bills of and has not connected, and the cards whose purchases are missing. */
function unconnectedDebts({ ctx, inputs }: OwnView): Listed[] {
  const savedCards = unlinkedCardLoans(inputs).map((loan) => ({ id: loan.id, name: loan.name }));
  const open = openCardRows(ctx, inputs);
  const cards = open.cards.map((c) => debt({ id: `card_bill:${c.key}`, seriesId: c.seriesId, yearCents: 12 * paymentOf(c).part, source: "card_bill", name: c.payee, key: c.key, kind: "card", placed: true, monthlyCents: paymentOf(c).part, latestCents: paymentOf(c).whole, lastDate: c.lastDate, savedCards }));
  // the sum of a card's missing bills is no year of payments: it asks in the order the sources told it, after the debts with a known year
  const gaps = open.gaps.map((g) => debt({ id: `card_gap:${g.key}`, seriesId: null, yearCents: null, source: "card_gap", name: g.payee, accountId: g.cardId, key: g.key, kind: "card", placed: true, lastDate: g.lastDate, savedCards: g.cardId ? [] : savedCards, missing: { cents: g.cents, since: g.since } }));
  return [...cards, ...gaps];
}

/**
 * A connected card that owes at an unknown rate and whose purchases are missing is one row under its name: the row of its
 * rate takes what the statement's row would tell (`missing`), and the statement's row is left out. Once the rate is
 * answered the row of the statement stands alone.
 */
function oneRowPerCard(saved: readonly Listed[], unconnected: readonly Listed[]): { saved: Listed[]; unconnected: Listed[] } {
  const gapOf = (s: Listed): Listed | undefined => (s.source === "card" ? unconnected.find((d) => d.source === "card_gap" && d.accountId === s.accountId) : undefined);
  const taken = new Set(saved.flatMap((s) => gapOf(s)?.id ?? []));
  return {
    saved: saved.map((s) => {
      const gap = gapOf(s);
      return gap?.missing ? { ...s, missing: gap.missing } : s;
    }),
    unconnected: unconnected.filter((d) => !taken.has(d.id)),
  };
}

/** A connected card whose purchases are missing: what it owes is its account's balance, which no row of the list lacks. */
const connectedGap = (d: LoanTermsDebt): boolean => d.source === "card_gap" && d.accountId !== null;

/**
 * Täydennä lainat, or nothing when no debt lacks a fact. Only the member's own loans and accounts are read: an account
 * another member shared is left out of the debts before they are worked out, so another member's loan or card is never
 * listed. The list weighs the year of payments it holds, so it is asked before the questions of smaller sums.
 */
export const loanTermsListItems = async (_s: Services, _userId: string, view: OwnView): Promise<LoanTermsListItem[]> => {
  const rows = oneRowPerCard(savedDebts(view), unconnectedDebts(view));
  const listed = loanTermsList([...rows.saved, ...proposedDebts(view), ...rows.unconnected, ...endedDebts(view)]);
  if (!listed.length) return [];
  const all = debtsOf(view.ctx, view.balances, view.inputs);
  const debts = listed.map(({ seriesId: _series, yearCents: _year, ...row }): LoanTermsDebt => row);
  return [{ kind: "loan_terms_list", id: "loan-terms", cents: loanTermsListCents(listed) ?? 0, debts, debtsCents: all.totalKnown ? all.total.cents : null, noBalance: debts.filter((d) => d.owedCents === null && !connectedGap(d) && d.source !== "ended").length }];
};

/**
 * The payments of the member's own saved loans that their plans did not expect, one item per loan and none for a loan
 * in `asked`, which has its terms asked first. The loan's own rows of its series are read from the view's context; the
 * day the loan was last saved is the one read of the database, made only when a loan with a series could be asked.
 */
export const loanDriftItems = async (s: Services, userId: string, view: OwnView, asked: ReadonlySet<string>): Promise<(LoanDriftItem & { rowIds: string[]; whole: true })[]> => {
  const { ctx, inputs } = view;
  const loans = loansOf({ ...inputs, loans: ownLoans(view) }).filter((loan) => loan.seriesKey !== null && !asked.has(loan.id));
  if (!loans.length || !ctx.txs.length) return [];
  const savedAt = await s.finance(userId).loansSavedAt();
  const others = (inputs.loans ?? []).flatMap((loan) => loan.seriesKey ?? []);
  return loans.flatMap((loan) => {
    const at = savedAt.get(loan.id);
    const saved = at === undefined || Number.isNaN(new Date(at).getTime()) ? "" : todayIn(s.instance.current.timezone, new Date(at));
    const drift = loanDrift(loan, ctx.txs, others, saved);
    if (drift === null) return [];
    const { rowId, ...answer } = drift;
    return [{ kind: "loan_drift", id: `loan_drift:${loan.id}`, cents: 0, loanId: loan.id, name: loan.name, ...answer, rowIds: [rowId], whole: true }];
  });
};
