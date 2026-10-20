# 0015 A card's payment channel is derived on every run and stored nowhere (0.10.0)

## Context

A card bill is paid from another account, and nothing in the payment need say "card": the payee is the bank, the text a
reference number. The rules could tell only a bill whose text named the card. A payment that named nothing counted as
spending, and the purchases it paid counted again from the card account. A payment to the issuer's finance company, whose
name is the bank's name, was taken for a card bill by its text alone, and a loan's instalments went with it.

The bank does tell something that is certain: a payment out of one account and a payment into a connected card, with the
same sum within a few days, are one transfer. The payee of such a pair is how the household pays that card.

## Decision

The channel of a card is learned from the pairs on every run and stored nowhere (`card-channel.ts`). It is the payee's
account and the payment reference, or the payee's name and the reference when there is no account. One pair is enough for
a card issuer, or the card's own bank when its name is not shaped like a person's. Any other payee needs two. A payee whose payments are loan payments by the rule of
one reference, one contract, teaches nothing.

Once a card has a channel, a payment to it that paired with nothing is a transfer when the card's rows began more than 31
days before it, and a card bill (spending) before that, because the purchases it pays are in no row. The text of a payment
is evidence only when nothing better is known: the issuer fallback skips a card with a channel and a payee that paid credit
out. The rules of MONEY_FLOWS.md (*Card bills*) hold the details.

The channel is derived from the rows like every other category, so it moves with them. A pair that arrives later, a row
that is removed or a card connected later change the verdict on the next run, and nothing has to be repaired.

## Weighed and left

- **A stored channel**, a table of payee, reference and card made when the first pair is seen. It would be fast to read,
  and it would be wrong as soon as the history changed: a bank that changes its payment reference, a card taken out, a
  payee that turns out to be a person. It needs a migration and a way to correct it, and it is a second owner of the same
  fact (ADR 0004). A run over the history costs less than the table would cost to keep right.
- **A setting the household fills in**, "this payee pays my card". It asks for a thing the household may not know (the
  reference number is on a statement), it goes stale without a sign, and the app can read the same fact from the rows. A
  household that wants a different verdict still has a category set by hand on a row, which is never changed.

## Consequences

- Nothing is stored, so there is no migration and a rollback keeps working. The channel is part of the full run only.
  The run over one merchant's rows (`enrichIsland`) is not handed it and gives way to the full run when a row may take
  part in it, so a category or a rule changed by hand cannot leave a stored verdict that the full run would not give.
- A card paid with one fixed sum every month looks like an instalment loan and is not learned. It keeps the older rules:
  its pairs are transfers, and the others are told by the card's name in the text.
- The channel belongs to the card with the most pairs and reads only that card's first row. A household that replaced a
  card with another at the same bank has its old card's channel, and a bill of the new card in its first month is a
  transfer or a bill by that first row alone.
- A rule of the household's that sends the channel's payee to a debt, savings or *Muut* category does not hold for the
  rows that could pair. A rule to a purchase category and a category set by hand stay.

## When to think again

- When the bank's connection gives the account number of the card and the payment's reference in a field that links them
  (a virtual IBAN, a card's own reference), the channel is given and no longer learned.
- When the count of runs over the history makes the derivation a measurable cost: the channel is then a cache of the
  derived value with the data version in its key, still not a second owner.
- When households with more than one card at one bank show wrong verdicts often enough to need the channel to belong to a
  card and a period.
