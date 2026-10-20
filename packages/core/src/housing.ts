/**
 * Decision: what the home costs a month and on what terms its loan runs: each home loan with its next payment and the
 * parts of its rate, then the rent and every charge on a row of its own. The first page (Yhteenveto) shows it as the
 * block Asuminen and adds nothing up.
 *
 * It owns no figure (ADR 0004). A loan's month is `debtPaymentsPerMonth`'s and its next payment `loanNextPayment`'s,
 * both as Varallisuus > Lainat has them (`heldLoans`); a charge's month is its series' own (`monthlyCents`, the year
 * over twelve), so a refund of one charge moves nothing here. The one sum adds the known rows once.
 *
 * - A home loan is a debt of the view whose kind is `mortgage` and that still owes.
 * - Loan payments in the rows that no saved loan is linked to are a row without terms: an active series of the
 *   category `mortgage` that no saved loan names (`Loan.seriesKey`) and the household did not call "Ei laina". A saved
 *   home loan with no link takes such a series as its own payments, so the loan and its payments are one row and the
 *   payment is in the total once. It takes one when a payment is typed for the loan and the series' charges fit it
 *   (`fitsPayment`), or when no payment is typed, the loan is the only one without, and the series is the only one
 *   free. A loan with a link takes none. Where nothing is taken the rows stand side by side: a guess would hide a
 *   second loan. A loan that takes a series is cut as the series is, by the viewer's part of the account it leaves.
 * - A charge is an active contract (`isContract`) of the category `housing` or `utilities` that the household did not
 *   mark cancelled, named by the words of its latest payment (`housingCharge`). Two payments to one payee on one day
 *   are one charge of one series (`recurring.ts`), so they are one row here.
 * - In a member's own view the rows of a joint account hold the viewer's part, so a series' month is that part
 *   already, and a loan is cut as the holdings cut it. `atPart` says a row of the block is a part.
 *
 * It stands beside `holdings.ts`, below analysis, as the dashboard reads both.
 */
import type { AnalysisContext, AnalysisTx } from "./analysis/context.ts";
import { inDays, standingOf } from "./analysis/context.ts";
import { cancelledSubjects, isCancelled, isContract } from "./commitments.ts";
import { dayNumber } from "./dates.ts";
import type { Debt } from "./debt-part.ts";
import { heldLoans } from "./holdings.ts";
import { belowWhole, householdDebts } from "./household-debts.ts";
import { fitsPayment, loanProposals, takenSeries } from "./loan-detect.ts";
import { endOf, hasReferenceRate, loanNextPayment, loansOf, type NextPayment, typedBill } from "./loans.ts";
import { fold } from "./merchant.ts";
import { parseSeriesId, type RecurringSeries } from "./recurring.ts";
import type { BalanceInput, IsoDate, Loan, Part, UserInputs } from "./types.ts";
import { housingCharge } from "./wording.ts";

/**
 * The subject of the mark that answers the block's question with "Ei asuntolainaa" (`dismissed`). The member's own,
 * as every mark: each member is asked once, in both views.
 */
export const MORTGAGE_QUESTION = "question:mortgage";

export interface HousingLoan {
  /** The saved loan's id, the one its row of `Holdings.loans` has. Null for payments in the rows with no saved loan. */
  id: string | null;
  /** What the household calls the loan. Null with no saved loan: the page has the word. */
  name: string | null;
  /** Who lent, as typed. With no saved loan the payee of the payments. */
  lender: string | null;
  /** The series of the payments of a row with no saved loan, null for a saved loan. */
  seriesId: string | null;
  /** What the loan takes a month: `Holdings.loans[].monthlyPaymentCents`, or the series' month with no saved loan and for a loan that tells none and takes a series. Null when the loan tells no payment. */
  monthlyCents: number | null;
  /**
   * The plan's next payment with its split. Its due date is the plan's own where the loan's last due date is typed (the
   * plan is counted from it), else the next day of the series that pays the loan (the one it is linked to, or takes),
   * else null. Null with no saved loan.
   */
  next: NextPayment | null;
  /** The whole rate as typed, hundredths of a percent. */
  rateBp: number | null;
  reference: Loan["reference"];
  marginBp: number | null;
  /** The reference rate itself, the rate less the margin: told when both are typed, the loan names a reference rate that is no fixed rate, and the result is 0 or more. */
  referenceBp: number | null;
  /** The day the bank sets the rate again, as typed. A fixed rate has none. */
  reviewDate: IsoDate | null;
  /** The day is today or has passed: the rate has been set since, and no later day is worked out. */
  reviewPassed: boolean;
  /** Another member typed the loan in (`Loan.typedBy`): it is the typist's to change, so the viewer cannot add a term to it. False for the viewer's own loan and with no saved loan. */
  typedByOther: boolean;
  /** The viewer's part of the row where it is below the whole, as a row of `Holdings` has it: the row's cents are then that part. Left out where the row is all the viewer's. */
  part?: Part;
}

