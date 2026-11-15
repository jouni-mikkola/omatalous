# 0019 The web stack

## Context

The web app is React 19.3 and our own code. Controls, routing, the data cache and table logic have no library behind
them. The next pages need a Finnish date picker, typed search parameters in the address and virtual lists.
Without a decision each task would pick its own library. On 2026-10-25 every option was compared on the same
columns, with versions from the npm registry, and its size was measured.

## Decision

| Choice | Why | Measured gzip | Review | Trigger |
|---|---|---|---|---|
| React 19.3 with React Compiler 1.0 | Every need is met, the open problems are pages. The compiler memoises at build time. | baseline 69.0 kB, compiler 0 kB | 2027-10-25 | React's next major version |
| React Aria Components, `fi` and `en` locale files only (`@react-aria/optimize-locales-plugin`) | Keyboard, focus, screen reader and Finnish date controls. No styles of its own, so our tokens apply. | +60.7 kB for 15 controls | 2027-04-26 | a breaking change in a minor release, or no release in 6 months |
| TanStack Router, hash history (`createHashHistory`), typed search params | Filters and comparisons live in the address, typed. Each page is a lazy chunk. | +27.4 kB | 2027-04-26 | no release in 6 months |
| TanStack Query | Cache, refetch and deduplication in place of the hand-made cache in `useApi`. | +9.6 kB | 2027-04-26 | no release in 6 months |
| TanStack Table v9, headless, under `Table.tsx` | Sorting, filtering and grouping logic. The component of ADR 0018 stays the markup. | +14.6 kB | 2027-04-26 | its API changes in a minor release (v9 is from 2026-08), or no release in 6 months |
| TanStack Virtual | Only the visible rows of a long list are rendered. | +10.0 kB | 2027-04-26 | no release in 6 months |
| Own chart kit on d3 modules (scale, shape, array, time, hierarchy, sankey), continuing `apps/web/src/charts/kit` | Named lines, expected bands and the readout layer exactly as the pages need them. | scale, shape, array, time +15.6 kB, hierarchy and sankey +3.4 kB | 2027-04-26 | more than 15 chart forms, one form over 300 lines, or a d3 module with no release in 6 months |
| Plain CSS: `@layer`, `@scope`, container queries, OKLCH, `light-dark()` | No runtime and no utility classes, so every value comes from a token. | 0 kB | 2027-04-26 | a page needs a feature that is not Baseline |
| Tokens in DTCG 2025.10 format, one source file, CSS generated from it | One place to change the look. | 0 kB at runtime | 2027-04-26 | the format gets a new stable version |
| The browser's View Transitions | Page and figure changes move without an animation library. `prefers-reduced-motion` turns them off. | 0 kB | 2027-04-26 | a movement that CSS and View Transitions cannot draw |

Method: esbuild 0.28.2, minified, `gzip -9`, a test entry that imports what the app would use. Each size is added
to React and ReactDOM (69.0 kB). The numbers are from a test bundle and not the app's own. React Aria is +65.9 kB
with all languages and +94.0 kB with 21 controls. The d3 row was measured on 2026-10-26 on a base of 68.8 kB with
d3-scale 4.0.2, d3-shape 3.2.0, d3-array 3.2.4 and d3-time 3.1.0. Each library loads only on the pages that use it, through route
splitting. All of them in one bundle would be 191 kB.

## Rejected

- shadcn and Tailwind: a ready look that reads as the default of every generated app, and utility classes bypass the tokens.
- ECharts 6.1: +205.2 kB, and its own theme and accessibility layer to override.
- Recharts 3 (+119 kB) and visx 4 (+29 kB): less control than our own kit, and neither removes d3.
- Base UI 1.9: +83.3 kB for 8 controls, against React Aria's +60.7 kB for 15.
- Motion: CSS and View Transitions cover the movements the pages need.
- Svelte 5, Vue 3.5 and Solid: a rewrite of the whole web app (184 tsx files, about 23 600 lines) with nothing the user would see.

## Review

Review again: 2027-04-26, or at React's next major version, whichever comes first.

- 2027-04-26 is for charts and components. Ask whether the kit is still right, whether React Aria is worth its size and whether Table v9 has settled. Measure the main bundle and the number of chart forms. Measure the longest form and count the breaking changes of React Aria.
- 2027-10-25, the runtime: Solid 2 and Vue Vapor once stable, and what the React Compiler gave.
- Earlier, when there are more than 15 chart forms, one form's code is over 300 lines, or a chosen library has had no release for 6 months.

A chart form is a file in `charts/forms/` and its lines are that file's lines. There are 10 forms and the longest is
161 lines. Charts older than the kit (`charts/*.tsx`) move to the kit when a task touches them. `CalendarHeat.tsx`
(311 lines) is split into a form and kit parts when it moves.

## Consequences

- A library on the chosen list is added by the task that first needs it. It follows the recipe in `docs/DEVELOPMENT.md` and needs no new record. Any other library needs a new record that names this one.
- React Aria, Router, Query, Table and Virtual come with route splitting, so each lands only on the pages that use it.
- Addresses keep working. The anchor after a second `#` (`#/transactions?view=merchants#saannot`) needs a check when the router comes in.
- The look is checked by machine. A repo rule `tools/repo-rules/css-tokens.ts`, added with the look decision, refuses raw values in stylesheets. The anti-default checker (`anti_default_check.py --laji merkki --laji pino`) refuses the defaults of generated apps.
- On 2026-10-26 the checker finds 5 groups of such marks in `apps/web`. They are cream with terracotta and a deck of cards. They are also template marks, an edge stripe and violet. The look decision settles them. The look itself (direction, font, colours) is a later record.
- No package is installed and no code changes with this record.
