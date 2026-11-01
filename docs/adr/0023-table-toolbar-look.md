# 0023 The look of the table toolbar: pills in one row

## Context

Every table has a toolbar with a search box, filter chips with counts, a grouping menu and the CSV button
([ADR 0018](0018-one-table-delete-redundant-views.md)). The look is set by [ADR 0022](0022-look-tokens-and-font.md), so
only the shape of the row was open. Three shapes were built with the figures of the example household at 1440 and 390 px:
separate pills (A), a joined strip with a bare search line (B) and one band with text tabs (C). The household reads the
page for a few minutes, mostly on a laptop and a phone.

## Decision

Direction A "Pilleri". The search box, the chips and the buttons are separate controls with a 1 px border, as the
segmented switch of the page is. The chosen chip is filled with `--fill` and its count is in bold, so the choice is not told
by a colour alone. Row height is `--control-h`. On a phone the search takes a row of its own.

There are no cards, no gradients and no shadows. The popup of the grouping menu and of the sort choice uses the one popup
shadow of ADR 0022. Every value is a token in `styles/toolbar.css`.

B and C were rejected. B hides the search until it is touched. C breaks into rows of unequal height on a phone.

## Consequences

The look is `apps/web/src/styles/toolbar.css`. Another shape is a change of that file only. The brief and the three
directions are kept with the task report, outside the repo.
