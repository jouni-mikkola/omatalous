// Decision: how much of the money paid on debts went to interest and fees, and how much repaid the debt
/**
 * What a period's debt service (Velanhoito, `PeriodTotals.debtCents`) is made of: interest and fees, repayments, and
 * what no evidence splits. Every debt-flow row of the range lands in exactly one way, so the three sums add up to
 * `debtCents` to the cent, and the split changes no cash figure: Tulos stays cash (ADR 0014).
 *
 * The evidence, in order:
 *  1. The payment parts a loan document stated (`Loan.paymentParts`): the payment on a part's due date, within
 *     `LOAN_ROW_DAYS`, when the parts add up to the row within the tolerance of the plan's payment. The interest and the
 *     fee are the document's, to the cent, and the rest of the row repays.
 *  2. The connected loan account's own rows (zero in flows) that the bank booked as interest on the day of the row give
 *     its interest; the rest of the row is repayment.
 *  3. A saved loan with a complete plan whose payment series holds the row, the row within `LOAN_ROW_DAYS` of a due
 *     date and within the tolerance of the payment the plan expects. The balance walk gives the interval's interest:
 *     forward from the balance date over the actual rows, back from it by the interval's own rate. The known fee is a
 *     charge (*Korot ja luottokulut*) and the rest is repayment. The check and the plan run on the whole loan and the
 *     bank's whole row, and are cut once at the end to the viewer's part of the row (ADR 0016).
 *  4. Otherwise the row is not split. A row of category `interest` is interest as a whole, and a card bill and a
 *     collection row are never split.
 *
 * A row stays unsplit when its evidence leaves less than nothing for the repayment, when a due date already has a
 * nearer row, and when no rate is known.
 */
import { billCents, partCents, WHOLE } from "../account-use.ts";
import { addMonthsToDate, dayNumber, monthIndex, monthOf } from "../dates.ts";
import { normalizeIban } from "../iban.ts";
import { paysSeries } from "../loan-detect.ts";
import { divRound, endOf, intervalInterest, MAX_LOAN_PAYMENTS, planOf, typedPayment } from "../loan-plan.ts";
import { loanSchedule, rateMilliAt } from "../loan-schedule.ts";
import { loansOf } from "../loans.ts";
import { isCut } from "../shared.ts";
import { LOAN_ROW_DAYS, LOAN_ROW_TOLERANCE_CENTS, LOAN_ROW_TOLERANCE_SHARE } from "../thresholds.ts";
import { type Account, type IsoDate, isRevolving, type Loan, type Part, type UserInputs } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, spendRows } from "./context.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** The debt service of a range in its three kinds. Their sum is `PeriodTotals.debtCents`. */
export interface DebtSplit {
  /** Interest and fees: *Korot ja luottokulut*. */
  interestCents: number;
  /** Repayments: *Lyhennykset*. */
  principalCents: number;
  /** Paid on debt with no evidence of its parts: *Velanhoito, erittelemättä*. */
  unsplitCents: number;
}

/** The interest and the fee of one bank row, whole, as the evidence gives them. The repayment is the rest of the row. */
interface RowParts {
  interestCents: number;
  feeCents: number;
}

/** Categories of rows that are never split, whatever else matches them. */
const UNSPLIT_CATEGORIES: ReadonlySet<string> = new Set(["card_bill", "collection"]);

/** The part of a row the viewer's view holds: the whole row, or the share its cut kept (ADR 0016). */
function rowPart(t: AnalysisTx): Part {
  const whole = Math.abs(billCents(t));
  return isCut(t) && whole > 0 ? { from: 0, to: Math.abs(t.amountCents), of: whole } : WHOLE;
}

/** The connected loan accounts of the view: the ones that carry a loan's own rows, not a payment account of a loan. */
const loanAccountsOf = (ctx: AnalysisContext): Account[] => ctx.accounts.filter((a) => a.type === "loan" && !ctx.paymentAccounts.has(a.id));

/** The connected loan account a row pays: by the account number it names, else by the series of a saved loan connected to it. */
function loanAccountPaidBy(loanAccounts: readonly Account[], loans: readonly Loan[]): (t: AnalysisTx) => string | undefined {
  const byIban = new Map(loanAccounts.flatMap((a) => (normalizeIban(a.iban) ? [[normalizeIban(a.iban)!, a.id] as const] : [])));
  const ids = new Set(loanAccounts.map((a) => a.id));
  const keys = loans.flatMap((l) => l.seriesKey ?? []);
  return (t) => {
    const iban = normalizeIban(t.counterpartyIban);
    const linked = loans.find((l) => l.accountId != null && ids.has(l.accountId) && l.seriesKey !== null && paysSeries(l.seriesKey, { accountId: t.accountId, merchant: t.merchant, amountCents: billCents(t) }, keys));
    return (iban !== null ? byIban.get(iban) : undefined) ?? linked?.accountId ?? undefined;
  };
}

