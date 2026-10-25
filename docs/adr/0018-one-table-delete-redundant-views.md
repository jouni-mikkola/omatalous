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

Delete a view nobody needs, including its code, styles, tests and texts. Do not hide it by default or offer a
setting to bring it back. A chart may keep an explicit Kaavio / Taulukko choice for its accessible text form,
which mounts only when chosen.

## Consequences

Pages supply cells instead of table markup. Shared component tests guard this boundary, and browser tests check
visibility, overflow and axe in light and night looks at 390 and 1440 px. A new table needs those checks and a
reason for the household to compare its rows, without a new set of display settings.
