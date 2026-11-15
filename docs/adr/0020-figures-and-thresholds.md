# 0020 One registry of figures, one module of limits

## Context

ADR 0004 gave each figure one definition. The names did not follow. `dueCents` meant the bills of the next days plus
regular transfers on Yhteenveto and the bills of a calendar month on Laskut. *Säännölliset tulot* was the median of six
months in the docs and of twelve months on the Tulot page. *Tavallisesti* was to give way to *Odotettu*. The limits that decide what a figure says (six months make
a usual level, a cause under 2 % of its base is noise) sat as constants in a dozen files, some with a reason and some
without.

## Decision

`packages/core/src/figures.ts` lists the figures by the name the pages show: definition, the function and field that
compute it, unit and pages. One name is one figure. Figures that differ in what they count get different names and the
definition says how they differ. Pages take the name from the registry.

`packages/core/src/thresholds.ts` holds the limits of the figures, each with its value, its unit and why. A limit that is a
judgement says so. The values did not change when they moved here. The limits of the findings move in their own task.

Two changes to the figures follow from it. *Erääntyvät maksut* is the payments of the window. A transfer to an own
account is no payment, so it left that figure and is *Siirrot omille tileille* (`transferCents`). `leavingCents` is the
two added up and *Käytettävissä* is the balance less it. The income level has one period, `USUAL_MONTHS` (six complete
months, none under `MIN_COMPARE_MONTHS`): *Tavalliset tulot* and *Säännölliset tulot* read the same months and differ in
what they count (earned income, or regular series). Six because ADR 0005 chose it for every usual level and the income
shares of the findings divide by it, so one period keeps the income level equal wherever it is read. The chart on the
Tulot page still draws the months of its range. The registry names *Odotettu*
for what the pages call *Tavallisesti* today. The pages take the name when the calculation becomes one figure.

Two repo rules keep both in place. Rule 37 refuses a name used twice and an entry whose function or field is not in its
file. Rule 38 refuses a new numeric constant in `analysis/` or `reports/`, whatever the case of its name. The constants there today are in
`tools/repo-rules/limits-baseline.txt`, a list that only shrinks.

`packages/core/test/figures.test.ts` computes every registered figure in each answer that carries it, for the demo and
seeded households on a fixed day, and holds the values equal.

## Consequences

A new figure needs an entry and an answer list in the test, or the checks fail. A new limit needs a line in
`thresholds.ts` with its reason. Moving a limit out of the baseline into `thresholds.ts` is the way the list shrinks.
