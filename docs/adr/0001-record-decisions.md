# 1. Record architectural decisions

## Context

Plans and audits live in the private repository only, and each release's plan is rewritten for the
next. A worker or reviewer who asks why a rule exists finds the answer spread over research files, hand-backs and commit
messages, or not at all. The 0.9.0 audits (J and K) found decisions that had been made twice and rules nobody could
trace.

## Decision

We keep architectural decision records in `docs/adr/`, one file per decision, numbered in the order they are made:
`NNNN-title.md` with Context, Decision and Consequences, at most 30 lines. A task that makes a decision about its area
adds the record in the same commit; its brief names the numbers. A record is never rewritten to say something else: a
later decision that changes it is a new record that names the old one.

## Consequences

- Why a rule exists is one file away from the rule, in the public repository too.
- The plan folder keeps briefs and research; the decision itself moves here when it is made.
- A record that turns out wrong stays, with the record that replaced it after it.
