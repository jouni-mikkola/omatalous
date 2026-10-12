# 0008 The bank dialect is data

Status: accepted (0.9.0)

## Context

Payee names, payment words, card issuers, lenders, tax words and card and industry codes were written into the
modules that read them: Optimoi areas, insights, alerts, the income view, the pipeline. Two lists of the same names
drifted apart. The electricity area knew LUMME and NORDIC GREEN, the rules knew LOISTE and HERRFORS, so a bill named
one way was never read the other way.

## Decision

- Word lists live in `wording.ts` behind named predicates (`isElectricitySeller`, `isNetworkCompany`, `isDaycareText`,
  `isPurchaseInterestText`, `isCardIssuerText`, `isNordeaAccount` and so on); what a loan page prints, which only
  loan-intake/ reads, is in `wording-loan-pages.ts`, and what the rules of `categorize-bank-rows.ts` read (a lender by the
  shape of its name, a cash machine's row) is in `wording-lenders.ts`. Industry (TOL) and card (MCC) codes
  live in `industry.ts` (`electricityRoleOf`, `deductibleWorkOf`, `mccKind`). `categorize.ts` keeps its rule table
  and `merchant.ts` its brands and places.
- When a rule of `categorize.ts` reads the same names as a predicate, both use one exported constant
  (`ELECTRICITY_SELLER_WORDS`, `DAYCARE_WORDS`, `PENSION_PAYER_WORDS`, `CARD_ISSUER_WORDS`, `REFUND_WORDS`, the tax
  words). Each reader keeps its own matching (whole words, a substring, a whole name).
- Where two lists of one kind disagreed, the list is their union: electricity sellers and networks, earnings pension
  companies, day care words. `packages/core/test/dialect.test.ts` holds a row for each name that was on one side only.
- Repo rule 21: an upper-case regex alternation of three or more words sits only in categorize.ts, wording.ts,
  wording-loan-pages.ts, wording-lenders.ts, industry.ts or merchant.ts. The income view's benefit words and the alert's cloud
  brands are its baseline, which only shrinks.

## Consequences

A new seller, lender or payment word is one line in one file, and every view reads it. More rows are recognised where
a union grew a list. A predicate that runs for one bank says so in its name (`isNordeaAccount`).
