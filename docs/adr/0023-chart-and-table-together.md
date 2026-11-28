# 0023 A chart and its table are one part

## Context

[ADR 0018](0018-one-table-delete-redundant-views.md) kept a Kaavio / Taulukko choice for the accessible text form of a
chart. In use the choice hid the table until someone pressed it, and every chart answered a hover, a tap and a key in its
own way.

## Decision

There is no switch. The table stands under its chart in `ChartWithTable` (`components/table/selection.tsx`), folded in a
`<details>` that is closed until someone opens it (amended: it was always drawn). The two share one pick:

- Pointer or arrow keys move from mark to mark. The readout names the value and the comparison point, and a polite live
  region says the same to a screen reader (`charts/kit/Readout.tsx`).
- A click, Enter or Space on a mark sends its key and opens the fold. The table keeps the row with that `rowKey`, says so above
  itself and has a link to show all rows again. Escape lets go of the pick and leaves the fold as it is. A key no row has
  filters nothing.
- The fold is titled by its chart ("Kuukaudet taulukkona" for a month chart). A month chart's fold carries its row count, hidden while the fold is open. CSV stays inside.
- Columns stay on phones. The rule that drew one dot per month under 600 px is removed (`DOT_PLOT_BELOW`).
- Motion runs only under `prefers-reduced-motion: no-preference`.

## Consequences

The table is folded because an always-open 12-row table made a report twice as long as its answer, and the readout now
carries the values. On a phone the hit area of a month is its slice, about 27 px wide for 12 months at 390 px, under the
44 px tap minimum; the readout above the plot shows the pick and the arrow keys reach every month.

A chart form passes `keys` to its `ReadoutLayer`. A key is the `rowKey` of the row its mark stands for. A form made of
separate shapes (a slope's lines, the cells of a grid, a month column) takes `useMarks` or `markKey` from
`charts/kit/marks.ts`: one tab stop, arrows between marks, Enter picks, Escape lets go. A grid cell picks its row, and the way
on to Tapahtumat is a link under the grid. A part that is a table already needs no chart scope. This replaces the last sentence of the
decision of ADR 0018.

## Amendment: a span of marks

A chart whose marks are in order (the months of Raportit > Tulot ja menot, the days, weeks or months of the histogram over Tapahtumat) also picks a span, not only one mark. The kit of it is `charts/kit/span.ts`.

- Dragging across marks picks the span from the mark pressed to the mark let go. On a phone a horizontal drag picks and a vertical one scrolls the page (`touch-action: pan-y`); a tap is a span of one mark, the single pick above. Shift with the arrow keys, Home or End moves the end of the span from the focused mark. Escape lets go.
- A chart in a `ChartWithTable` sends the span as its first and last key (`selectRange` of the pick). The table keeps the rows whose `rowKey` lies between them, so the keys must sort in the order of the marks (`YYYY-MM`). The notice above the table names the first and last row and has the same way back. A span and a single pick are never held together.
- The histogram of Tapahtumat has no table in a fold: the span becomes the period of the list (`from` and `to` in the address, so back undoes it) once the pointer is let go or Enter is pressed. Escape returns to the period before the pick while that pick is the period on show.
- A month chart outside a table scope (Yhteenveto) draws no span. A click on one month still opens its rows in Tapahtumat; a drag over several does not.
- The chart adds up nothing for a span: the sum of a period is the server's (the totals of Tapahtumat for the new period).