/**
 * The saved loan a row pays, through the connected loan account the row reaches (`loanAccountPaidBy`) and the loan that
 * names that account. A row that reaches no such account, or one no saved loan is connected to, pays no loan known.
 */
export function savedLoanPaidBy(ctx: AnalysisContext, inputs: UserInputs): (t: AnalysisTx) => Loan | undefined {
  const loans = loansOf(inputs);
  const accountOf = loanAccountPaidBy(loanAccountsOf(ctx), loans);
  return (t) => {
    const account = accountOf(t);
    return account === undefined ? undefined : loans.find((l) => l.accountId === account);
  };
}

/** Evidence 2: the interest the connected loan account booked on the day of each row that pays it. A day's interest goes to one row. */
function accountInterest(ctx: AnalysisContext, rows: readonly AnalysisTx[], inputs: UserInputs): Map<string, RowParts> {
  const loanAccounts = loanAccountsOf(ctx);
  const out = new Map<string, RowParts>();
  if (!loanAccounts.length) return out;
  const ids = new Set(loanAccounts.map((a) => a.id));
  const booked = new Map<string, number>();
  for (const t of ctx.txs) {
    if (!ids.has(t.accountId) || t.category !== "interest" || t.amountCents >= 0) continue;
    const key = `${t.accountId}:${t.day}`;
    booked.set(key, (booked.get(key) ?? 0) - billCents(t));
  }
  if (!booked.size) return out;
  const accountOf = loanAccountPaidBy(loanAccounts, loansOf(inputs));
  // a day on which the payer's own account counts the interest as a row of its own is that interest already: the loan account's booking of it is not counted again
  const paid = new Set<string>();
  for (const t of ctx.txs) {
    if (t.category !== "interest" || t.flows.debt <= 0 || ids.has(t.accountId)) continue;
    const account = accountOf(t);
    if (account !== undefined) paid.add(`${account}:${t.day}`);
  }
  const taken = new Set<string>();
  for (const t of rows) {
    const account = accountOf(t);
    if (account === undefined) continue;
    const key = `${account}:${t.day}`;
    const interest = booked.get(key);
    if (interest === undefined || taken.has(key) || paid.has(key)) continue;
    taken.add(key);
    out.set(t.id, { interestCents: interest, feeCents: 0 });
  }
  return out;
}

/** The room a payment may differ from the plan's by. */
const toleranceOf = (expectedCents: number): number => Math.max(LOAN_ROW_TOLERANCE_CENTS, Math.round(expectedCents * LOAN_ROW_TOLERANCE_SHARE));

/** The debt rows that are wholly debt and are not a transfer, a card bill, a collection or interest: the rows a payment's parts can split. */
export const splittable = (t: AnalysisTx): boolean => t.flows.debt > 0 && t.flows.debt + t.amountCents === 0 && !t.isTransfer && !UNSPLIT_CATEGORIES.has(t.category) && t.category !== "interest";

/**
 * Evidence 1: the payment parts a loan document stated, on the row of each part's due date. A due date takes its
 * nearest row of the loan's series within `LOAN_ROW_DAYS`, the earlier on a tie, and a row takes one part. The parts
 * count only when they add up to the bank's whole row within the tolerance and leave nothing less than zero to repay;
 * the interest and the fee are the document's cents, and the row's remainder repays.
 */
function documentParts(ctx: AnalysisContext, inputs: UserInputs): Map<string, RowParts> {
  const out = new Map<string, RowParts>();
  const loans = loansOf(inputs).filter((l) => l.seriesKey !== null);
  const stated = loans.filter((l) => l.paymentParts?.length);
  if (!stated.length) return out;
  const keys = loans.map((l) => l.seriesKey!);
  const claimed = new Set<string>();
  const debtRows = ctx.txs.filter(splittable);
  for (const loan of stated) {
    const rows = debtRows.filter((t) => !claimed.has(t.id) && paysSeries(loan.seriesKey!, { accountId: t.accountId, merchant: t.merchant, amountCents: billCents(t) }, keys));
    for (const t of rows) claimed.add(t.id);
    for (const part of loan.paymentParts!) {
      const due = dayNumber(part.dueDate);
      let nearest: AnalysisTx | undefined;
      for (const t of rows) {
        const apart = Math.abs(t.day - due);
        if (apart > LOAN_ROW_DAYS) continue;
        if (nearest === undefined || apart < Math.abs(nearest.day - due) || (apart === Math.abs(nearest.day - due) && t.day < nearest.day)) nearest = t;
      }
      if (nearest === undefined || out.has(nearest.id)) continue;
      const whole = -billCents(nearest);
      const sum = part.principalCents + part.interestCents + part.feeCents;
      if (Math.abs(whole - sum) > toleranceOf(sum) || whole - part.interestCents - part.feeCents < 0) continue;
      out.set(nearest.id, { interestCents: part.interestCents, feeCents: part.feeCents });
    }
  }
  return out;
}

