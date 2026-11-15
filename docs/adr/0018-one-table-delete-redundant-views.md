# 0018 One table; delete redundant views

## Context

Lists of rows had several table implementations, page-specific styles and separate phone layouts.
Wide grids scrolled inside cards, and some tables repeated another view or held only one subject's facts.

## Decision

Every list of comparable rows uses `components/table/Table.tsx` and `styles/table.css`.
It owns captions, scoped headers, opt-in sorting, groups, totals, row details and pagination.
The server supplies money totals. A narrow container turns rows into blocks and series columns into labelled
lists under their rows; no horizontal scrolling is offered. Sorting belongs only to complete lists read by size.
One subject's facts use `KeyValue`; an empty list is a sentence.

Delete a view nobody needs, with its code and everything that belongs to it. Do not hide it by default. Do not offer a
setting to bring it back. The chart-and-table switch this record first kept is gone. See [ADR 0023](0023-chart-and-table-together.md).

## Consequences

Pages supply cells instead of table markup. Shared component tests guard this boundary, and browser tests check
visibility, overflow and axe in light and night looks at 390 and 1440 px. A new table needs those checks and a
reason for the household to compare its rows, without a new set of display settings.
