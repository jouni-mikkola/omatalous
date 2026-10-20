# 0006 Thin routes: parse, call one service, answer

Status: accepted (0.9.0)

## Context

`routes/optimise.ts` held the whole Optimoi use case: the page build, the snapshot write with its swallowed errors and
the evidence. `routes/finance.ts`, `routes/merchants.ts` and `routes/data.ts` each chose between a reprocess and a
version bump, so the invariant that every change to a user's rows moves `data_version:<user>` was spread over handlers.
Two routes cast the body with `body<T>` (`createRule: "false"` made a rule), three places checked a date with a regex
that took 2026-02-30, and each route wrote its own 404.

## Decision

- A route parses its input with `platform/validate.ts` (`strictObject`, `parse*`, `parseIsoDate`), calls one service
  and returns its JSON. Repo rule 14 refuses a request body read outside `strictObject` or a `parse*` call; a service
  that checks its body itself is named on the rule's list with the reason.
- A service owns the writes and what they invalidate: `services/rules.ts` (rules and categories set by hand),
  `services/accounts.ts` (account edits, removals, sharing, demo data), `services/optimise.ts` (the page, inputs,
  decisions, the monthly snapshot). Each decides between `reprocess` and `bumpUserDataVersion`.
- A missing or someone else's row throws `NotFound`; `app.ts` answers it once as a JSON 404.
- `contract.qa.test.ts` puts every non-GET route on one named list: moves the version (and is run to prove it), moves
  it when a row changed, read per request, or nothing the analysis reads. A new route fails until it is listed.

## Consequences

A new write starts in a service, so the version bump is written next to the write it follows. Routes import no `db/`
module (the boundary baseline is empty). A body with an unknown key is now a 400 on every route, including sign-in and
the member forms, so a client must send only the fields a route names.
