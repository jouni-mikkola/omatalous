# 0031 A card's debt counts against the payday figure from its bill's day

## Context

*Käytettävissä* and *Jää palkkapäivänä* took the whole debt of every connected card off at once, so a card whose bill
falls after the payday turned the figure negative although the bill is paid from the coming pay.

## Decision

`aheadBasis` (`analysis/ahead.ts`) takes a card's debt off only when it falls due before the payday:

- A card whose next bill is known (a predicted, settling or typed bill, `nextBill`) and falls after the window, which
  ends the day before the payday, has its debt in `laterCardDebts` with that day. It is taken off nothing in
  *Käytettävissä* and *Jää palkkapäivänä*. A bill on the payday itself is paid from that pay, as the window's other
  payments of that day are.
- A card with a bill in the window, one paid as it goes and one with no known bill keep their debt in `cardDebts`, taken
  off whole. With no day to put the debt on, taking it off is the safe side: the figure never shows free money the debt
  may claim. The explanation names such a card as before (`unresolved`).
- *Alin saldo edessä* (`low-point.ts`) takes a later debt off on its bill's day, in place of the bill's own row.

The runway answer carries `parts` (`runwayOf`): the balance, the bills of the window, the card bills with the debts taken
off at once, and the expected spending, each negative when it leaves the accounts. They add up to `leftCents`. The debts
told and taken off nothing are `parts.laterCards`.

Nothing here defines a figure again (ADR 0004): `freeCents` and `leftCents` stay the one definition of their figures.
