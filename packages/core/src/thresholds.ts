/**
 * The limits of the figures: how many months make a usual level, how little makes a finding not worth a line. Each has
 * its value, its unit and why it is that value, so a reader finds the reason where the number is (ADR 0020). A limit
 * that reads "a judgement" was chosen and never measured against households; a change of one is a change of every
 * figure that reads it, so it goes with a run of `pnpm findings --golden`. The limits of the findings (`analysis/insights`) are
 * here too, under the second heading of the list.
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
  priceChangeMonths: threshold(12, "months", "A year: the household's own price change is read over the span the published index states as its annual change, so the two compare like for like."),
  minCompareMonths: threshold(3, "months", "A judgement: under three values the median is one value or the mean of two, so no month is odd against it."),
  gateShare: threshold(0.02, "share", "A judgement (H-insights, section 1): a cause under 2 % of its base a month is noise beside the base."),
  gateFloorCents: threshold(1000, "cents", "A judgement: under 10 € a month is too little to act on, however small the base."),
  incomeGateFloorCents: threshold(3000, "cents", "A judgement: the income findings use a floor of 30 €, three times the floor of the spending findings."),
  previousYearMonths: threshold(24, "months", "Two years: the months of a period and the same months a year before them, for the change of earned income in a year."),
  minCompositionMonths: threshold(3, "months", "A judgement: the shares of the income types need three complete months to be more than one month's accident."),
  steadySpread: threshold(0.03, "share", "A judgement: a median change under 3 % from one month to the next reads as steady income."),
  leadMinWeeks: threshold(8, "weeks", "A judgement: a weekday has one day a week, so under eight covered weeks it has under eight days to lead on."),
  yearMonths: threshold(12, "months", "A year: the last-twelve-months column of the spending table reads at most this many whole months."),
  conclusionRows: threshold(5, "count", "A judgement: a conclusion names its five largest parts and puts the rest in one line, so the rows fit a phone beside the figure."),
  leadShare: threshold(1.5, "times", "A judgement: a weekday's mean must be one and a half times the mean of the other days, besides standing out of the noise (`MIN_T`)."),
  aheadDays: threshold(30, "days", "A month: the bills of Laskut and the window of Yhteenveto look this far when no payday sets the end."),
  maxPaydayDays: threshold(45, "days", "A judgement: a payday over a month and a half away is not waited for, since a monthly pay missed by a few weeks would stretch the window over the next one."),
  minPayGapDays: threshold(15, "days", "Half a month: a monthly pay is expected at least this long after the last one. A nearer day is the last pay, which came a little off its day."),
  majorPayShare: threshold(0.5, "share", "A judgement: the smaller of two salaries is at least half of the larger and is a pay to wait for, while a child benefit is not."),
  sparseShare: threshold(0.5, "share", "A judgement (ADR 0021): a category with spending in under half of the base months is bought now and then, so its month is the mean of the months and no day of the month is its day."),
  periodicMonths: threshold(3, "months", "A bill that comes every three months or less often (quarterly, half-yearly, yearly) is paid in its own months and is expected only there (ADR 0021). One that comes every second month stays in the mean."),
  rangeLow: threshold(0.25, "share", "The lower quartile: a quarter of the base months spent less by the same day. The range is the middle half of the months (ADR 0021)."),
  rangeHigh: threshold(0.75, "share", "The upper quartile: a quarter of the base months spent more by the same day."),
  daysWeeks: threshold(26, "weeks", "Half a year reads at a glance and fits a phone in two rows of months."),
  dailyPoints: threshold(2000, "days", "The chart's budget is 2 000 points a series (ENGINE 3): the balance by day of a longer range is drawn and counted over its newest 2 000 days."),
  // The longer forecast (analysis/long-forecast.ts)
  forecastHistoryMonths: threshold(24, "months", "Two years: the simulation learns from at most this many complete months, so a change of living two years ago does not set the spread."),
  forecastRuns: threshold(1000, "count", "A judgement: a thousand paths put the 5th and 95th percentile within a few per cent of their limit and take a few milliseconds."),
  forecastLevel: threshold(0.7, "share", "Measured (apps/server/test/forecast-backtest.test.ts): the share of the months' spread that a path keeps as one level over all its months, so a sum of months is wider than independent draws would make it. 0.4 left the demo household at 5 of 7 three-month windows inside the range, 0.7 at 6 of 7."),
  forecastTail: threshold(0.05, "share", "Measured (apps/server/test/forecast-backtest.test.ts): the range from the 5th to the 95th percentile held the real month in 8 of 9 months of the demo and of the fake bank's household, at least 80 % with every seed tried."),
  forecastSeed: threshold(20261030, "count", "A fixed seed (the day it was set): the same rows give the same range every time the page is opened."),
  forecastYears: threshold(5, "count", "A judgement: five years show whether the net worth is going somewhere without claiming more of the rows than the household has."),
  // The findings (analysis/insights, analysis/income-changes). A finding says what it is worth over a year, so most limits are a share, a count of months or a floor in cents.
  overviewInsights: threshold(3, "count", "H-insights section 1: the overview has room for three lines before it is a list, and the owner asked for the three things worth acting on."),
  directionMonths: threshold(12, "months", "A judgement: a year of spending holds every season once, so its mean is the household's level and not a winter's or a summer's."),
  directionRecentMonths: threshold(3, "months", "A judgement: the last three complete months are a season, long enough that one odd month does not turn the direction."),
  insightReturnShare: threshold(0.25, "share", "A judgement: a dismissed finding returns when its yearly figure has moved a quarter, which is more than the rounding of a rise and less than a new situation."),
  singleMinYearlyCents: threshold(30000, "cents", "A judgement: a finding that rests on one row is shown only when it is worth 300 € a year (25 € a month). The owner called a line about a single small row dull and oddly exact."),
  singleTopRows: threshold(10, "count", "A judgement: a single row is shown only when it is among the ten largest rows of its month, so it is a sum the household knows it paid and not a stray line."),
  debtShare: threshold(0.35, "share", "A common bank limit for all loans. No authority sets a line for debt service as paid. Finanssivalvonta's 60 % is for a new mortgage at a stressed 6 % rate. A mortgage at 15 % is ordinary."),
  minFixedSharePoints: threshold(5, "points", "A judgement: a change under five percentage points of fixed costs against income is ordinary movement of pay and small subscriptions (random households reach 3)."),
  minPurchaseGap: threshold(0.05, "share", "A judgement: purchases must grow this much more than income to be told."),
  minPurchaseGrowth: threshold(0.05, "share", "A judgement: flat purchases are no news, whatever income did."),
  planMonths: threshold(3, "months", "A judgement (H-insights 16): the same amount three months in a row is an instalment plan. A single payment or a 30-day invoice is not."),
  sameAmountCents: threshold(100, "cents", "A judgement: the amounts of a plan differ by a euro at most, a fee or a rounding."),
  lastPaymentDays: threshold(45, "days", "A judgement: a plan counts while its last payment is within a month and a half of the end."),
  minInstalmentMonthlyCents: threshold(2000, "cents", "H-insights 16: instalment plans under 20 € a month are not a burden."),
  afterPayDays: threshold(4, "days", "The pay day and the three days after it, as the payday model (D6) counts them."),
  maxPaydayRows: threshold(60, "count", "The rows behind the figure: the newest cycles' after-pay rows, no more than a list can show."),
  maxHousingStepTenths: threshold(100, "tenths", "A judgement: a rent step over 10 % (in tenths of a percent) is a move or a new contract. It is never told as a rise. A vastike really rises more."),
  maxPlanStep: threshold(0.3, "share", "A judgement: a step over 30 % is a change of plan. The bill shows no line count, so it is never told as a price rise."),
  minRiseCents: threshold(100, "cents", "A judgement: a rise under a euro is rounding or a currency move."),
  minRiseShare: threshold(0.05, "share", "A judgement: a rise under 5 % is rounding or a currency move."),
  renewDays: threshold(45, "days", "A judgement (H-insights 14): a month and a half is time to cancel or to compare, and still near enough to act on."),
  minSeasonShare: threshold(0.2, "share", "A judgement (H-insights 10): a month counts when it was a fifth above the expected level in each of the last two years."),
  noiseMonths: threshold(11, "months", "The noise of a season is read from up to eleven months before it: the same month a year earlier is left out, so a season does not count itself as noise."),
  seasonYears: threshold(2, "count", "One year alone cannot tell a season from chance, so a month counts only when both of the last two years were above expected (ADR 0011)."),
  maxSmallRows: threshold(100, "count", "The rows behind the figure: the newest small purchases, no more than a list can show."),
  minSmallChange: threshold(0.3, "share", "A judgement: small purchases must move 30 % against the same months a year earlier, and clear of the noise (ADR 0011)."),
  topPayees: threshold(3, "count", "Three payees name the habit. A longer list is a table."),
  groceryMinVisits: threshold(8, "count", "A judgement: under eight visits a month the shop mean is a handful of rows."),
  groceryMinSameShops: threshold(0.7, "share", "A judgement: the shops visited in both periods must carry 70 % of the spending, so a new shop does not read as a dearer visit."),
  freedMinMonthlyCents: threshold(3000, "cents", "H-insights 8: a loan or contract that ended frees at least 30 € a month before it is news."),
  maxStoppedDays: threshold(120, "days", "A judgement: a stop is news for four months after the last payment, then it is the new normal."),
  minStoppedPayments: threshold(6, "count", "A judgement: a payment that ran for half a year is part of the household's month. A shorter one was a try."),
  prepaidFactor: threshold(3, "times", "A judgement: a charge over three times the usual one pays for months ahead (a yearly fee in place of monthly ones)."),
  refinanceDays: threshold(60, "days", "A judgement: a new payee in the same category, or a new loan payment, within two months of the last payment is a switch or a refinancing."),
  runGapIntervals: threshold(2, "times", "A judgement: a run of payments to one payee breaks at a pause of two intervals. An older loan is another run."),
  moveGap: threshold(1.5, "times", "A judgement: a subscription that moved to another account starts there within one and a half intervals of its last charge on the old one."),
  newSubscriptionDays: threshold(75, "days", "A judgement: a charge that began within 75 days of the end is new, the days a monthly series needs to show plus a margin."),
  settleDays: threshold(45, "days", "A judgement: near the start of the history everything looks new, so a series needs 45 days of its account before it."),
  trialDays: threshold(45, "days", "H-insights 13: a trial comes at most 45 days before the first full charge."),
  trialMaxCents: threshold(200, "cents", "H-insights 13: a trial costs 2 € at most."),
  yearHistoryDays: threshold(440, "days", "The year comparison of subscriptions needs the year-ago list settled: a year and the 75 days a monthly series needs to show."),
  weeksPerYear: threshold(52, "weeks", "A year of whole weeks. A weekday comes round this often."),
  baseSpread: threshold(0.05, "share", "A judgement: the base of a pay step is at least three periods within 5 %."),
  levelSpread: threshold(0.02, "share", "A judgement: the new level of a pay step is at least two periods within 2 %."),
  minStepShare: threshold(0.025, "share", "A judgement: the smallest step that counts as a new level is 2,5 % of the base."),
  variableSpread: threshold(0.08, "share", "A judgement: pay whose median month-to-month change is over 8 % of its median is variable pay: a range, never a step."),
  benefitGraceDays: threshold(10, "days", "A judgement: a benefit has ended when its usual gap plus ten days passed with no payment."),
  switchDays: threshold(45, "days", "A judgement: a stop and a start within a month and a half are one change (a payer or a benefit that changed)."),
  switchPeriods: threshold(2, "count", "A judgement: a payer that stops and another that begins within two pay periods are one change of payer."),
  switchLevel: threshold(0.25, "share", "A judgement: a new payer on another account is the old one's successor only at a level within a quarter of the old level."),
  firstPageDays: threshold(120, "days", "A judgement: a change of payer stays on the first page four months after the old payer's last payment. The income report keeps twelve."),
  payGraceBankingDays: threshold(2, "days", "Banking days after the pay day before pay counts as missing: a weekend, a holiday, a slow sync."),
} as const;

export const USUAL_MONTHS = THRESHOLDS.usualMonths.value;
export const PRICE_CHANGE_MONTHS = THRESHOLDS.priceChangeMonths.value;
export const MIN_COMPARE_MONTHS = THRESHOLDS.minCompareMonths.value;
export const GATE_SHARE = THRESHOLDS.gateShare.value;
export const GATE_FLOOR_CENTS = THRESHOLDS.gateFloorCents.value;
export const INCOME_GATE_FLOOR_CENTS = THRESHOLDS.incomeGateFloorCents.value;
export const MIN_COMPOSITION_MONTHS = THRESHOLDS.minCompositionMonths.value;
/** The comparison with the year before needs this year's months and the same number before them. */
export const PREVIOUS_YEAR_MONTHS = THRESHOLDS.previousYearMonths.value;
export const STEADY_SPREAD = THRESHOLDS.steadySpread.value;
export const LEAD_MIN_WEEKS = THRESHOLDS.leadMinWeeks.value;
export const LEAD_SHARE = THRESHOLDS.leadShare.value;
export const YEAR_MONTHS = THRESHOLDS.yearMonths.value;
export const CONCLUSION_ROWS = THRESHOLDS.conclusionRows.value;
export const SPARSE_SHARE = THRESHOLDS.sparseShare.value;
export const PERIODIC_MONTHS = THRESHOLDS.periodicMonths.value;
export const RANGE_LOW = THRESHOLDS.rangeLow.value;
export const RANGE_HIGH = THRESHOLDS.rangeHigh.value;
export const DAYS_WEEKS = THRESHOLDS.daysWeeks.value;
export const AHEAD_DAYS = THRESHOLDS.aheadDays.value;
export const MAX_PAYDAY_DAYS = THRESHOLDS.maxPaydayDays.value;
export const MIN_PAY_GAP_DAYS = THRESHOLDS.minPayGapDays.value;
export const MAJOR_PAY_SHARE = THRESHOLDS.majorPayShare.value;
export const FORECAST_HISTORY_MONTHS = THRESHOLDS.forecastHistoryMonths.value;
export const FORECAST_LEVEL = THRESHOLDS.forecastLevel.value;
export const FORECAST_RUNS = THRESHOLDS.forecastRuns.value;
export const FORECAST_TAIL = THRESHOLDS.forecastTail.value;
export const FORECAST_SEED = THRESHOLDS.forecastSeed.value;
export const FORECAST_YEARS = THRESHOLDS.forecastYears.value;
export const DAILY_POINTS = THRESHOLDS.dailyPoints.value;
export const OVERVIEW_INSIGHTS = THRESHOLDS.overviewInsights.value;
export const DIRECTION_MONTHS = THRESHOLDS.directionMonths.value;
export const DIRECTION_RECENT_MONTHS = THRESHOLDS.directionRecentMonths.value;
export const INSIGHT_RETURN_SHARE = THRESHOLDS.insightReturnShare.value;
export const SINGLE_MIN_YEARLY_CENTS = THRESHOLDS.singleMinYearlyCents.value;
export const SINGLE_TOP_ROWS = THRESHOLDS.singleTopRows.value;
export const DEBT_SHARE = THRESHOLDS.debtShare.value;
export const MIN_FIXED_SHARE_POINTS = THRESHOLDS.minFixedSharePoints.value;
export const MIN_PURCHASE_GAP = THRESHOLDS.minPurchaseGap.value;
export const MIN_PURCHASE_GROWTH = THRESHOLDS.minPurchaseGrowth.value;
export const PLAN_MONTHS = THRESHOLDS.planMonths.value;
export const SAME_AMOUNT_CENTS = THRESHOLDS.sameAmountCents.value;
export const LAST_PAYMENT_DAYS = THRESHOLDS.lastPaymentDays.value;
export const MIN_INSTALMENT_MONTHLY_CENTS = THRESHOLDS.minInstalmentMonthlyCents.value;
export const AFTER_PAY_DAYS = THRESHOLDS.afterPayDays.value;
export const MAX_PAYDAY_ROWS = THRESHOLDS.maxPaydayRows.value;
export const MAX_HOUSING_STEP_TENTHS = THRESHOLDS.maxHousingStepTenths.value;
export const MAX_PLAN_STEP = THRESHOLDS.maxPlanStep.value;
export const MIN_RISE_CENTS = THRESHOLDS.minRiseCents.value;
export const MIN_RISE_SHARE = THRESHOLDS.minRiseShare.value;
export const RENEW_DAYS = THRESHOLDS.renewDays.value;
export const MIN_SEASON_SHARE = THRESHOLDS.minSeasonShare.value;
export const NOISE_MONTHS = THRESHOLDS.noiseMonths.value;
export const SEASON_YEARS = THRESHOLDS.seasonYears.value;
export const MAX_SMALL_ROWS = THRESHOLDS.maxSmallRows.value;
export const MIN_SMALL_CHANGE = THRESHOLDS.minSmallChange.value;
export const TOP_PAYEES = THRESHOLDS.topPayees.value;
export const GROCERY_MIN_VISITS = THRESHOLDS.groceryMinVisits.value;
export const GROCERY_MIN_SAME_SHOPS = THRESHOLDS.groceryMinSameShops.value;
export const FREED_MIN_MONTHLY_CENTS = THRESHOLDS.freedMinMonthlyCents.value;
export const MAX_STOPPED_DAYS = THRESHOLDS.maxStoppedDays.value;
export const MIN_STOPPED_PAYMENTS = THRESHOLDS.minStoppedPayments.value;
export const PREPAID_FACTOR = THRESHOLDS.prepaidFactor.value;
export const REFINANCE_DAYS = THRESHOLDS.refinanceDays.value;
export const RUN_GAP_INTERVALS = THRESHOLDS.runGapIntervals.value;
export const MOVE_GAP = THRESHOLDS.moveGap.value;
export const NEW_SUBSCRIPTION_DAYS = THRESHOLDS.newSubscriptionDays.value;
export const SETTLE_DAYS = THRESHOLDS.settleDays.value;
export const TRIAL_DAYS = THRESHOLDS.trialDays.value;
export const TRIAL_MAX_CENTS = THRESHOLDS.trialMaxCents.value;
export const YEAR_HISTORY_DAYS = THRESHOLDS.yearHistoryDays.value;
export const WEEKS_PER_YEAR = THRESHOLDS.weeksPerYear.value;
export const BASE_SPREAD = THRESHOLDS.baseSpread.value;
export const LEVEL_SPREAD = THRESHOLDS.levelSpread.value;
export const MIN_STEP_SHARE = THRESHOLDS.minStepShare.value;
export const VARIABLE_SPREAD = THRESHOLDS.variableSpread.value;
export const BENEFIT_GRACE_DAYS = THRESHOLDS.benefitGraceDays.value;
export const SWITCH_DAYS = THRESHOLDS.switchDays.value;
export const SWITCH_PERIODS = THRESHOLDS.switchPeriods.value;
export const SWITCH_LEVEL = THRESHOLDS.switchLevel.value;
export const FIRST_PAGE_DAYS = THRESHOLDS.firstPageDays.value;
export const PAY_GRACE_BANKING_DAYS = THRESHOLDS.payGraceBankingDays.value;
