# 0005 One-offs and usual windows (0.9.0)

## Context

The 0.9.0 audit found five one-off rules (insights, change, Optimoi, income, alerts), so the same sofa was a one-off
on the overview and part of the level in Optimoi. Month ends, a month's length and net of refunds were written out in
a dozen files. The change sentences named the household's own noise as causes on 126 to 180 of 200 steady households,
and called a month dearer from the gap between the median of totals and the categories' medians.

## Decision

- `oneOffs(rows, policy)` in `analysis/one-offs.ts` owns one-offs. `LEVEL`: a purchase over three times its usual
  ticket (its merchant's median, else its category's in other months) and at least 50 €, or 150 € with no ticket;
  bills set the ticket and are never struck. Insights (`monthOneOffs`), the change report,
  Optimoi (`levelWithoutOneOffs`) and the spike alert use it. `PAY` is the second policy: pay is a sequence, so a
  bonus is a one-off only when the next pay is back near the usual (income.ts).
  Superseded in part by ADR 0013: the spike alert reads the change report's rows and makes no call of its own.
  `LARGE` (0.14.0) is the third policy, and the readers of `LEVEL` do not use it: a purchase bought once and told
  apart from the spending of the months. It is no row of a series (a bill, a subscription, a habit), is at least 500 €
  and over a quarter of what the rest of its category took in the twelve months around it; a row of Auton osto is one
  whatever its sum, and a loan payment, a card bill and a transfer never are. `analysis/large.ts` gives the two sets
  of a household: `largePurchases`, and `largeIncome`, a single income row over the usual income of a month that is
  no part of a series and over a quarter of what the rest of its payer paid in those twelve months.
- Dates: `monthEnd`, `dateIn`, `addMonthsToDate`, `DAYS_PER_MONTH` in dates.ts; the cadence table in recurring-cadence.ts;
  `netPurchase` and `netSpend` in context.ts; `mean` in stats.ts.
- The change report's usual level of a category is the median of complete months with one-offs struck. Its usual total
  is the month's usual spending (`usualSpendingOver`, ADR 0004), on the same days for a running month, so a month has
  one "tavallisesti"; what the categories' levels leave of it is a spread in the row Muut (0.8.4). A sentence calls a period dearer or cheaper, or names a category, only when the change stands out from
  that category's own noise (`change-signal.ts`: 24 months, a floor for rare categories, `MIN_T + 1` because a
  sentence tests every category, nothing in the first week of a month). A month a paying account's rows do not reach
  while the household's purchases fall under 75 % of their pace (`rowsComplete`: a lag, a stopped card; a closed
  card whose purchases also fell by a fifth hides the views up to 92 days), or before a late account, is not compared.

## Consequences

- The month explanation and its Tasauserä row are gone (0.8.4): Kuukausi > Viime kuu shows the change report.
  The total's noise test sets the month against the median of the base months' struck totals. Electricity strikes a
  bill only when its payee has three bills in the window.
- Rules 18 (no hand-built month end or `30.44`) and 19 (`historyCovers(` baseline) and `one-offs.test.ts` guard it.
