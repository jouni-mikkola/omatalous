/**
 * The way out of debt with extra money each month. Decision: the household decides how much more to pay a month and
 * which debt that money goes to; the plan shows when each debt ends and what it saves.
 *
 * The extra money first fills the buffer up to `debtPlanBufferMonths` of usual spending, then goes to the dearest debt
 * by its yearly cost (`debtCost`), fees in. A debt that costs nothing, or whose cost is not known, takes none. When a
 * debt ends, its payment joins the extra money. A euro goes either to the buffer or to a debt, never both: a card's debt
 * is already out of the buffer, so the plan does not count the card's payment from cash twice.
 *
 * Each payment is the loan's own (`payments` of `loan-schedule.ts`), at its rate in force, with the extra money on top,
 * so a single loan gets what `loanWhatIf` gives it for the same payment. An annuity with a rate path sets its payment
 * again when its rate changes, as `loanSchedule` does: against its last due date, and once extra money has shortened it,
 * against the earlier end a first run that keeps the payment finds, as `loanWhatIf` shortens a term.
 */
import { partCents } from "./account-use.ts";
import { addMonthsToDate } from "./dates.ts";
import { debtCost, type DebtCost } from "./debt-cost.ts";
import { type Debt, partly } from "./debt-part.ts";
import { divRound, dueDates, type Instalments, MAX_LOAN_PAYMENTS, typedPayment } from "./loan-plan.ts";
import { annuityPayment, loanSchedule, type Payment, paymentOf, payments, paymentToEnd, rateMilliAt, resetsPayment, schedulePlan } from "./loan-schedule.ts";
import { loanBalanceOn } from "./loans.ts";
import { THRESHOLDS } from "./thresholds.ts";
import type { IsoDate, Loan } from "./types.ts";

/** The buffer the extra money fills first, as Puskuri tells it: what the accounts hold net and a usual month of spending. */
interface PlanBuffer {
  netCents: number;
  spendCents: number;
}

/** When one debt ends. */
interface PlannedDebt {
  id: string;
  /** Its place in the order the extra money pays the debts, from 1. Null for a debt that takes none. */
  order: number | null;
  /** The due date that pays it with the extra money. */
  endDate: IsoDate;
  /** The same with its own payments. */
  baseEndDate: IsoDate;
}

export interface PayoffPlan {
  /** The due date that pays the last debt with the extra money. */
  debtFreeDate: IsoDate;
  /** The same with each debt's own payments. */
  baseDebtFreeDate: IsoDate;
  /** The interest and fees the extra money saves against each debt's own payments. */
  savedCents: number;
  /** The extra money that goes to the buffer before any goes to a debt. */
  bufferCents: number;
  /** The day the buffer is full; null when it needs nothing or does not fill before the debts end. */
  bufferFullDate: IsoDate | null;
  /** Every debt that owes: first those the extra money pays, in its order. */
  debts: PlannedDebt[];
  /** The interest and fees paying the smallest debt first costs more than the dearest first; a view shows it from `snowballGapCents` on. */
  snowballExtraCents: number;
}

/** One debt in the plan: where it stands and how it is paid. */
interface Lane {
  id: string;
  loan: Loan;
  plan: Instalments;
  /** The payment of the plan in force, as `payments` reads it: the whole payment, or the repayment of a plan that pays interest on top. */
  planned: number;
  /** The whole payment spread over a month: what joins the extra money when the debt ends. */
  monthly: number;
  fee: number;
  /** The yearly cost of a debt that takes extra money, null for one that takes none. */
  rateMilli: number | null;
  /** What it owed on the plan's day, the order of the smallest first. */
  owed: number;
  /** The plan's place to start: what is owed after the last due date on or before the day. */
  start: { balanceCents: number; after: IsoDate };
  /** The rate of the interval before the first payment: an annuity that `resets` sets its payment again when it changes. */
  startRateMilli: number;
  resets: boolean;
}

/**
 * A debt cut to the viewer's part as a loan of its own: the balance and the payments at that part. `debt-part.ts`
 * counts every figure on the whole loan and cuts it once; the plan is a what-if of the viewer's own money, so it runs on
 * the viewer's part, cut as `atPart` of `household-debts.ts` cuts a typed loan, and two users' figures may differ from
 * the whole by a cent of rounding.
 */
function asLoan(debt: Debt): Loan {
  const cut = partly(debt);
  if (!cut) return debt;
  const { whole, part } = cut;
  const at = (cents: number | null) => (cents === null ? null : partCents(cents, part));
  return {
    ...whole,
    balanceCents: partCents(whole.balanceCents, part),
    paymentCents: at(typedPayment(whole)),
    paymentParts: whole.paymentParts?.map((p) => ({ ...p, principalCents: partCents(p.principalCents, part), interestCents: partCents(p.interestCents, part), feeCents: partCents(p.feeCents, part) })),
  };
}

