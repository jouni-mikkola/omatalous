# 0021 One expected figure, made by category and added up

## Context

The first page said "tavallisesti" and the sentence was untrue. The figure was the median of the totals of six months,
read to the same day. A median does not add up: the medians of the categories gave 2 890,57 €, the groups of the
waterfall 2 740,22 € and the month's median 3 240,72 €. The bars of the waterfall showed +84 € against a headline of
−416 €. A category bought now and then (a quarterly insurance of 142,30 €) had a median of nothing and showed a false
deviation in its month. The median lags a rising trend. The base of a comparison was not named. Food had five different
"usual" figures on five pages.

## Decision

*Odotettu* is one figure made per category. The headline is the sum of the categories, so every bar and row that
shows a month adds up to it. `packages/core/src/analysis/expected.ts` is the only place that makes it.

The method, for a month:

1. The base months are the complete months before it (`completeMonthsBefore`): up to `USUAL_MONTHS` (six), at least
   `MIN_COMPARE_MONTHS` (three). With fewer there is no figure and nothing is compared with it.
2. An ordinary category is the mean of what the base months had spent by the same day (cumulative, by day of the
   month). A rent paid on the 1st is in the figure from the 1st. Food grows day by day. The last day of the month reads
   the whole month, so a bill paid on the 31st of a base month is expected by the 28th of February.
3. A bill or subscription that comes every `PERIODIC_MONTHS` (three) months or less often is left out of the mean and
   expected whole in the month its cadence falls due, on its day. A quarterly insurance is expected in its month and in
   no other.
4. An active monthly bill or subscription stands at its latest amount. A contract holds until it changes, so a rise
   of 2 € in March is in April's figure whole, not a third of it. The latest amount stands in every base month, also
   in those before the bill began, so a new bill is not diluted by the months without it.
5. A one-off is left out of the figure and listed with it. What a one-off is has one definition, the level policy of
   `one-offs.ts` (ADR 0005), judged in the window of the base months and the month. A sofa in March does not raise the
   expectation of April.
6. The range is the lower and upper quartile (`RANGE_LOW`, `RANGE_HIGH`) of the base months' total by the same day,
   moved to the headline.
7. When the base months lack the purchases of a linked card (`cardsBreakUsual`), only the headline is true: the
   figure has no categories (`itemised: false`).

Expected income is the mean of the earned income (`earnedIncome`) of the same base months.

A mean, not a median: the categories' means add up to the mean of the totals. Rare large rows belong to the one-offs
and the periodic bills, which the method treats on their own. A series that is not spending (the savings rate, a
payer's pay) keeps its own comparison where it has its own definition. A plain series of month values uses
`expectedLevel`, the mean of them.

Every page that compares a month reads the figure:

- the waterfall and the pace chart
- the spending goal and the spike alerts
- the pivot and drift reports
- the buffer and the explain card
- the change report

In the change report a category's base is its expected figure. Its merchants keep the mean of their own months. What their bases leave of
the category is the bucket *Kuukausien vaihtelu*, which is no cause.

A page that says the figure names its base: "odotettu 2 825 € (6 kuukauden keskiarvo)". The Finnish word is *odotettu*,
for income *odotetut tulot*.

Repo rule 39 keeps the method in one place. A file in `analysis/` or `reports/` calls `expectedLevel` or the figure of
`expected.ts` and does not take its own median or mean over months. The cases that exist today and are not spending
(a pay's usual level, the price of a ticket, a card bill, a payer's median) are in `tools/repo-rules/levels-baseline.txt`,
a list that only shrinks.

## Consequences

The old median functions `usualSpending`, `usualSpendingOver` and `usualIncome` are gone, and so is the median column
of the categories report with its CSV column. The change view `usual` is `expected`. The numbers on the first page move:
the demo's October expectation is 2 156 € where the median said 2 112 €.

A bill that stops stays in the figure until the series is no longer active. A household with a new rent sees the
rise in the first month it is paid and in the figure from the next.

A category that is rare but not periodic (clothes bought twice in six months) is a third of its mean in every month. The
figure is right on average and wrong in each single month, and the change report then says the month was cheaper or
dearer than expected with no cause (`other`).
