/**
 * The limits of the figures: how many months make a usual level, how little makes a finding not worth a line. Each has
 * its value, its unit and why it is that value, so a reader finds the reason where the number is (ADR 0020). A limit
 * that reads "a judgement" was chosen and never measured against households; a change of one is a change of every
 * figure that reads it, so it goes with a run of `pnpm findings --golden`.
 */

type ThresholdUnit = "months" | "weeks" | "cents" | "share" | "times" | "days" | "points" | "count" | "tenths";

interface Threshold {
  value: number;
  unit: ThresholdUnit;
  /** Why the value is what it is: a source, a measurement, or the word "judgement" with the effect it has. */
  why: string;
}

const threshold = <const V extends number>(value: V, unit: ThresholdUnit, why: string): Threshold & { value: V } => ({ value, unit, why });

export const THRESHOLDS = {
  usualMonths: threshold(6, "months", "A judgement (ADR 0005): six months follow a change in the household's living within half a year, and the median of six stays put while two months are odd. It is the one period of every usual level, income included (ADR 0020)."),
  minCompareMonths: threshold(3, "months", "A judgement: under three values the median is one value or the mean of two, so no month is odd against it."),
  spendingPayees: threshold(8, "count", "A judgement: eight payees of a category fit on a screen under its months; the rest are one sum."),
  gateShare: threshold(0.02, "share", "A judgement: a cause under 2 % of its base a month is noise beside the base."),
  gateFloorCents: threshold(1000, "cents", "A judgement: under 10 € a month is too little to act on, however small the base."),
  incomeGateFloorCents: threshold(3000, "cents", "A judgement: the income findings use a floor of 30 €, three times the floor of the spending findings."),
  previousYearMonths: threshold(24, "months", "Two years: the months of a period and the same months a year before them, for the change of earned income in a year."),
  minCompositionMonths: threshold(3, "months", "A judgement: the shares of the income types need three complete months to be more than one month's accident."),
  steadySpread: threshold(0.03, "share", "A judgement: a median change under 3 % from one month to the next reads as steady income."),
  yearMonths: threshold(12, "months", "A year: the last-twelve-months column of the spending table reads at most this many whole months, and the rare bills and the bill calendar count the twelve calendar months from this one."),
  aheadDays: threshold(30, "days", "A month: the bills of Laskut and the window of Yhteenveto look this far when no payday sets the end."),
  lowPointDays: threshold(60, "days", "Two months: the lowest balance looks past the next payday to the one after it, since a payday that is a week away says little of the bills that fall in the weeks after it."),
  maxPaydayDays: threshold(45, "days", "A judgement: a payday over a month and a half away is not waited for, since a monthly pay missed by a few weeks would stretch the window over the next one."),
  minPayGapDays: threshold(15, "days", "Half a month: a monthly pay is expected at least this long after the last one. A nearer day is the last pay, which came a little off its day."),
  majorPayShare: threshold(0.5, "share", "A judgement: the smaller of two salaries is at least half of the larger and is a pay to wait for, while a child benefit is not."),
  sparseShare: threshold(0.5, "share", "A judgement (ADR 0021): a category with spending in under half of the base months is bought now and then, so its month is the mean of the months and no day of the month is its day."),
  periodicMonths: threshold(3, "months", "A bill that comes every three months or less often (quarterly, half-yearly, yearly) is paid in its own months and is expected only there (ADR 0021). One that comes every second month stays in the mean."),
  rangeLow: threshold(0.25, "share", "The lower quartile: a quarter of the base months spent less by the same day. The range is the middle half of the months (ADR 0021)."),
  rangeHigh: threshold(0.75, "share", "The upper quartile: a quarter of the base months spent more by the same day."),
  dailyPoints: threshold(2000, "days", "The chart's budget is 2 000 points a series (ENGINE 3): the balance by day of a longer range is drawn and counted over its newest 2 000 days."),
  directionMonths: threshold(12, "months", "A judgement: a year of spending holds every season once, so its mean is the household's level and not a winter's or a summer's."),
  directionRecentMonths: threshold(3, "months", "A judgement: the last three complete months are a season, long enough that one odd month does not turn the direction."),
  afterPayDays: threshold(4, "days", "The pay day and the three days after it, as the payday model (D6) counts them."),
  maxHousingStepTenths: threshold(100, "tenths", "A judgement: a rent step over 10 % (in tenths of a percent) is a move or a new contract. It is never told as a rise. A vastike really rises more."),
  maxPlanStep: threshold(0.3, "share", "A judgement: a step over 30 % is a change of plan. The bill shows no line count, so it is never told as a price rise."),
  minRiseCents: threshold(100, "cents", "A judgement: a rise under a euro is rounding or a currency move."),
  minRiseShare: threshold(0.05, "share", "A judgement: a rise under 5 % is rounding or a currency move."),
  noiseMonths: threshold(11, "months", "The noise of a season is read from up to eleven months before it: the same month a year earlier is left out, so a season does not count itself as noise."),
  seasonYears: threshold(2, "count", "One year alone cannot tell a season from chance, so a month counts only when both of the last two years were above expected (ADR 0011)."),
  moveGap: threshold(1.5, "times", "A judgement: a subscription that moved to another account starts there within one and a half intervals of its last charge on the old one."),
  newSubscriptionDays: threshold(75, "days", "A judgement: a charge that began within 75 days of the end is new, the days a monthly series needs to show plus a margin."),
  settleDays: threshold(45, "days", "A judgement: near the start of the history everything looks new, so a series needs 45 days of its account before it."),
  trialDays: threshold(45, "days", "A judgement: a trial comes at most 45 days before the first full charge."),
  trialMaxCents: threshold(200, "cents", "A judgement: a trial costs 2 € at most."),
  baseSpread: threshold(0.05, "share", "A judgement: the base of a pay step is at least three periods within 5 %."),
  levelSpread: threshold(0.02, "share", "A judgement: the new level of a pay step is at least two periods within 2 %."),
  minStepShare: threshold(0.025, "share", "A judgement: the smallest step that counts as a new level is 2,5 % of the base."),
  variableSpread: threshold(0.08, "share", "A judgement: pay whose median month-to-month change is over 8 % of its median is variable pay: a range, never a step."),
  benefitGraceDays: threshold(10, "days", "A judgement: a benefit has ended when its usual gap plus ten days passed with no payment."),
  switchDays: threshold(45, "days", "A judgement: a stop and a start within a month and a half are one change (a payer or a benefit that changed)."),
  switchPeriods: threshold(2, "count", "A judgement: a payer that stops and another that begins within two pay periods are one change of payer."),
  switchLevel: threshold(0.25, "share", "A judgement: a new payer on another account is the old one's successor only at a level within a quarter of the old level."),
  payGraceBankingDays: threshold(2, "days", "Banking days after the pay day before pay counts as missing: a weekend, a holiday, a slow sync."),
  sameUnderCents: threshold(100, "cents", "The first page prints whole euros, so a category that changed by under one euro reads as the same."),
  fixedPaymentMonths: threshold(12, "months", "A year: the payments listed under a fixed cost are the year its yearly cost stands for, so a yearly bill shows once."),
  dailyRows: threshold(8, "count", "A judgement: an account in daily use has this many rows a month on average over the months it has rows in, about two a week, so its empty month is missing rows and not a month at 0 €."),
  dailyPaidShare: threshold(0.85, "share", "A judgement: an account in daily use spends in this share of its months or more, so a savings account that pays out now and then is not one."),
  dailyMonthsShare: threshold(0.75, "share", "A judgement: an account in daily use has rows in this share of the months from its first row to its last, so an account used in spells is not one."),
  holeMonths: threshold(2, "months", "A judgement: a run of one or two empty months on an account in daily use is rows the bank or an export missed. A longer one is an account left unused for a while."),
  doubleMinCents: threshold(2000, "cents", "A judgement: under 20 € a doubled charge is not worth a question."),
  billDoubleDays: threshold(7, "days", "A judgement: a monthly bill charged again within a week is the bill and its reminder, and a later charge is the next month's."),
  moneyBackDays: threshold(120, "days", "The time a card payer has to dispute a charge, about four months: an older double charge or charge after a cancellation is no longer asked about."),
  refundWaitDays: threshold(30, "days", "A judgement: a merchant pays a refund back within a month, so a refund asked for and not seen after 30 days is asked about once more."),
  minRareBillCents: threshold(1000, "cents", "A judgement: a small yearly charge (a 2 € storage plan) is not worth a line among the rare bills."),
  loanRowDays: threshold(7, "days", "A judgement: a bank books a loan payment within a week of its due date (a weekend, a holiday), and a loan's due dates are a month or more apart, so a row is at most one due date's."),
  loanRowToleranceCents: threshold(100, "cents", "A judgement: the bank rounds an annuity and counts its interest on its own day count, so a payment differs from the plan's by cents; 1 € is room for that and none for a different payment."),
  loanRowToleranceShare: threshold(0.01, "share", "A judgement: a payment within 1 % of the plan's is the plan's payment, as the bank counted it. The larger of this and 1 € is the room, so a large loan's rounding is not read as another payment."),
} as const;