/** The fee of the newest payment a document stated, in every payment. */
const feeOf = (loan: Loan): number => [...(loan.paymentParts ?? [])].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]?.feeCents ?? 0;

/** The balance before a payment, given the balance after it: `(B + row) / (1 + r·m/12)`, to the cent (1 200 000 = thousandths of a percent × months a year). Null past what whole numbers hold. */
function balanceBefore(afterCents: number, paidCents: number, rateMilli: number, months: number): number | null {
  const top = (afterCents + paidCents) * 1_200_000;
  if (!Number.isSafeInteger(top)) return null;
  return divRound(top, 1_200_000 + rateMilli * months);
}

/**
 * Evidence 3 for one saved loan: its rows with the interest and fee of their interval. The rows of the loan sit on its
 * due dates, a due date takes its nearest row, and a row that is not the plan's payment, or has no room left for a
 * repayment, has no entry.
 */
function planParts(loan: Loan, rows: readonly AnalysisTx[]): Map<string, RowParts> {
  const out = new Map<string, RowParts>();
  const plan = planOf(loan);
  if ("missing" in plan || plan.rateBp === null || isRevolving(loan.kind) || !rows.length) return out;
  const months = plan.months;
  const rateBp: number = plan.rateBp;
  const anchor = endOf(loan) ?? loan.balanceDate;
  const due = (k: number): IsoDate => addMonthsToDate(anchor, k * months);
  const end = endOf(loan);
  const anchorMonth = monthIndex(monthOf(anchor));

  // the due date each row sits on: the nearest within the window, a tie to the earlier row
  const onDue = new Map<number, { t: AnalysisTx; apart: number }>();
  for (const t of rows) {
    const estimate = Math.round((monthIndex(monthOf(t.bookingDate)) - anchorMonth) / months);
    let best: { k: number; apart: number } | null = null;
    for (let k = estimate - 1; k <= estimate + 1; k++) {
      if (Math.abs(k) > MAX_LOAN_PAYMENTS || (end !== null && due(k) > end)) continue;
      const apart = Math.abs(t.day - dayNumber(due(k)));
      if (apart <= LOAN_ROW_DAYS && (best === null || apart < best.apart)) best = { k, apart };
    }
    if (best === null) continue;
    const held = onDue.get(best.k);
    if (held === undefined || best.apart < held.apart || (best.apart === held.apart && t.day < held.t.day)) onDue.set(best.k, { t, apart: best.apart });
  }
  if (!onDue.size) return out;

  // the last due date on or before the balance date: the balance stands after its payment
  let last = Math.floor((monthIndex(monthOf(loan.balanceDate)) - anchorMonth) / months);
  while (due(last) > loan.balanceDate) last--;
  while (due(last + 1) <= loan.balanceDate) last++;

  const fee = feeOf(loan);
  const typed = typedPayment(loan) ?? 0;
  const schedule = new Map(loanSchedule(loan, loan.balanceDate).rows.map((r) => [r.date, r] as const));
  /** The payment the plan expects on a due date, with the interest of the interval, the fee not counted. */
  const expected = (date: IsoDate, balanceCents: number, interestCents: number): number => {
    const planned = schedule.get(date);
    if (plan.withInterest) return Math.min(planned === undefined ? typed : planned.principalCents + (planned.interestCents ?? interestCents), balanceCents + interestCents);
    return Math.min(planned?.principalCents ?? typed, balanceCents) + interestCents;
  };
  const accept = (t: AnalysisTx, interestCents: number, plannedCents: number): RowParts | null => {
    const whole = -billCents(t);
    if (Math.abs(whole - (plannedCents + fee)) > toleranceOf(plannedCents + fee)) return null;
    return whole - interestCents - fee >= 0 && interestCents >= 0 ? { interestCents, feeCents: fee } : null;
  };

  // forward over the actual rows: B' = B + I - (row - fee)
  const first = last + 1;
  const newest = Math.max(...onDue.keys());
  let balance = loan.balanceCents;
  for (let k = first; k <= newest && balance > 0 && k - first < MAX_LOAN_PAYMENTS; k++) {
    if (end !== null && due(k) > end) break;
    const rate = rateMilliAt(loan.ratePath, rateBp, due(k - 1));
    const interest = intervalInterest(balance, rate, months);
    const planned = expected(due(k), balance, interest);
    const held = onDue.get(k);
    const parts = held === undefined ? null : accept(held.t, interest, planned);
    if (held !== undefined && parts !== null) {
      out.set(held.t.id, parts);
      balance = Math.max(0, balance - (-billCents(held.t) - interest - fee));
    } else balance = Math.max(0, balance - Math.max(0, planned - interest));
  }

  // back from the balance date: B_prev = (B + row - fee) / (1 + r·m/12), with the rate of that interval
  const oldest = Math.min(...onDue.keys());
  balance = loan.balanceCents;
  for (let k = last; k >= oldest && k > last - MAX_LOAN_PAYMENTS; k--) {
    if (balance <= 0) break;
    const rate = rateMilliAt(loan.ratePath, rateBp, due(k - 1));
    const held = onDue.get(k);
    let before: number | null = null;
    if (held !== undefined) {
      const whole = -billCents(held.t);
      before = balanceBefore(balance, whole - fee, rate, months);
      if (before !== null) {
        const interest = intervalInterest(before, rate, months);
        const planned = plan.withInterest ? typed : typed + interest;
        const parts = accept(held.t, interest, planned);
        if (parts !== null) out.set(held.t.id, parts);
      }
    } else before = plan.withInterest ? balanceBefore(balance, typed, rate, months) : balance + typed;
    if (before === null) break;
    balance = before;
  }
  return out;
}

