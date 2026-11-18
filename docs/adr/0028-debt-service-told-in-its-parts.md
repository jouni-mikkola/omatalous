# 0028 The debt service told as interest, repayments and what no evidence splits

## Context

*Velanhoito* was one sum in *Tulojen käyttö*. A household that pays a mortgage instalment could not see how much of it
was the price of the loan (interest) and how much made it smaller (repayment). The bank's payment row holds both, and the
parts are known only from other evidence: the interest the connected loan account booked, or the plan of a loan the
household saved.

## Decision

`debtSplit` in `analysis/debt-split.ts` tells the debt service of a range, `PeriodTotals.debtCents`, in three sums that
add up to it to the cent: *Korot ja luottokulut*, *Lyhennykset* and *Velanhoito, erittelemättä*. Each debt row of the range
counts once, in one of them. The split is computed per request and stored nowhere.

The evidence for a row, in order:

1. The interest rows of the connected loan account on the day of the payment. The rest of the payment is repayment. When
   the payer's own account has a row of the category `interest` for that loan on the same day, the loan account's
   booking is that interest already and is not counted again.
2. The plan of a saved loan with a complete plan, whose payment series holds the row, when the row is within
   `LOAN_ROW_DAYS` of a due date and within `LOAN_ROW_TOLERANCE_CENTS` or `LOAN_ROW_TOLERANCE_SHARE` of the payment the
   plan expects, and the row is wholly debt. The interest of the interval is the schedule's, the fee of the newest
   payment part a document stated is a cost, and the rest repays.
3. Otherwise the row is not split. A row of the category `interest` is interest as a whole. A card bill and a collection
   row are never split.

A due date takes its nearest payment, the earlier on a tie. A row whose evidence leaves less than nothing to repay, and a
loan with no known rate, stay unsplit: an unknown part is never counted as 0. The check and the plan read the bank's whole
row and the whole loan, and the result is cut once to the viewer's part (ADR 0016).

*Tulos* stays cash (ADR 0014). The split moves no total. Yhteenveto shows it: the table reads Tulot, Kulutus, Korot ja
luottokulut, Velanhoito, erittelemättä (only when it is not 0), a subtotal of the income less the spending and these
costs, Lyhennykset, the rows for saving and credit, and Tulos. The cash flow report data carries the same sums, and no
page shows them there yet. A
household whose split tells no interest and no repayment sees the debt as one row, *Maksettu velanhoito*, as before.

## Consequences

Every household with rows of the category `interest` sees a different *Velanhoito* row, since those rows are now a row of
their own. Percentages of the income are rounded across more rows, so another row may move by one percent. A past
month's split moves when a balance, a linked account's balance or a fixing is updated, since the plan reads them.
