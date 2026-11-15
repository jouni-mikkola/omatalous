# 0013 The spending change owns a category's month against its usual level

Status: accepted (0.8.7)

## Context

Two views told a household that a category cost more than usual: the spike alert on Kuukausi and the Menojen muutos
report. Each had its own computation. The alert set the month against the median of six raw months that the history
covered, cut at the period's days and compared with whole months, struck one-offs over two years, asked for 1.5 times
and 50 €, and tested the noise of the raw months at `MIN_T`. The report set the month against the median of complete
months with their one-offs struck (`rowsComplete`, the same days in a running month), netted returns, and named a
category over the gate that stands out at `CHANGE_T` with a floor for rare categories.

On the demo, the kit and ten seeded households (950 months) the alert fired 89 times. 17 of them were categories the
report named as well, with a different usual level in several. 72 were categories the report did not call moved, or
months it could not compare. A mortgage payoff and single large purchases raised alerts.

## Decision

The usual view of `spendingChange` owns what a category cost in a month and what it usually costs (ADR 0004).
`categoryRises` in `analysis/change.ts` gives the spike alert the rows it may tell, and the alert takes the category,
the amount and the usual level from them.

| Decided by the change computation | Where |
|---|---|
| The month a period is judged on | `changeMonths`: the month the period ends in, the running month for a period that reaches today |
| Months compared, complete months, the day a running month is cut at | `planOf`, `rowsComplete` |
| Usual level, one-offs, returns | the row of the usual view |
| Whether the category moved | `moved`: a category whose rise is over the gate and stands out. The report's bars ask the same and a cause over the gate on top (`namedCauses`); the alert sizes the rise by its purchases |
| Which categories are read | every category of the month, also one the table folds into its row of smaller ones |
| The part that is more purchases | `riseOf`: rows that are no one-off and no bill or subscription of a month or longer (`isMonthlyOrLonger`), against their own usual level, and that part stands out too |
| Season mark, highest usual month | the row, `peak` |

The alert still decides:

- The size worth a warning: the rise in purchases is at least 50 € and the gate, over half the usual level, from
  three purchases or more, and at least half of the category's whole rise.
- A spike is a peak: over every usual month. A new level is told in its first month.
- A month with the report's season mark is no surprise. Without a year of history the fixed Christmas and summer
  lists still apply.
- Uncategorised rows and debt categories never alert. Two alerts at most.

## Consequences

- An alert is always a category of the usual view with its figures: a row of the table, or a category inside the row
  of smaller ones when eight others moved further. `alerts.test.ts` holds this on seeded households.
- A rise split over causes that each stay under the gate (a new restaurant and more visits to the old one) has no bar
  in the report and still alerts: the table row shows the same rise.
- In a running month the alert reads "Tavallisesti tähän mennessä" and says nothing in the first week. When the rows
  end before today (a sync that lags), `MonthRises.through` is the day the report cuts both figures at and the alert
  names it: "201 € 10.10. mennessä", "Tavallisesti siihen mennessä noin 25 €".
- A new subscription, a bigger bill, a bill that came twice and a loan payment raise no alert. A weekly charge of
  an even amount is a habit of purchases, so more of it can.
- The spike sentences of ADR 0011 (two years of raw months at `MIN_T`) and of ADR 0005 (the alert's own call of
  `oneOffs`) no longer hold: the alert passes the report's test.
- The alert and the report speak of the same month on every period. Kuukausi, 3 kk and Vuosi that reach today show
  the running month's alert, and last month's spike shows when that month is selected. The alert used to pick the
  last complete month of a longer period, with a complete-month test of its own.
- `barsOf` in `reports/spending-change.ts` calls `namedCauses`, so the bars and the alert read one condition of a
  moved category (`moved`). `change.test.ts` holds the bars to hand-written values.