export interface HousingCharge {
  seriesId: string;
  /** What the payment is, in the words of its own text ("Hoitovastike"). Null when they name nothing: the payee stands alone. */
  label: string | null;
  /** The category the series is in (`housing` or `utilities`): the name a row shows when the words name nothing. */
  category: string;
  payee: string;
  /** The series' month, positive. */
  monthlyCents: number;
  /** The viewer's part of the account the payments leave, where it is below the whole: `monthlyCents` is then that part. */
  part?: Part;
}

export interface Housing {
  /** The saved home loans in the order of `Holdings.loans`, then the payments with no saved loan, the largest first. */
  loans: HousingLoan[];
  /** The largest first. */
  charges: HousingCharge[];
  /** The known months of the loans' rows, added once. */
  loansMonthlyCents: number;
  /** The months of the charges' rows. */
  chargesMonthlyCents: number;
  /** The two sums above together: the known months of the rows, added once. */
  totalMonthlyCents: number;
  /** A loan tells no payment, so the total is without it. */
  partial: boolean;
  /** A row holds the viewer's part of a payment from a joint account. */
  atPart: boolean;
  /** Whether to ask if there is a home loan: no home loan is saved or paid, no rent or right-of-occupancy charge is paid and the member has not answered. */
  ask: boolean;
}

/** The rows of a series from a day on, oldest first. The context's rows are in day order, so only the days asked are walked. */
function rowsOf(ctx: AnalysisContext, s: RecurringSeries, from: IsoDate): AnalysisTx[] {
  const ids = new Set(s.transactionIds);
  return inDays(standingOf(ctx), { fromDay: dayNumber(from), toDay: dayNumber(s.lastDate) }).filter((t) => ids.has(t.id));
}

function loanTerms(loan: Loan, today: IsoDate): Pick<HousingLoan, "rateBp" | "reference" | "marginBp" | "referenceBp" | "reviewDate" | "reviewPassed"> {
  const { rateBp, reference, marginBp } = loan;
  const referenceBp = hasReferenceRate(loan) && rateBp !== null && marginBp !== null && rateBp >= marginBp ? rateBp - marginBp : null;
  // a day saved before the form hid the field of a fixed rate says nothing of a rate that is not set again
  const reviewDate = reference === "fixed" ? null : (loan.rateReviewDate ?? null);
  return { rateBp, reference, marginBp, referenceBp, reviewDate, reviewPassed: reviewDate !== null && reviewDate <= today };
}