/** The whole payment of a plan's payment: with its interest, or the repayment of a plan that pays its interest on top. */
const wholePayment = (p: Payment): number => (p.interestCents ?? 0) + p.amortisationCents;

/** The lane of a debt that owes, null when it owes nothing, or the debt as unknown when it has no plan to follow. */
function laneOf(debt: Debt, day: IsoDate, cost: DebtCost): Lane | "unknown" | null {
  const loan = asLoan(debt);
  const plan = schedulePlan(loan);
  if (typeof plan === "string" || plan.rateBp === null || day < loan.balanceDate) return "unknown";
  // where the plan stands on the day, and the payment in force after it, as `loanWhatIf` starts
  let start = { balanceCents: loan.balanceCents, after: loan.balanceDate };
  let next: Payment | undefined;
  for (const p of payments(loan, plan)) {
    if (p.date <= day) start = { balanceCents: p.balanceCents, after: p.date };
    else if (next === undefined) next = p;
  }
  if (start.balanceCents <= 0) return null;
  if (next === undefined) return "unknown";
  const planned = paymentOf(plan, next);
  const takes = cost.costClass !== null && cost.costClass !== "free";
  // a fee nothing tells is that of a debt that takes no extra money: the same in every run, it moves nothing saved
  const fee = cost.feePerPaymentCents ?? 0;
  const cut = partly(debt);
  return {
    id: loan.id,
    loan,
    plan,
    planned,
    monthly: divRound(wholePayment(next), plan.months),
    fee: cut ? partCents(fee, cut.part) : fee,
    rateMilli: takes ? cost.rateMilli : null,
    owed: start.balanceCents,
    start,
    startRateMilli: rateMilliAt(loan.ratePath, plan.rateBp, start.after),
    resets: resetsPayment(loan, plan),
  };
}

/** One run of the plan: when each debt ends and what all its payments cost. */
interface Run {
  ends: Map<string, IsoDate>;
  costCents: number;
  bufferCents: number;
  bufferFullDate: IsoDate | null;
  /** What each debt owed after each of its due dates, in the order of the dates. */
  trace: { date: IsoDate; id: string; balanceCents: number }[];
}

/**
 * The debts paid due date by due date from `day`. The extra money of a month is in hand from the month's first day on
 * (the plan's day and the same day of each month after it) and pays a due date after that day. It fills the buffer's
 * gap first, then goes to the first debt of `order` that still owes, on that debt's due dates, at most what ends it.
 * `roll` adds each ended debt's payment to the extra money. A debt's payments stop once it owes nothing.
 *
 * An annuity that `resets` sets its payment again when the rate of an interval changes. Until it takes extra money it
 * aims at its last due date. After that it keeps its payment, or with `aims` (the ends of a run that kept it) the term
 * is that end: the whole payment ends the loan there and the extra money it took last time is part of it.
 */
function run(lanes: readonly Lane[], day: IsoDate, order: readonly Lane[], extraCents: number, gapCents: number, roll: boolean, aims: ReadonlyMap<string, IsoDate> | null): Run | null {
  const balance = new Map(lanes.map((l) => [l.id, { ...l.start, payment: l.planned, rateMilli: l.startRateMilli, took: 0, shortened: false }]));
  const events = lanes.flatMap((lane) => [...dueDates(lane.loan, lane.plan.months)].filter((d) => d > lane.start.after).map((date) => ({ date, lane })));
  events.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.lane) - order.indexOf(b.lane));
  const ends = new Map<string, IsoDate>();
  const trace: Run["trace"] = [];
  let costCents = 0;
  let cash = 0;
  let freed = 0;
  let month = 0;
  let bufferCents = 0;
  let bufferFullDate: IsoDate | null = null;
  for (const { date, lane } of events) {
    const at = balance.get(lane.id)!;
    if (at.balanceCents <= 0) continue;
    for (let inflow = addMonthsToDate(day, month); inflow < date && month < MAX_LOAN_PAYMENTS; inflow = addMonthsToDate(day, ++month)) {
      const income = extraCents + freed;
      const toBuffer = Math.min(income, gapCents - bufferCents);
      bufferCents += toBuffer;
      if (toBuffer > 0 && bufferCents === gapCents) bufferFullDate = inflow;
      cash += income - toBuffer;
    }
    const aim = lane.resets && at.shortened ? (aims?.get(lane.id) ?? null) : null;
    const loan = aim === null ? lane.loan : { ...lane.loan, endDate: aim };
    const rate = rateMilliAt(loan.ratePath, lane.plan.rateBp!, at.after);
    if (lane.resets && rate !== at.rateMilli) {
      if (!at.shortened) at.payment = paymentToEnd(loan, lane.plan, at.balanceCents, at.after);
      else if (aim !== null) at.payment = Math.max(0, paymentToEnd(loan, lane.plan, at.balanceCents, at.after) - at.took);
    }
    at.rateMilli = rate;
    const step = (payment: number): Payment | null => {
      const next = payments(loan, { ...lane.plan, paymentCents: payment }, { balanceCents: at.balanceCents, after: at.after }, true).next();
      return next.done ? null : next.value;
    };
    const own = step(at.payment);
    if (own === null) return null;
    const target = order.find((l) => balance.get(l.id)!.balanceCents > 0);
    const take = target === lane ? Math.min(cash, own.balanceCents) : 0;
    const paid = take > 0 ? (step(at.payment + take) ?? own) : own;
    cash -= take;
    costCents += (paid.interestCents ?? 0) + lane.fee;
    at.balanceCents = paid.balanceCents;
    at.after = date;
    trace.push({ date, id: lane.id, balanceCents: paid.balanceCents });
    at.took = take;
    if (take > 0) at.shortened = true;
    if (paid.balanceCents <= 0) {
      ends.set(lane.id, date);
      // the payment in force is freed: one an annuity set again, or the plan's own
      if (roll) freed += lane.plan.withInterest ? divRound(at.payment, lane.plan.months) : lane.monthly;
    }
  }
  // a debt the plan does not end is no plan to tell
  return ends.size === lanes.length ? { ends, costCents, bufferCents, bufferFullDate, trace } : null;
}

