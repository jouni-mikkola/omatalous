# 11. A statement about a change needs the change to stand out from the household's own noise

## Context

The life-event kit (ADR 2) showed insights and alerts telling chance as news: the grocery insight on 118 of 200 steady
households, the spike alert on 10, seasons on 7, spending growth on 3, each against a fixed share or a six-month noise
estimate. It also showed steps of what is bought told as price rises and a yearly payment told as a stopped one.

## Decision

Every insight and alert that sets months against months passes one test in `analysis/signal.ts`: the change stands
`MIN_T` (4) standard errors from nothing, and the noise is the mean moving range of the household's own monthly series.
A step between two months adds one range, so a real change does not count itself as noise, as a window's sample
variance counts a step inside the window. Optimoi's food and habit areas use the same test. One month against its usual
level adds the level's own error; two independent years each carry `MIN_T / √2`. A detector chooses the months that
show the noise, on the series it measures: a spike two years of the category, a season the eleven months before it
with their one-offs struck, a grocery comparison every month from the first compared to the last.

Steps that change what is bought are told by one rule, `notAPrice` in `insights/prices.ts`: a phone or subscription
step over 30 % is a plan or line change, a rent step over 10 % (`isRent` in `wording.ts`, never a vastike, storage or
parking) a move, a municipal fee for kids or education follows income and hours. A last charge three times the usual
on a subscription or insurance pays months ahead (`paysAhead`); on a loan it is a payoff. The grocery comparison needs
rows on each paying account in every month compared.

## Consequences

- Insights and alerts pass the kit (`known.ts` keeps the change sentences, H4); small changes in noisy months go untold.
- A complete month's spike needs about 4 times usual with Poisson visits. On September of the 200 households MIN_T 4
  fires on 6 and tells 6 of 96 restaurant months at 2.4 times usual; 3 with a ratio floor of 2, 13 and 19; 2 with 2,
  26 and 53. No threshold tells 2.4 times within budget, so 4 stays. The kit's noise test reads running months only.