/** The block Asuminen on the context's today, or null when it has no row and nothing to ask. */
export function buildHousing(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): Housing | null {
  const today = ctx.today;
  const partOf = new Map(balances.map((b) => [b.id, b.part]));
  /** The viewer's part of the account a series' payments leave, where it is below the whole: the series' rows are cut to it. */
  const partOfSeries = (s: RecurringSeries) => {
    const part = partOf.get(parseSeriesId(s.id)?.accountId ?? "");
    return belowWhole(part) ? part : undefined;
  };
  /** The part as a row carries it: left out where the row is whole. */
  const atPartOf = (part: Part | undefined) => (part ? { part } : {});
  const cancelled = cancelledSubjects(inputs);
  const running = ctx.recurring.filter((s) => isContract(s) && !isCancelled(cancelled, s));
  const bySum = (a: RecurringSeries, b: RecurringSeries) => b.monthlyCents - a.monthlyCents || (a.id < b.id ? -1 : 1);

  const debts = householdDebts(balances, inputs, today);
  const homeLoans = (of: typeof debts) => heldLoans(balances, of).filter(({ row }) => row.kind === "mortgage" && row.leftCents !== 0);
  let saved = homeLoans(debts);
  // a series the household said is its home loan, or that a home owner's big instalment places, is paid for the home as a mortgage is
  const mortgages = new Set(loanProposals(ctx, inputs).filter((p) => p.kind === "mortgage" && p.placed).map((p) => p.seriesId));
  const paid = running.filter((s) => s.category === "mortgage" || mortgages.has(s.id)).map((s) => ({ s, rows: rowsOf(ctx, s, s.firstDate) }));
  const spoken = takenSeries(inputs);
  let open = paid.filter((p) => !spoken(p.s, p.rows)).sort((a, b) => bySum(a.s, b.s));
  /** The series each saved loan with no link takes as its payments, by the loan's id: they are the loan's row, no row of their own. */
  const taken = new Map<string, RecurringSeries>();
  const take = (id: string, p: (typeof open)[number]) => {
    taken.set(id, p.s);
    open = open.filter((o) => o !== p);
  };
  // a payment is typed: the series whose charges fit it. Then a loan with none takes the one series left, if it is the only such loan
  const unlinked = saved.filter(({ debt }) => !debt.seriesKey).map(({ row, debt }) => ({ id: row.id, bill: typedBill(debt, today) }));
  for (const { id, bill } of unlinked) {
    const fits = bill === null ? undefined : open.find((p) => fitsPayment(bill, p.s, p.rows));
    if (fits) take(id, fits);
  }
  const bare = unlinked.filter(({ id, bill }) => bill === null && !taken.has(id));
  if (bare.length === 1 && open.length === 1) take(bare[0]!.id, open[0]!);
  const unsaved = open.map((p) => p.s);

  // the loan is typed whole and the series it takes holds the viewer's part: the row is cut as the holdings cut a loan paid from that account
  const cutBy = new Map(
    debts.saved.flatMap((d) => {
      const part = taken.has(d.id) ? partOfSeries(taken.get(d.id)!) : undefined;
      return part ? [[d.id, part] as const] : [];
    }),
  );
  if (cutBy.size) saved = homeLoans({ ...debts, saved: debts.saved.map((d) => (cutBy.has(d.id) ? { ...d, part: cutBy.get(d.id)! } : d)) });

  /** The series that pays a saved loan: the one it takes, or the active one its key names. */
  const payingFor = (id: string, debt: Debt): RecurringSeries | undefined => {
    if (taken.has(id) || !debt.seriesKey) return taken.get(id);
    const named = takenSeries({ marks: [], expectedBills: [], loans: [debt] });
    return ctx.recurring.find((s) => s.active && s.nextDate !== null && named(s, rowsOf(ctx, s, s.firstDate)));
  };
  const loans: HousingLoan[] = [
    ...saved.map(({ row, debt }) => {
      const next = loanNextPayment(debt, today);
      return {
        id: row.id,
        name: row.name,
        lender: row.lender,
        seriesId: null,
        monthlyCents: row.monthlyPaymentCents ?? taken.get(row.id)?.monthlyCents ?? null,
        // the plan's days are the bank's only when they are counted from a typed last due date
        next: endOf(debt) !== null ? next : { ...next, date: payingFor(row.id, debt)?.nextDate ?? null },
        ...loanTerms(debt, today),
        typedByOther: debt.typedBy !== undefined,
        ...atPartOf(row.part ?? cutBy.get(row.id)),
      };
    }),
    ...unsaved.map((s) => ({
      id: null, name: null, lender: s.merchant, seriesId: s.id, monthlyCents: s.monthlyCents, next: null, rateBp: null, reference: null, marginBp: null, referenceBp: null, reviewDate: null, reviewPassed: false,
      typedByOther: false,
      ...atPartOf(partOfSeries(s)),
    })),
  ];

  const billed = running.filter((s) => s.category === "housing" || s.category === "utilities").sort(bySum);
  const names = billed.map((s) => {
    const name = (text: string) => housingCharge(fold(s.merchant), fold(text), s.category === "utilities");
    const last = rowsOf(ctx, s, s.lastDate).map((t) => name(`${t.counterparty ?? ""} ${t.description ?? ""}`));
    // payments of one day are one charge of the series: where their words differ, the sum is none of them and the payee names it
    return new Set(last.map((n) => n?.kind)).size === 1 ? last[0]! : name("");
  });
  const charges = billed.map((s, i): HousingCharge => ({ seriesId: s.id, label: names[i]?.label ?? null, category: s.category, payee: s.merchant, monthlyCents: s.monthlyCents, ...atPartOf(partOfSeries(s)) }));

  // a tenant has no home loan to add, and one that is saved and paid off needs no question either
  const tenant = names.some((n) => n?.kind === "rent" || n?.kind === "occupancy");
  const answered = inputs.marks.some((m) => m.subject === MORTGAGE_QUESTION);
  const ask = !loans.length && !tenant && !answered && !loansOf(inputs).some((loan) => loan.kind === "mortgage");
  if (!loans.length && !charges.length && !ask) return null;

  const monthsOf = (rows: readonly { monthlyCents: number | null }[]) => rows.reduce((sum, row) => sum + (row.monthlyCents ?? 0), 0);
  const [loansMonthlyCents, chargesMonthlyCents] = [monthsOf(loans), monthsOf(charges)];
  return {
    loans,
    charges,
    loansMonthlyCents,
    chargesMonthlyCents,
    totalMonthlyCents: loansMonthlyCents + chargesMonthlyCents,
    partial: loans.some((loan) => loan.monthlyCents === null),
    atPart: [...loans, ...charges].some((row) => row.part !== undefined),
    ask,
  };
}