const latest = (ends: Map<string, IsoDate>): IsoDate => [...ends.values()].reduce((a, b) => (b > a ? b : a));

/** A run with extra money that shortens each debt as `loanWhatIf` does: first keeping each payment, then against the ends found. */
function shortened(lanes: readonly Lane[], day: IsoDate, order: readonly Lane[], extraCents: number, gapCents: number): Run | null {
  const probe = run(lanes, day, order, extraCents, gapCents, true, null);
  return probe === null ? null : run(lanes, day, order, extraCents, gapCents, true, probe.ends);
}

/** What the lanes owe on `day` and on the same day of each month after it, to the first of those days on or after `end`. */
function owedByMonth(lanes: readonly Lane[], trace: Run["trace"], day: IsoDate, end: IsoDate): number[] {
  const owed = new Map(lanes.map((l) => [l.id, l.start.balanceCents]));
  const months: number[] = [];
  let i = 0;
  for (let k = 0; k <= MAX_LOAN_PAYMENTS; k++) {
    const date = addMonthsToDate(day, k);
    for (; i < trace.length && trace[i]!.date <= date; i++) owed.set(trace[i]!.id, trace[i]!.balanceCents);
    months.push([...owed.values()].reduce((a, b) => a + b, 0));
    if (date >= end) break;
  }
  return months;
}

/** The plan of `payoffPlan` with what the debts owe on each of the months from `day` to the last of them. */
interface ExtraPlan {
  plan: PayoffPlan;
  /** What the debts owe on `day` and on the same day of each month after it, ending with the first that owes nothing. */
  owedCents: number[];
}

/**
 * The debt-free plan with `extraCents` more a month from `day`: the buffer first, then the dearest debt first (the
 * avalanche), each ended debt's payment rolled into the next. `costOf` gives each debt's cost, which the caller prices once.
 *
 * Null when no debt owes, and when a debt that owes has no plan to follow (no payment, no rate, or a plan that never
 * ends): the others alone would tell a part of the debt as all of it. A card paid in full is no debt to pay down.
 */
export function payoffPlan(debts: readonly Debt[], day: IsoDate, extraCents: number, buffer: PlanBuffer, costOf: (debt: Debt) => DebtCost | null = (debt) => debtCost(debt, day)): PayoffPlan | null {
  return extraPlan(debts, day, extraCents, buffer, costOf)?.plan ?? null;
}

