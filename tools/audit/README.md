# Self-check

`self-check.js` finds where figures that must agree do not, on a real instance, without showing anyone the
household's data. A signed-in admin evaluates the whole file in the page's console (or hands its text to a
browser tool that runs JavaScript in the page). The file is one expression that ends in a promise of a string, so
the console awaits it; where it does not, put `await ` in front.

It reads the instance's own API with GET requests only, one at a time and at most 40 in all, and writes nothing.
What it returns is one JSON string of at most 6 000 characters:

- `failures`: at most 40 lines of `code`, `where`, `expected` and `got`, the most money first. `more` counts the ones
  cut. A `where` is a scope and a month, an account as "account 1 (checking, joint)", a payee as "payee #17
  (company)" or "(person)", or a category id. Sums are cents.
- `checks`: one line per check with how many figures were compared and how many differ, and "not checked: <why>"
  where an answer was missing or older than the check expects (it never throws).

No name, IBAN, description, reference or counterparty text is ever put in the string: it holds category ids, months,
counts and sums, and every name the instance sent is blanked from it as a last guard.

## The checks

1. The front page, this month and the last, for each view the instance offers: the category rows add up to the
   spending total, no category is negative, the cumulative line stays at or above zero, the income total equals the
   income report's, and the totals equal the sums of the transaction rows.
2. Month by month, thirteen months: own transfers in equal own transfers out, the share of spending left in
   `other`, incoming rows in spending categories and outgoing rows in income categories.
3. Each account: type, balance, first and last booking day, rows per month, a gap of more than twenty days, a history
   that starts later than the other accounts'.
4. The same account, day, amount and payee under different ids. Two coffees in one day are normal; a sum in the
   hundreds is not.
5. Recurring series: a next day in the past, a next day that is the last day plus the interval while the day of the
   month varies by more than five days, subscription amounts that vary by more than a fifth, and payees the code
   proposes as a loan that is not saved in the settings.
6. Joint accounts: sums by category whole and at the viewer's part, and payments to persons and to gambling.
7. The reports against the front page, the rows and the transaction list's own sums, for this month and the last.
8. Holdings: the accounts' sum against the rows, a card without a limit, an account typed other or loan.

A transfer whose other leg is another member's account shows as a difference in check 2; the line names the accounts
that carry it.

## Trying it on made-up data

`pnpm test tools/audit` runs the file against made-up answers. On the demo household: start the app as `pnpm shots`
does (`docs/DEVELOPMENT.md`, "Pictures of a page"), load the demo, and evaluate the file in a page of that app.
