# Allocating a card bill by purchase lines

Status: design note. Nothing here is built.

## The problem

A card bill from a card that is not connected is one row in the bank's data. The purchases behind it are in no category,
so the whole bill counts as debt service and the category chart shows it as one bar, Korttilaskut ilman erittelyä. A
purchase breakdown (a shop's itemised list of what one purchase held) could split such a row: a grocery purchase lists
food, cleaning products and a bag, each with its own category.

## What exists today

- A card statement the household imports (`connectors/card-file/`) itemises the bill. Its purchases count as spending in
  their own categories and the bill keeps only what they do not explain (`ctx.lowered`, `lowered` of the spending
  months report).
- The category chart names the part no purchase explains and offers the statement import beside it.
- The share of spending that has a category is `knownSpending` (`analysis/data-quality.ts`). The chart and the first
  page's Menot read that one definition, and `menot-base.test.ts` holds them together.

## Why a breakdown does not allocate a bill yet

A breakdown allocates money only if the app can prove the money it splits is the money that was spent on it. The proof
has four parts, and a design that skips one will move sums it cannot explain:

1. A payment-to-bill link. The breakdown's total and day must match one purchase on one statement, or one row paid from
   an account. A breakdown that matches a card bill only by its sum can match a bill that holds many purchases.
2. Dates. The breakdown's day is the purchase day. A bill row is dated by the issuer, often weeks later, so the split
   moves spending to the earlier month and the reports of both months change.
3. Provenance. Every allocated line records its source (a file, the day it was read, the reader that parsed it), so the
   household can see why a category changed and undo it. A category the user set stays theirs
   (`category_source = 'user'` is never overwritten).
4. Duplicate exclusion. A purchase that is on an imported statement, in a breakdown and as a bank row is one purchase.
   Counting it from two sources doubles the spending. The statement wins over the breakdown, and the breakdown wins
   over the bank row.

Until a breakdown carries all four, allocating from it would make the chart look more finished than the data is.

## What a later version needs

- A record with its total, day, shop and lines, stored per user and read only through `FinanceRepo`.
- A match step that proposes a link and asks the household to confirm it in Tarkistettavat, one item at a time.
- A rule that a confirmed breakdown lowers the bill the way a statement does: the lines count in their categories and
  the bill keeps the rest. No second spending definition: the lowered bill and the lines add up to the bill.
- Text read in the browser, with only the lines and the total sent to the install, as for statements (ADR 0025).

## Decision

1.5.0 shows the unitemised bills as their own bar and points to the statement import. It builds no reading of
breakdowns and no allocation. This note is the contract a later change has to meet.
