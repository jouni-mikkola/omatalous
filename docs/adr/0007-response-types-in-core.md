# 0007 Response types are declared in core

Status: accepted (0.9.0)

## Context

The web app re-declared the shapes the server sends: `web/types.ts`, the Optimoi types in
`components/optimise/shared.tsx` and `pages/Merchants.tsx`. Nothing checked that a copy matched the code that built
the response, so a field renamed on the server broke the page at run time only. The web app already imports core
(`@banking/core`), and core is the one package both sides share.

## Decision

- A new response type is declared in core beside the function that builds it. When a server service puts the response
  together from core parts (the Optimoi page and its evidence), the type sits in core beside those parts
  (`optimise/types.ts`: `OptimiseResponse`, `EvidenceResponse`, `InputRow`), the service declares it as its return
  type and the web app imports it from `@banking/core`.
- A report carries what the page needs to say about it: thresholds such as the months of history a part waits for
  (`IncomeReport.needs`, drift's `neededMonths`) and derived figures such as `earnedChange`. Repo rule 16 refuses a
  month count or a limit written into a web sentence about history.
- An existing hand-written copy moves when a task touches its route. The rest move with the tasks that touch them.

## Consequences

The compiler checks the server and the web app against one declaration. Core gains types that describe HTTP bodies;
they stay plain data (no Hono, no fetch), so core stays pure. `web/types.ts` and `pages/Merchants.tsx` still hold
copies until their routes are worked on.