/** Evidence 3 for every saved loan: a row is claimed by the first loan whose series pays it. */
function engineParts(ctx: AnalysisContext, inputs: UserInputs): Map<string, RowParts> {
  const loans = loansOf(inputs).filter((l) => l.seriesKey !== null && !isRevolving(l.kind));
  const out = new Map<string, RowParts>();
  if (!loans.length) return out;
  const keys = loans.flatMap((l) => l.seriesKey ?? []);
  const claimed = new Set<string>();
  const debtRows = ctx.txs.filter(splittable);
  for (const loan of loans) {
    const rows = debtRows.filter((t) => !claimed.has(t.id) && paysSeries(loan.seriesKey!, { accountId: t.accountId, merchant: t.merchant, amountCents: billCents(t) }, keys));
    for (const t of rows) claimed.add(t.id);
    for (const [id, parts] of planParts(loan, rows)) out.set(id, parts);
  }
  return out;
}

/**
 * The debt service of a range as interest, repayment and unsplit. `interestCents + principalCents + unsplitCents` is
 * `spendTotals(ctx, range).debtCents`, to the cent, on every range: each row of that sum is counted once, in one part.
 */
export function debtSplit(ctx: AnalysisContext, range: DateRange, inputs: UserInputs): DebtSplit {
  const rows = spendRows(ctx, toDayRange(range)).filter((t) => t.flows.debt !== 0);
  const split: DebtSplit = { interestCents: 0, principalCents: 0, unsplitCents: 0 };
  if (!rows.length) return split;
  const parted = debtRowParts(ctx, rows, inputs);
  for (const t of rows) {
    const debt = t.flows.debt;
    if (t.category === "interest") {
      split.interestCents += debt;
      continue;
    }
    const parts = parted.get(t.id);
    if (parts === undefined) {
      split.unsplitCents += debt;
      continue;
    }
    const interest = parts.interestCents + parts.feeCents;
    split.interestCents += interest;
    split.principalCents += debt - interest;
  }
  return split;
}

/**
 * The interest and the fee of each row of `rows` that the evidence splits, in the viewer's part of the row (ADR 0016). A
 * row with no entry is unsplit. A row of category `interest` has none: it is interest as a whole.
 */
export function debtRowParts(ctx: AnalysisContext, rows: readonly AnalysisTx[], inputs: UserInputs): Map<string, RowParts> {
  const out = new Map<string, RowParts>();
  const candidates = rows.filter(splittable);
  if (!candidates.length) return out;
  const fromDocument = documentParts(ctx, inputs);
  const fromAccount = accountInterest(ctx, candidates, inputs);
  const fromPlan = engineParts(ctx, inputs);
  for (const t of candidates) {
    const parts = fromDocument.get(t.id) ?? fromAccount.get(t.id) ?? fromPlan.get(t.id);
    if (parts === undefined) continue;
    const part = rowPart(t);
    const interestCents = partCents(parts.interestCents, part);
    const feeCents = partCents(parts.feeCents, part);
    // the evidence is the bank's whole row's, and the viewer's part of it must leave room too
    if (parts.interestCents + parts.feeCents > Math.abs(billCents(t)) || interestCents + feeCents > t.flows.debt) continue;
    out.set(t.id, { interestCents, feeCents });
  }
  return out;
}
