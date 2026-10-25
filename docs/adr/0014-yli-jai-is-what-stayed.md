# 0014 Tulos is what stayed on the accounts, and borrowed money is told as borrowed (0.8.7)

## Context

*Tulos* was income − spending − saved. Credit drawn to an account was left out of it. A household with a pay of
3 000 € that drew a credit of 20 000 € and bought a car for 13 000 € read "Tulos −10 000 €" and "Menoja 10 000 €
enemmän kuin tuloja" for a month in which its accounts grew by 10 000 €. The figure was called what stayed on the
accounts and was not that, and the sentence said the household spent more than it earned without saying that the
difference was borrowed.

## Decision

*Tulos* is income + credit drawn − spending − debt service − saved. `totalsOf` in `analysis/flows.ts` owns the sum
(ADR 0004), and every view reads `PeriodTotals.leftCents`. Credit drawn stays out of income, the savings rate and the
margin: it is money on the account that is owed.

The figure is held against the rows themselves, with no flow in between. For any period it equals the sum of every row
on an account that is not a loan, less the transfer rows (a pair cancels itself, so what goes is the legs with no other
half), less the money moved into savings accounts. A card account is in the sum: a card purchase is spending on the day
it is made, so leaving cards out would break the sum by every card purchase.

A period that took more than its income is told by what covered the gap. Money has no label, so `coverOf` in
`analysis/flows.ts` applies one order: the income first, then credit drawn in the period, then money taken out of
savings, then the accounts and the connected cards. Credit goes before savings, so a month paid with both never shows
less borrowing than there was. The third cover is how far *Tulos* is below zero, and it is named for both of its
sources, *Tileiltä tai kortilta*: a card account is in the sum, so the gap may be money that was on an account or more
owed on a card, and the totals of a period hold no balance to tell them apart. No view says that money on an account
paid. What the period took is spending, debt service, money set aside and credit paid back. Drawn
money that covered nothing is in *Tulos*.

The bridge shows this as one sum on one axis: a bar of where the money went, and over it, only when the income was not
all the money, a strip of where it came from. A bar has no place for a part below zero and nothing to split without
income, so the simplest true drawing is none: the bar and its strip are drawn only when there is income and neither the
income, the spending nor the debt service is below zero. Then every part is zero or above, a zero part has no segment
and the strip and the bar are the same sum. Any other period (no income, refunds above purchases, income taken back) is
told by the table alone: every row signed, the last row *Tulos*, the same sum, and nothing as a share of the income.
The gap wears the text colour, since it is a fact of the period and no alarm.

No view works a sum out. `coverOf` gives what the drawn money left (`creditLeftCents`, `savingsLeftCents`), and
`bridgeRows` in the web gives the *Tulos* row with whether it is a share of the income, which the tile reads too.

## Consequences

- `packages/core/test/totals.test.ts` holds *Tulos* to the rows for the demo, the seeded households, the kit household
  and random rows, and the cover to its sum. `e2e/bridge.spec.ts` reads the page of a household that bought a car with credit.
- *Tulos* moves only for periods with credit drawn or paid back under *Luotonnostot*. A credit moved from a connected
  card to the current account is a transfer and moves nothing.
- A credit paid back shows only when a row is set to *Luotonnostot* by hand: a loan payment is debt service.
- The order of the covers is a rule and not a fact about which euro paid what. The bridge says how much was drawn in
  all, so the rule hides nothing. A sentence that would be true by the order alone is left out: with debt paid in the
  period, the credit line gives the credit drawn and the debt service and does not say how much of the credit is in
  *Tulos*.
- The kit event `credit-drawn` (a consumer credit, a car, two instalments) is the household with a borrowed row: the
  metamorphic test holds what the product says about it, and `totals.test.ts` holds its *Tulos* to the rows.
- Telling a card from an account needs the card accounts' change in the period, which `PeriodTotals` lacks. Until a
  later task gives it, purchases on a connected card have no cover of their own.
- Credit drawn is told by the payer's name too: money in from a lender on the lists, or from a company with finance,
  credit or loan in its name, is borrowed and not income. A payment to a payee that paid credit out is debt service,
  also when its text says nothing of lending (MONEY_FLOWS.md, *Lenders*).
