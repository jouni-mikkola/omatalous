# 0009 Stored identifiers are frozen

Status: accepted (0.9.0, H6)

## Context

Ids and codes are stored in user data: series ids in marks, Optimoi decisions and insurance quote inputs, finding ids,
connector ids, and codes in snapshots. The series id was built in `recurring.ts` and parsed with three copies of one
regex (outcome, the Optimoi page, the rename of stored decisions). Stored codes mix Finnish and English.

## Decision

- A stored id or code keeps its spelling. Each format has one maker and one parser in core. The series id is
  `seriesId` and `parseSeriesId` in `recurring.ts`: `<in|out>:<account>:<merchant>`, then `#habit` or `#<cents>` when
  one merchant on one account has several series. Everything that reads a series id calls the parser.
- A merchant name never holds `#` or `:` (`cleanDescription` drops them), so every id the app has stored keeps its
  form. Only a name ending like a suffix would get one more `#`; `series-id.test.ts` round-trips such names and checks
  that derived names keep the stored form.
- Frozen codes, spelled as stored: certainty `korkea`, `keskitaso`, `matala`; effort `minuutteja`, `tunti`, `ilta`;
  housing types and outcome verdicts in `optimise/types.ts` and `optimise/outcome.ts`; `CheckStatus`,
  `FindingStatus`, `DismissReason`; finding ids `<area>:<kind>:<subject>`; connector ids.
- New codes are English snake_case. Module names say what they hold: `db/optimize.ts` (SQLite `PRAGMA optimize`)
  is now `db/pragmas.ts`, apart from Optimoi's `db/finance/optimise.ts`.

## Consequences

Renaming a code means a migration of user data, so it is not done for style. A new suffix or field in an id goes
through the maker and the parser, and the round-trip test fails before a stored id breaks.
