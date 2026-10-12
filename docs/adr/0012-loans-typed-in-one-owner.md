# 12. Loans are typed in, and each loan figure has one owner (0.8.7)

## Context

PSD2 account access covers payment accounts only, so no bank connection shows a mortgage or a consumer credit. The
household still decides with what it owes, what the debt costs a year and when it ends. Until now the only loan figures
were Optimoi's: a margin the user types and the balance of a loan account that happens to be connected.

## Decision

A loan is a `Loan` in `UserInputs`: typed, pasted or read from a picture, and confirmed by the user. It is read per
request like marks and expected bills, so saving one never reprocesses. `packages/core/src/loans.ts` owns every figure
told about a loan (ADR 4): the balance on a day, the debt total, the interest of 12 months, the payoff date, the next
payment and the payments of a month (`loanNextPayment`, `debtPaymentsPerMonth`), what a move of the reference rate does
(`loanRateScenario`), the list of the household's debts (`householdDebts`) and a credit line's use. A payment's split
into interest and amortisation (`loan-payment-split.ts`) is read by no view in this release.

- A figure that needs a field the loan lacks is null and names the field (`unknown: "rate"`). A loan whose plan lacks a
  field keeps its stated balance and says so. Nothing is estimated.
- Interest of a payment interval is balance × rate × months / 12, to the nearest cent, a half cent up. Months, since a
  loan does not say how its bank counts days.
- Due dates count back from the last due date, or forward from the balance date by whole intervals. What is left on
  the last due date falls due then.
- `paymentCents` is the whole payment for annuity and fixed instalment, and the amortisation alone for equal principal.
- Money flows do not read loans: an instalment is debt whether or not its loan is known.

## Consequences

- Reports, net worth and Optimoi compose these functions and never work a loan figure out again.
- A bank statement can differ by cents. A due day the loan does not state is placed late, so the balance errs high.
- `UserInputs.loans` is optional while callers build their inputs by hand without it; readers use `loansOf`.
