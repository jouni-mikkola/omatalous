# 2. Every architectural rule is a test with a shrinking baseline

## Context

Rules written only in `CLAUDE.md` or a brief drift: the 0.9.0 code audit found figures defined twice and folders that
import across their layer. Reviewers of 0.7.0 and 0.8.0 caught false findings (a second phone line read as a price rise,
a sync lag read as less spending) that green tests missed, because the same agent wrote the detector and its tests.

## Decision

An architectural rule exists as a check that runs in `pnpm check`: a repo rule in `tools/repo-rules/` (imports, sizes,
writing) or a test (the golden files of what the product says, the life-event kit, the noise budget). When the rule has
violations on the day it is written, they go into a baseline next to it, and the check fails both on a new violation and
on a baseline entry that no longer occurs. So the baseline can only shrink, and a fixed violation cannot come back.

Statements about money have three such checks: `packages/core/test/golden/` shows every change in
what the product says, `packages/core/test/kit/` runs each source on a household with and without a life event, and the
noise budget allows a two-window detector to fire on at most 1 % of 200 steady households. Their baseline is
`packages/core/test/kit/known.ts`.

## Consequences

- A rule nobody can check is not written down as a rule.
- A false finding a review catches becomes a kit event or a near miss before it is fixed.
- A baseline entry is removed by the task that fixes it, in the same commit.
