# 0004 One owner per figure (0.9.0)

## Context

The 0.9.0 code audit found figures defined twice on different bases. The buffer report and the bridge counted every
income row as usual income while the insights left out money from people and refunds, so "Kiinteät menot vievät N %
tuloista" gave two N for one household. The follow-up costed a contract at 365.25 / interval charges a year after a
decision and at the charges it saw before it, so an unchanged day care fee read as dearer. The 2 % and 10 € gate was
copied with its own base, and shared definitions lived in the module of their first caller.

## Decision

Each figure has one owner. Views compose the owner and never derive the figure again.

| Figure | Owner |
|---|---|
| Complete month | `isCompleteMonth`, `completeMonthsBefore` in `analysis/usual.ts` |
| Usual level | `usualCents` in `analysis/usual.ts`; of spending `usualSpending` there |
| Usual income | `usualIncome` in `analysis/usual.ts`, over `isEarnedIncome` in `analysis/income.ts` |
| A series' cost | `perMonth`, `monthlyCents`, `yearlyCents` of `RecurringSeries` (`recurring.ts`, worked out in `recurring-cost.ts`) |
| Gate | `gateFor`, `GATE_SHARE`, `GATE_FLOOR_CENTS` in `analysis/usual.ts` |

A definition a second caller needs moves to its owner's module (`cancelledSubjects` and `expectedCharges` to
`commitments.ts`, the fee predicates to `analysis/fees.ts`) and keeps no re-export under the old path.

## Consequences

- `packages/core/test/owners.test.ts` asserts one number for each view of usual income and the gate; repo rule 17
  keeps `365.25 /` in `recurring-cadence.ts`. A new figure names its owner in docs/MONEY_FLOWS.md.
- One-offs and net of refunds still have several definitions (audit items 4 and 14); H4 gives them owners.