export const USUAL_MONTHS = THRESHOLDS.usualMonths.value;
export const MIN_COMPARE_MONTHS = THRESHOLDS.minCompareMonths.value;
export const SPENDING_PAYEES = THRESHOLDS.spendingPayees.value;
export const SAME_UNDER_CENTS = THRESHOLDS.sameUnderCents.value;
export const FIXED_PAYMENT_MONTHS = THRESHOLDS.fixedPaymentMonths.value;
export const GATE_SHARE = THRESHOLDS.gateShare.value;
export const GATE_FLOOR_CENTS = THRESHOLDS.gateFloorCents.value;
export const INCOME_GATE_FLOOR_CENTS = THRESHOLDS.incomeGateFloorCents.value;
export const MIN_COMPOSITION_MONTHS = THRESHOLDS.minCompositionMonths.value;
/** The comparison with the year before needs this year's months and the same number before them. */
export const PREVIOUS_YEAR_MONTHS = THRESHOLDS.previousYearMonths.value;
export const STEADY_SPREAD = THRESHOLDS.steadySpread.value;
export const SPARSE_SHARE = THRESHOLDS.sparseShare.value;
export const PERIODIC_MONTHS = THRESHOLDS.periodicMonths.value;
export const RANGE_LOW = THRESHOLDS.rangeLow.value;
export const RANGE_HIGH = THRESHOLDS.rangeHigh.value;
export const AHEAD_DAYS = THRESHOLDS.aheadDays.value;
export const LOW_POINT_DAYS = THRESHOLDS.lowPointDays.value;
export const MAX_PAYDAY_DAYS = THRESHOLDS.maxPaydayDays.value;
export const MIN_PAY_GAP_DAYS = THRESHOLDS.minPayGapDays.value;
export const MAJOR_PAY_SHARE = THRESHOLDS.majorPayShare.value;
export const DAILY_POINTS = THRESHOLDS.dailyPoints.value;
export const DIRECTION_MONTHS = THRESHOLDS.directionMonths.value;
export const DIRECTION_RECENT_MONTHS = THRESHOLDS.directionRecentMonths.value;
export const AFTER_PAY_DAYS = THRESHOLDS.afterPayDays.value;
export const MAX_HOUSING_STEP_TENTHS = THRESHOLDS.maxHousingStepTenths.value;
export const MAX_PLAN_STEP = THRESHOLDS.maxPlanStep.value;
export const MIN_RISE_CENTS = THRESHOLDS.minRiseCents.value;
export const MIN_RISE_SHARE = THRESHOLDS.minRiseShare.value;
export const NOISE_MONTHS = THRESHOLDS.noiseMonths.value;
export const SEASON_YEARS = THRESHOLDS.seasonYears.value;
export const MOVE_GAP = THRESHOLDS.moveGap.value;
export const NEW_SUBSCRIPTION_DAYS = THRESHOLDS.newSubscriptionDays.value;
export const SETTLE_DAYS = THRESHOLDS.settleDays.value;
export const TRIAL_DAYS = THRESHOLDS.trialDays.value;
export const TRIAL_MAX_CENTS = THRESHOLDS.trialMaxCents.value;
export const BASE_SPREAD = THRESHOLDS.baseSpread.value;
export const LEVEL_SPREAD = THRESHOLDS.levelSpread.value;
export const MIN_STEP_SHARE = THRESHOLDS.minStepShare.value;
export const VARIABLE_SPREAD = THRESHOLDS.variableSpread.value;
export const BENEFIT_GRACE_DAYS = THRESHOLDS.benefitGraceDays.value;
export const SWITCH_DAYS = THRESHOLDS.switchDays.value;
export const SWITCH_PERIODS = THRESHOLDS.switchPeriods.value;
export const SWITCH_LEVEL = THRESHOLDS.switchLevel.value;
export const PAY_GRACE_BANKING_DAYS = THRESHOLDS.payGraceBankingDays.value;
export const DAILY_ROWS = THRESHOLDS.dailyRows.value;
export const DAILY_PAID_SHARE = THRESHOLDS.dailyPaidShare.value;
export const DAILY_MONTHS_SHARE = THRESHOLDS.dailyMonthsShare.value;
export const HOLE_MONTHS = THRESHOLDS.holeMonths.value;
export const DOUBLE_MIN_CENTS = THRESHOLDS.doubleMinCents.value;
export const BILL_DOUBLE_DAYS = THRESHOLDS.billDoubleDays.value;
export const MONEY_BACK_DAYS = THRESHOLDS.moneyBackDays.value;
export const REFUND_WAIT_DAYS = THRESHOLDS.refundWaitDays.value;
export const YEAR_MONTHS = THRESHOLDS.yearMonths.value;
export const MIN_RARE_BILL_CENTS = THRESHOLDS.minRareBillCents.value;
export const LOAN_ROW_DAYS = THRESHOLDS.loanRowDays.value;
export const LOAN_ROW_TOLERANCE_CENTS = THRESHOLDS.loanRowToleranceCents.value;
export const LOAN_ROW_TOLERANCE_SHARE = THRESHOLDS.loanRowToleranceShare.value;
