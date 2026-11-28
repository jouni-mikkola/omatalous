# 0030 Every figure is now, estimate or usual, and each kind has one look

## Context

A figure on a page is one of three kinds: what has happened (a balance today, the spending so far this month, a bill
that was paid), what the app expects (the balance on payday, the month's spending at its end, a bill that is coming) or
what is usual (the mean of earlier months, the level a figure is compared with). The kinds sat next to each other in the
same weight and colour. A reader who saw 4 553 € under "Menot" could not tell whether that much had left the accounts
or whether it was where the month was heading.

Nothing here defines a figure again (ADR 0004). The kinds change how existing figures are told.

## Decision

Every figure belongs to one kind. Each kind has one chip, one look for the figure and one look in charts and tables, on
every page.

| Kind | Chip (word) | Figure | In a chart | In a table |
| --- | --- | --- | --- | --- |
| Now (*Nyt*) | filled dark chip, with the date | text colour, semibold | solid line, filled bar, filled dot | plain |
| Estimate (*Arvio*) | dashed outline chip, with its date | accent blue | dashed line, hatched bar, hollow dashed dot, tinted band for its range | blue |
| Usual (*Tavallinen*) | plain grey word | grey, regular weight | thin grey line, or a tick on a bar | grey |

The chip's word, the line style (solid, dashed, thin) and the fill (filled, hatched, none) carry the kind, so colour is
not the only carrier. In forced-colours mode the outline and the word remain.

- The order is fixed: now, estimate, usual, left to right, in cards, table columns and legends.
- A time chart has one rule at today. Left of it is *Nyt* with the date, right of it a tinted ground named *Arvio*
  (token `--ahead-fill`, the accent at 4.5 %). Nothing solid is drawn right of the rule and nothing dashed left of it.
- An estimate shows its date and, when it has one, its range in plain form under the figure.
- A sum never mixes kinds without saying so. Where a sum crosses the line (the balance now plus bills plus estimated
  spending), each row carries its chip and the total carries the estimate's chip.
- The label of a card stays the figure's own name. The chip says the kind; the label does not repeat it.

The word for the estimate is *Arvio*, as in the glossary. *Ennuste* is not used. Laskut shows no kind cards or chips; it marks an
estimated sum with `Estimate mark="line"`.

The kind words are the messages `kind.now` and `kind.usual`, and the looks of an estimate are in
`styles/estimate.css`. No page draws a chip component any more.

## Consequences

A page that tells a figure of one kind beside another repeats a chip, so pages grow a little taller; the phone height
limits in the end-to-end tests (`bills-height.spec.ts`) keep that bounded. A figure that needs a new look has to be one of
the three kinds, or the rule changes here first. The look of a chart's past and future parts and of the tables follows
page by page, each in its own change.