/** `payoffPlan` with the way down month by month, which a chart of the extra money draws. */
export function extraPlan(debts: readonly Debt[], day: IsoDate, extraCents: number, buffer: PlanBuffer, costOf: (debt: Debt) => DebtCost | null = (debt) => debtCost(debt, day)): ExtraPlan | null {
  const lanes: Lane[] = [];
  for (const debt of debts) {
    const cost = costOf(debt);
    if (cost === null) continue;
    const lane = laneOf(debt, day, cost);
    if (lane === "unknown") return null;
    if (lane !== null) lanes.push(lane);
  }
  if (lanes.length === 0) return null;
  const takers = lanes.filter((l) => l.rateMilli !== null);
  const byCost = [...takers].sort((a, b) => b.rateMilli! - a.rateMilli! || a.owed - b.owed || a.id.localeCompare(b.id));
  const bySize = [...takers].sort((a, b) => a.owed - b.owed || b.rateMilli! - a.rateMilli! || a.id.localeCompare(b.id));
  const gapCents = Math.max(0, THRESHOLDS.debtPlanBufferMonths.value * buffer.spendCents - buffer.netCents);
  const base = run(lanes, day, byCost, 0, 0, false, null);
  const avalanche = shortened(lanes, day, byCost, extraCents, gapCents);
  const snowball = shortened(lanes, day, bySize, extraCents, gapCents);
  if (base === null || avalanche === null || snowball === null) return null;
  const rest = lanes.filter((l) => l.rateMilli === null);
  const debtFreeDate = latest(avalanche.ends);
  return {
    plan: {
      debtFreeDate,
      baseDebtFreeDate: latest(base.ends),
      savedCents: base.costCents - avalanche.costCents,
      bufferCents: avalanche.bufferCents,
      bufferFullDate: avalanche.bufferFullDate,
      debts: [...byCost, ...rest].map((l, i) => ({ id: l.id, order: l.rateMilli === null ? null : i + 1, endDate: avalanche.ends.get(l.id)!, baseEndDate: base.ends.get(l.id)! })),
      snowballExtraCents: snowball.costCents - avalanche.costCents,
    },
    owedCents: owedByMonth(lanes, avalanche.trace, day, debtFreeDate),
  };
}

/** A new loan offered for the dear debts, as the household types it. */
interface ConsolidationOffer {
  /** Hundredths of a percent, as `rateBp`. */
  rateBp: number;
  months: number;
  /** The fee of each monthly payment. */
  feeCents: number;
}

/** The dear debts a new loan could take over: what they owe and what they cost from here on. */
export interface ConsolidationBasis {
  debtIds: string[];
  /** What the debts owe on the day. */
  owedCents: number;
  /** The interest and fees of every payment the debts have left. */
  nowCents: number;
}

/** What the dear debts cost from here on, and what the same sum costs as one loan at the offer's terms. */
interface Consolidation {
  /** The interest and fees of every payment the debts have left. */
  nowCents: number;
  /** The interest and fees of the new loan's payments. */
  newCents: number;
  /** What the new loan saves: `nowCents` less `newCents`, negative when it costs more. */
  savedCents: number;
}

/**
 * The dear debts that moving into one loan would replace: shown when two debts or more are `dear` or worse, or one is
 * `very_dear`. Null otherwise, and when a dear debt's cost or balance is not known: a part would read as the whole.
 * It holds no offer, so the report works it out once and `consolidationCost` prices an offer from it.
 */
export function consolidationBasis(debts: readonly Debt[], day: IsoDate, costOf: (debt: Debt) => DebtCost | null = (debt) => debtCost(debt, day)): ConsolidationBasis | null {
  const dear = debts.flatMap((debt) => {
    const cost = costOf(debt);
    return cost?.costClass === "dear" || cost?.costClass === "very_dear" ? [{ debt, cost }] : [];
  });
  if (dear.length < 2 && !dear.some((d) => d.cost.costClass === "very_dear")) return null;
  let nowCents = 0;
  let owedCents = 0;
  for (const { debt, cost } of dear) {
    const owed = loanBalanceOn(debt, day).cents;
    if (cost.leftCents === null || owed === null) return null;
    nowCents += cost.leftCents;
    owedCents += owed;
  }
  return { debtIds: dear.map((d) => d.debt.id), owedCents, nowCents };
}

/** What the basis's debts cost from here on against one loan of what they owe at the typed terms. Null for terms that make no loan. */
export function consolidationCost(basis: ConsolidationBasis, day: IsoDate, offer: ConsolidationOffer): Consolidation | null {
  if (!Number.isInteger(offer.months) || offer.months < 1) return null;
  const { owedCents } = basis;
  const loan: Loan = {
    id: "consolidation",
    name: "",
    lender: null,
    kind: "consumer",
    grantedCents: owedCents,
    balanceCents: owedCents,
    balanceDate: day,
    rateBp: offer.rateBp,
    reference: null,
    marginBp: null,
    repayment: "annuity",
    intervalMonths: 1,
    paymentCents: annuityPayment(owedCents, offer.rateBp * 10, 1, offer.months),
    endDate: addMonthsToDate(day, offer.months),
    limitCents: null,
    seriesKey: null,
  };
  const interest = loanSchedule(loan, day).summary?.interestLeftCents;
  if (interest === undefined || interest === null) return null;
  const newCents = interest + offer.feeCents * offer.months;
  return { nowCents: basis.nowCents, newCents, savedCents: basis.nowCents - newCents };
}
