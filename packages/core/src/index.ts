/**
 * @banking/core: pure domain logic, no I/O. Runs on Node and in the browser.
 *
 *   merchant / categorize / transfers / pipeline   raw bank rows to enriched transactions
 *   industry                                       trade register industry code to category
 *   recurring                                      subscriptions, bills, habits, income
 *   commitments                                    fixed costs, subscriptions and expected bills
 *   analysis/*                                     money flows, context, dashboard, alerts, insights
 *   reports/*                                      report registry (one file per report)
 *   optimise/*                                     Optimoi: decisions with a price or a deadline, one file per area
 */
export * from "./types.ts";
export * from "./account-use.ts";
export { holdersIn, nameOf, samePerson, userNameOf } from "./person-names.ts";
export { isEarnedIncome } from "./analysis/income.ts";
export * from "./dates.ts";
export * from "./day-bins.ts";
export * from "./stats.ts";
export * from "./categories.ts";
export { fuelPurchases, themeOf, THEMES } from "./themes.ts";
export * from "./merchant.ts";
export * from "./card-envelope.ts";
export * from "./foreign-rows.ts";
export * from "./reconcile.ts";
export * from "./local-origin.ts";
export * from "./consent-round.ts";
export * from "./categorize.ts";
export * from "./rule-key.ts";
export * from "./industry.ts";
export { householdWords, mayBePerson, nameMayBePerson } from "./payee-guard.ts";
export { type GuessCandidate, payeeGuesser } from "./payee-guess.ts";
export { companyForms } from "./wording.ts";
export * from "./transfers.ts";
export * from "./recurring.ts";
export type { Contract } from "./contract.ts";
export * from "./commitments.ts";
export * from "./loans.ts";
export * from "./household-debts.ts";
export { cardLimitCents } from "./holdings.ts";
export { buildHousing, type HousingCharge, type HousingLoan, MORTGAGE_QUESTION } from "./housing.ts";
export * from "./loan-detect.ts";
export * from "./plan-answer.ts";
export * from "./pipeline.ts";
export * from "./payer-role.ts";
export * from "./returns.ts";
export { isUnnamedMobilePay } from "./mobilepay.ts";
export * from "./analysis/flows.ts";
export * from "./analysis/bridge-view.ts";
export * from "./analysis/printed.ts";
export { isCardBill, type MissingCardPurchases } from "./analysis/card-bills.ts";
export * from "./analysis/period.ts";
export * from "./analysis/format.ts";
export * from "./analysis/context.ts";
export * from "./analysis/statement-explain.ts";
export { explain } from "./explain/explain.ts";
export { explainNow } from "./explain/now.ts";
export { explainLoan, isLoanFigure, isOneLoan } from "./explain/loans.ts";
export { createWhy } from "./explain/why.ts";
export { sentenceOf } from "./explain/catalogue.ts";
export type { Explanation, FigureId, Line, LoanFigureId, Reason, RuleId, WhyCollector } from "./explain/types.ts";
export * from "./analysis/usual.ts";
export * from "./analysis/alerts.ts";
export * from "./analysis/subscription-alerts.ts";
export * from "./analysis/fees.ts";
export * from "./analysis/credit.ts";
export * from "./analysis/insights/index.ts";
export { type DebtShare, debtShareOf } from "./analysis/insights/borrowing.ts";
export { type PriceRiseItem, priceRiseItems } from "./analysis/insights/prices.ts";
export { isLongSubscription, renewalItems } from "./analysis/insights/renewals.ts";
export * from "./analysis/dashboard.ts";
export * from "./analysis/spending-goal.ts";
export { NAMED_CATEGORIES } from "./analysis/category-totals.ts";
export type { Waterfall } from "./analysis/waterfall.ts";
export type { CategoryPart, RowParts } from "./analysis/row-parts.ts";
export { type AheadGroup, cashAhead, openingMonth, upcomingGroups } from "./analysis/ahead.ts";
export { type BillBoard, type BillBoardRow, type BillState, billMonth, billMonthOf } from "./analysis/bill-month.ts";
export { buildQuestions, QUESTION_PAYEE } from "./analysis/questions.ts";
export * from "./analysis/change.ts";
export * from "./reports/index.ts";
export * from "./features.ts";
export * from "./optimise/index.ts";
export * from "./optimise/outcome.ts";
export * from "./loan-intake/index.ts";
export * from "./card-holder.ts";
export * from "./money-trace.ts";
export * from "./money-trace-answers.ts";
export * from "./money-trace-rows.ts";
export * from "./settlement.ts";
export * from "./settlement-agreements.ts";
export { CLOSE_DAYS, monthLast } from "./settlement-ledger.ts";
export * from "./money-sources.ts";
