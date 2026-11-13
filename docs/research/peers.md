# Peer finance apps: what they do better

Research for OMAT-8, read on 9 November 2026. Every claim links its source. Where no source was found, the
section says so and makes no claim. Line counts are `git ls-files` of the named commit piped to `wc -l`, tests and
docs left out unless the line says otherwise. Written to sit beside `docs/audit/simplify.md` (OMAT-7).

Omatalous for comparison: 109 279 lines of TypeScript outside tests and 109 489 in tests (this branch, commit
593448c), 30 migrations, 103 page files under `apps/web/src/pages`, of them 50 under `settings/`. Money is integer
cents (`amount_cents INTEGER` in [0001_init.sql](../../apps/server/migrations/0001_init.sql)). A PSD2 row keeps the
bank's `entry_reference` or `transaction_id` as its id, else none
([mapper.ts](../../apps/server/src/connectors/enable-banking/mapper.ts)).

## 1. Sure (the community fork of Maybe Finance)

The owner asked for this one first and in most depth.

### What it is and how alive it is
- Sure is a community fork of Maybe Finance, whose company stopped work; Maybe is archived and Sure keeps the code
  alive ([README][sure-readme], [Maybe final release][maybe-final]). Maybe's repository is archived since July 2025
  with 54 197 stars ([GitHub API][api-maybe]).
- Sure: 11 129 stars, 866 open issues and pull requests, last push 8 November 2026, AGPL-3.0 ([GitHub API][api-sure]);
  391 commits from 9 October to 8 November 2026 ([commits][sure-commits]).

### Stack and size
- Rails 8.1, PostgreSQL, Redis, Sidekiq, Turbo, Stimulus, Tailwind and `ruby-openai` ([Gemfile][sure-gemfile]).
- At commit 0cb3284: 207 357 lines of Ruby in `app/` and `lib/`, 48 589 of ERB views, 18 905 of JavaScript in
  `app/`, 277 600 lines of tests ([repo][sure-repo]). That is about 2.5 times omatalous outside tests.
- About 30 bank and broker providers each have an `*_item`, `*_account` and `*_entry` model: Plaid, SimpleFIN,
  Enable Banking, TrueLayer, Wise, Monobank, Mercury, Up, Trade Republic, Kraken and more ([models][sure-models]).

### Data model
- `accounts` hold a `balance` and `cash_balance` as `decimal(19,4)`, a `currency`, and a stored virtual
  `classification` that is `liability` for loans, credit cards and other liabilities and `asset` otherwise
  ([schema][sure-schema]).
- `entries` are the one ledger row: `account_id`, `amount decimal(19,4)`, `currency`, `date`, an `entryable`
  (a transaction, a valuation or a trade), `excluded`, `external_id`, `source`, `import_id`, `import_locked`,
  `locked_attributes`, `reconciled_at` ([schema][sure-schema]).
- Two unique indexes stop a twin row: `(account_id, source, external_id)` and `(account_id, idempotency_key)`
  ([schema][sure-schema]).
- A `valuation` is an entry that sets an account's value on a date, with a `kind` enum ([valuation.rb][sure-valuation]).
- `balances` is one row per account, day and currency with start balance, inflows, outflows, adjustments and market
  flows, and the end balance as a stored generated column ([schema][sure-schema]).
- Money in Ruby is a `Money` object over `BigDecimal` ([money.rb][sure-money]).
- The Enable Banking id is the bank's `transaction_id` or `entry_reference`. When the bank gives neither (both are
  optional in PSD2), Sure hashes date, amount, currency, direction, creditor, debtor and remittance text into a
  content id, and keeps the ids a row was stored under before ([processor.rb][sure-eb-id]).
- Every field a user changes is locked (`locked_attributes`); enrichment and rules skip a locked field unless a rule
  is re-applied by hand ([enrichable.rb][sure-enrichable]).
- Rules have conditions, actions, groups and runs ([rule.rb][sure-rule]). Actions: set category, merchant, name or
  tags, exclude, mark as transfer, split, e-mail, AI categorise, a Bayes classifier with no AI, detect merchants
  ([action executors][sure-actions]).
- Imports: CSV transactions, accounts, categories, merchants, rules, trades, PDF, QIF, and files of Mint, YNAB,
  Actual and Sure itself ([models][sure-models]).
- Budgets, budget categories, goals and pledges are models of their own ([models][sure-models]).

### Home screen
- The dashboard is sections the user can hide and reorder: cash-flow Sankey, money flow, spending trend, outflows
  donut, investment summary, net worth chart, balance sheet and an insights feed ([pages_controller.rb][sure-dash]).
- A user on the intro layout lands on the AI chat instead of the dashboard ([pages_controller.rb][sure-dash]); the
  README picture is the dashboard beside the assistant ([README][sure-readme]).

### Issues seen
- Enable Banking card payments get the cardholder's name as the merchant ([#4788][sure-4788]), the same trap
  omatalous guards with `isLookupName` and `mayBePerson`.
- SimpleFIN sync fails for good after about 15 days without a successful sync ([#4790][sure-4790]).
- Users ask to split a loan payment into principal and insurance ([#4784][sure-4784]).

### Adopt, avoid, run or fork
- Adopt the content id for rows with no bank id. Omatalous stores `null` then
  ([mapper.ts](../../apps/server/src/connectors/enable-banking/mapper.ts)); Sure's hash plus its list of superseded
  ids ([processor.rb][sure-eb-id]) gives a refetch nothing to double.
- Adopt a unique index as the last guard against twins, as Sure's two partial indexes do ([schema][sure-schema]).
- Adopt per-field locks as a pattern. Omatalous already never overwrites `category_source = 'user'` (CLAUDE.md);
  Sure extends the same rule to name, merchant and tags ([enrichable.rb][sure-enrichable]).
- Copy the idea of a "Bayes classifier with no AI" rule action ([bayes_categorize.rb][sure-actions]) for the rows
  the word lists miss, trained only on the household's own answers.
- Avoid: an AI chat as a home, which the roadmap rules out (no cloud language model, no free-text questions), and a
  dashboard of hideable sections, where omatalous deletes a view instead ([pages_controller.rb][sure-dash],
  [ROADMAP.md](../ROADMAP.md)).
- Avoid: 30 providers, each three models wide ([models][sure-models]); one PSD2 aggregator plus statement files
  covers the Finnish banks.
- Run or fork: no. Sure is Rails, PostgreSQL, Redis and Sidekiq ([Gemfile][sure-gemfile]) against a single Node
  process with SQLite here, and it keeps money in `decimal` ([schema][sure-schema]) where omatalous has integer cents.
  Its Enable Banking client is the one part that does the same job; omatalous already has that, and Sure's issue list
  shows the same bank quirks (#4788).
- AGPL-3.0 means we may read, run, change and copy its code into omatalous, which is AGPL-3.0-only itself
  ([LICENSE](../../LICENSE)), as long as the combined work stays AGPL and keeps Sure's copyright notices; users who
  reach it over a network get the source ([AGPL-3.0 text][agpl]). Copying an idea needs no licence at all.

## 2. The other peers

### Actual Budget (open, MIT)
- Model: envelope budgeting; you budget only money you already have, and categories are funds you fill, with
  rollover ([docs][actual-budgeting]). A tracking budget is the other mode (`tracking.ts`, [repo][actual-budget-dir]).
- Import and sort: rules run on every imported or synced row and can clean the payee and set the category
  ([rules][actual-rules]). Bank sync uses GoCardless or SimpleFIN with your own keys, through the server
  ([bank sync][actual-banksync]).
- Guards: amounts are integers (`amountToInteger`, [util.ts][actual-util]); a synced row keeps the bank's id as
  `imported_id`, and the matcher refuses to overwrite one row's `imported_id` with another's ([sync.ts][actual-sync]).
  Reconciling compares the cleared balance with the bank's and locks the rows ([reconciliation][actual-reconcile]).
- Size: 265 490 lines of TypeScript and JavaScript outside tests and docs at commit 7d4c526 ([repo][actual-repo]);
  30 095 stars, 200 open issues ([GitHub API][api-actual]).
- Praise: free, fast because local ([Finny][finny-actual]), one container ([Self Host Life][selfhostlife]). Complaints: the server keeps no backups of its own and
  bank sync is manual and paid ([Self Host Life][selfhostlife]); depth closer to a spreadsheet ([Finny][finny-actual]).

### Firefly III (open, AGPL-3.0)
- Model: double-entry accounts, its defining feature and biggest barrier ([expensesorted][ff-review]), though not
  full double entry ([Ballard][ff-ballard]).
- Import and sort: rules with triggers and actions ([rules][ff-rules]); a separate Data Importer, kept apart for
  security and maintenance, reads files or a bank aggregator ([importer][ff-importer]).
- Size: 163 827 lines of PHP in `app/` and 39 829 in `resources/` at commit d65e916 ([repo][ff-repo]); 25 177 stars,
  189 open issues ([GitHub API][api-ff]).
- Complaints: the learning curve ([expensesorted][ff-review]); an open issue asks the importer to stop overwriting
  the original currency ([#13163][ff-13163]).

### YNAB (closed)
- Model: money lands in Ready to Assign, you assign it to categories until it is zero, spending lowers Available
  ([basics][ynab-basics]).
- Import: a linked account brings only today's cleared balance; rows from today on come in one by one
  ([FAQ][ynab-faq]). Amounts are integer milliunits in the API, and an imported row gets an `import_id` that is
  matched to a hand-entered row of the same amount within 10 days ([API spec][ynab-api]).
- Reconcile compares YNAB's balance with the bank's and can add an adjustment ([reconcile][ynab-reconcile]).
- Complaints: no free tier, $109 a year, raised from $50 at launch ([shouldiuse][ynab-price]).

### Monarch Money (closed)
- Model: a household dashboard of budgets, cash flow, net worth, investments, goals and subscriptions, with
  unlimited collaborators ([DollarScout][monarch-ds]).
- Sort: automatic categories, then rules on statement text, merchant and amount that rename, recategorise and tag
  ([rules][monarch-rules]). Bank links through Plaid, MX and Finicity ([DollarScout][monarch-ds]).
- Complaints: syncs paused for two-factor prompts, bill payments shown like refunds ([NerdWallet][monarch-nw]).

### Copilot Money (closed)
- Sort: a model trained on your own reviewed rows, on only after 30 reviews ([Intelligence][copilot-ml]).
- Complaints: Apple only, no Android or full web, which blocks a mixed household ([envelopebudgeting][copilot-apple]).

### Lunch Money (closed)
- Rules are conditions and actions, and can e-mail on new rows ([rules][lm-rules]). A synced row starts unreviewed,
  and a rule can mark it reviewed ([status][lm-status]).
- Web first, CSV and PDF import, multi-currency, budgets that roll over ([budgetingapps][lm-review]).

### Plain-text accounting: hledger, Beancount, Ledger
- hledger reads a bank CSV through a small rules file of `fields`, `skip`, `if` and `account2` lines
  ([tutorial][hl-csv]). `import` remembers the last date it took from each file and skips older rows
  ([Import.md][hl-import]). GPL-3.0 ([LICENSE][hl-license]); 72 194 lines of Haskell at commit 5b22de2
  ([repo][hl-repo]).
- Beancount uses `Decimal` for every number ([number.py][bc-number]) and `balance` assertions that fail the file when
  an account's balance on a date differs ([syntax][bc-syntax]). GPL-2.0 ([GitHub API][api-bc]); 25 386 lines of
  Python outside tests at commit 9747213 ([repo][bc-repo]).
- Ledger (6 067 stars, no standard licence id on GitHub, [API][api-ledger]) and GnuCash were not read further.

### Finnish and Nordic
- A Finnish 2026 comparison ranks Bilance first because it fetches rows from the bank and sorts them itself
  ([Plus1][plus1]).
- Borderless Budget says it connects OP, Nordea, S-Pankki and Aktia ([Borderless][borderless]).
- Spiir, a Danish app, came to Finland in 2021 ([Puhelinvertailu][spiir]). Its state today was not checked.
- No open-source Finnish peer was found. Sure has an Enable Banking connector ([models][sure-models]), so "PSD2 to
  Finnish banks through Enable Banking" is not unique to omatalous.

## 3. Omatalous against the peers

### What omatalous does that none of the peers does (as far as their sources show)
- Five flows with card bills counted as transfers when the card account is connected ([MONEY_FLOWS.md](../MONEY_FLOWS.md)).
  The peers sort by category or by double-entry accounts ([Actual][actual-budgeting], [Firefly][ff-review]).
- Money available until the next payday after the bills due before it ([README](../../README.md)).
- A joint account split by who paid into it, and a ledger of who owes whom ([README](../../README.md)). Monarch
  offers collaborators on one view ([DollarScout][monarch-ds]), not shares of one account.
- Statements, CSV, camt.053 and loan screenshots read in the browser, only rows sent ([ROADMAP.md](../ROADMAP.md)).
- Trade register lookup of business names under a privacy door (CLAUDE.md).
- A test that every connected balance equals opening plus rows to the cent ([ROADMAP.md](../ROADMAP.md)).
- Notices of what a figure leaves out, with the sum ([ROADMAP.md](../ROADMAP.md)).

### What the peers do that omatalous lacks
- Tags: Sure ([rules actions][sure-actions]) and Monarch ([rules][monarch-rules]) tag rows; the omatalous
  migrations have no tag table (`grep tags apps/server/migrations` finds none).
- A split of one row into parts: Sure ([actions][sure-actions]) and its users want it for loan payments
  ([#4784][sure-4784]). Omatalous splits an account between members, not a row.
- Import from another app: Sure reads Mint, YNAB and Actual files ([models][sure-models]). Omatalous reads only its
  own export and bank or card statements (CLAUDE.md).
- A learning sorter trained on the user's answers: Copilot ([Intelligence][copilot-ml]), Sure's Bayes action
  ([actions][sure-actions]). Omatalous has word lists and rules (CLAUDE.md).
- A visible "reviewed" state per row: Lunch Money ([status][lm-status]), YNAB's approved flag ([API][ynab-api]).
  Omatalous asks questions in Tarkistettavat but marks no row as seen.
- Mobile apps: Copilot ships on iPhone, iPad and Mac ([envelopebudgeting][copilot-apple]) and Actual has a
  `mobile-client` package ([repo][actual-repo]); omatalous rules a native app out ([ROADMAP.md](../ROADMAP.md)).

### Where omatalous is more complex than the simplest peer for the same job
- Install and keep running: Actual is one container with no database beside it ([Self Host Life][selfhostlife]);
  omatalous has an install script, a host helper, an update with a time budget, a watchdog, rollbacks and offsite
  backup ([ROADMAP.md](../ROADMAP.md)). Part of that buys what Actual lacks (backups, [Self Host Life][selfhostlife]).
- Bank file import: hledger needs a rules file of a few lines per bank ([tutorial][hl-csv]); omatalous has three
  readers (card file, bank CSV, camt.053) and two connectors ([ROADMAP.md](../ROADMAP.md)).
- Settings: 50 files under `apps/web/src/pages/settings`, 8 of them for remote access alone. YNAB starts with
  "add your spending account and any credit card" ([getting started][ynab-start]).
- Reconciling: YNAB and Actual have one reconcile button per account ([YNAB][ynab-reconcile],
  [Actual][actual-reconcile]); omatalous has a reconcile card plus balance checks, coverage notices and Tietojen laatu
  ([ROADMAP.md](../ROADMAP.md)), which all answer "can I trust this figure".
- Reports: seven question pages with sections, conclusions and a savings-tip engine ([README](../../README.md));
  Sure's home is eight sections ([pages_controller.rb][sure-dash]).

## 4. Reuse: what to take from the open ones

| Project | Licence | What it means for us | Worth taking |
|---|---|---|---|
| Sure | AGPL-3.0 ([API][api-sure]) | code may be copied into omatalous (AGPL-3.0-only) with notices kept ([AGPL][agpl]) | content id for id-less PSD2 rows, unique-index guard, field locks, Bayes rule action, as patterns |
| Actual | MIT ([LICENSE][actual-license]) | copy anything with the copyright notice | the `imported_id` matching and its tie rule ([sync.ts][actual-sync]); reconcile lock ([docs][actual-reconcile]) |
| Firefly III | AGPL-3.0 ([API][api-ff]) | as Sure | keeping the importer apart from the ledger ([importer][ff-importer]) as an idea; PHP, no code fit |
| hledger | GPL-3.0 ([LICENSE][hl-license]) | GPL code copied in would make the whole GPL-3.0-compatible work; AGPL-3.0 may be combined with GPL-3.0 code ([GPL FAQ][gpl-faq]) | the CSV rules-file format as the shape of a saved column match |
| Beancount | GPL-2.0 ([API][api-bc]) | GPL-2.0-only code cannot be combined with AGPL-3.0 ([GPL FAQ][gpl-faq]); ideas only | balance assertions as a data type |

- Build on one of them: no. None reads the Finnish bank dialect, splits a joint account or keeps integer cents with
  SQLite; the nearest, Sure, is a different stack ([Gemfile][sure-gemfile]) and keeps `decimal` money
  ([schema][sure-schema]).
- Charts: Sure's Sankey is a pattern for the five flows, not a library to take ([pages_controller.rb][sure-dash]).

## 5. Why an AI-built finance app tends to be buggy and odd

- AI co-authored pull requests had 1.7 times the issues of human ones, 10.83 against 6.45 per pull request, in 470
  open-source pull requests ([CodeRabbit][coderabbit]).
- Cloned code grew fourfold and copy-paste passed moved code for the first time in 211 million changed lines of
  2020 to 2024 ([GitClear][gitclear]),
  which in a finance app means the same figure computed twice and drifting apart.
- Floats cannot hold 0.1 or most cents exactly, so sums of money in floats drift ([Stack Overflow][so-float],
  [Atomic Object][ao-float]). Guards: integer milliunits in YNAB ([API][ynab-api]), integers in Actual
  ([util.ts][actual-util]), `Decimal` in Beancount ([number.py][bc-number]), `decimal(19,4)` in Sure
  ([schema][sure-schema]).
- Dates: days are not always 24 hours and a machine's zone is not fixed ([falsehoods][time-falsehoods]). Guards: a
  `date` column with no time in Sure ([schema][sure-schema]) and `YYYY-MM-DD` strings in omatalous (CLAUDE.md).
- Duplicate imports: PSD2 ids are optional, so a refetch can double rows ([processor.rb][sure-eb-id]). Guards: bank
  ids plus a content hash and a unique index (Sure), `imported_id` (Actual, [sync.ts][actual-sync]), `import_id`
  (YNAB, [API][ynab-api]), the last date per file (hledger, [Import.md][hl-import]).
- Categories that drift: automation overwrites what the user set. Guards: field locks ([Sure][sure-enrichable]),
  rows that start unreviewed ([Lunch Money][lm-status]), a learner that waits for 30 reviews ([Copilot][copilot-ml]).
- Totals that do not match the bank. Guards: reconcile with a lock ([Actual][actual-reconcile], [YNAB][ynab-reconcile])
  and balance assertions ([Beancount][bc-syntax]).
- Too many screens: an agent adds a view per request. Sure's answer is hideable sections ([dash][sure-dash]);
  omatalous counts opened views and deletes the unopened ones (T11 in [ROADMAP.md](../ROADMAP.md)).

## 6. Fifteen ranked moves

Each: the move, its source, the gain, and done when (with the test).

1. Adopt a content id for PSD2 rows with neither `entry_reference` nor `transaction_id` ([processor.rb][sure-eb-id]).
   Gain: no doubled rows from banks that send no id. Done when: a server test fetches id-less rows twice, stores once.
2. Adopt a partial unique index on `(account_id, external_id)` ([schema][sure-schema]). Gain: the database refuses a
   twin the code misses. Done when: a migration test inserts a twin and gets a constraint error.
3. Keep the ids a row was stored under before ([processor.rb][sure-eb-id]). Gain: no twins after a new consent
   renumbers rows. Done when: a test changes a row's id between two fetches and stores one row.
4. Field locks beyond the category: automation never rewrites a field the user wrote ([enrichable.rb][sure-enrichable]). Gain: no drift after a rule change. Done when: a `flows.test.ts` scenario
   reprocesses after a new rule and the user's merchant name stays.
5. A classifier trained only on the household's own answers, for rows no word list or rule takes, off until 30
   answers ([Sure Bayes][sure-actions], [Copilot][copilot-ml]). Gain: fewer questions in Tarkistettavat. Done when: a
   core test with 30 answered rows sorts a held-out row right, and nothing is sent out.
6. A fetched row starts unseen until the household opens or answers it ([Lunch Money][lm-status]). Gain: what is new
   since last time is plain. Done when: an e2e spec counts fetched rows as new and none after one view.
7. One reconcile per account with a lock: the household confirms a bank balance on a date and rows before it stop
   moving ([Actual][actual-reconcile], [YNAB][ynab-reconcile]). Done when: a test edits a locked row and is refused.
8. Fold coverage notices, Tietojen laatu and the reconcile card into that one per-account check
   ([Actual][actual-reconcile]). Gain: one screen for "can I trust this". Done when: `pnpm strings` shows one heading
   for it and `e2e/coverage-notices.spec.ts` still finds each sum.
9. Tags as a rule action ([Sure][sure-actions], [Monarch][monarch-rules]). Gain: trips and projects across
   categories. Done when: an e2e spec tags rows by a rule and a report filters by the tag.
10. Split one row into parts, such as a loan payment into principal and insurance ([#4784][sure-4784],
    [actions][sure-actions]). Gain: loans read right. Done when: `reports.test.ts` adds the parts up to the row.
11. Read YNAB and Actual exports in the browser, rows only ([Sure models][sure-models]). Gain: a household moves in
    with its history. Done when: a core test reads a made-up YNAB export to the exact rows.
12. Save the CSV column match as a short rules text, like hledger's ([hledger][hl-csv]). Gain: one match shared per
    bank. Done when: a test round-trips a match through the text and gets the same rows.
13. Fewer settings: 50 files under `settings/`, 8 for remote access, against YNAB's start of one account and one card
    ([YNAB][ynab-start]). Gain: a first evening with fewer choices. Done when: the remote access tab is one form and
    `e2e/settings.spec.ts` passes at 390 and 1440 px.
14. One stored balance per account and day with start, inflows, outflows and a computed end, as Sure's `balances`
    ([schema][sure-schema]). Gain: the balance chart and the match check read one table. Done when: a test holds end =
    start + inflows - outflows each day and equal to the bank's reported balance.
15. A repo rule that fails on `parseFloat` or `toFixed` on a money value in `packages/core`
    ([Stack Overflow][so-float], [Actual][actual-util], [YNAB][ynab-api]). Gain: an agent's float bug stops at
    `pnpm check`. Done when: the rule fails on a planted `parseFloat(amount)` and passes on main.

[agpl]: https://www.gnu.org/licenses/agpl-3.0.html
[gpl-faq]: https://www.gnu.org/licenses/gpl-faq.html#AllCompatibility
[api-sure]: https://api.github.com/repos/we-promise/sure
[api-maybe]: https://api.github.com/repos/maybe-finance/maybe
[api-actual]: https://api.github.com/repos/actualbudget/actual
[api-ff]: https://api.github.com/repos/firefly-iii/firefly-iii
[api-bc]: https://api.github.com/repos/beancount/beancount
[api-ledger]: https://api.github.com/repos/ledger/ledger
[sure-repo]: https://github.com/we-promise/sure/tree/0cb32845216cf087401c37e512a8b9cdaee3eb3e
[sure-readme]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/README.md
[sure-commits]: https://github.com/we-promise/sure/commits/main
[sure-gemfile]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/Gemfile
[sure-models]: https://github.com/we-promise/sure/tree/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models
[sure-schema]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/db/schema.rb
[sure-valuation]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models/valuation.rb
[sure-money]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/lib/money.rb
[sure-eb-id]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models/enable_banking_entry/processor.rb
[sure-enrichable]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models/concerns/enrichable.rb
[sure-rule]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models/rule.rb
[sure-actions]: https://github.com/we-promise/sure/tree/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/models/rule/action_executor
[sure-dash]: https://github.com/we-promise/sure/blob/0cb32845216cf087401c37e512a8b9cdaee3eb3e/app/controllers/pages_controller.rb
[sure-4788]: https://github.com/we-promise/sure/issues/4788
[sure-4790]: https://github.com/we-promise/sure/issues/4790
[sure-4784]: https://github.com/we-promise/sure/issues/4784
[maybe-final]: https://github.com/maybe-finance/maybe/releases/tag/v0.6.0
[actual-repo]: https://github.com/actualbudget/actual/tree/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b
[actual-license]: https://github.com/actualbudget/actual/blob/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b/LICENSE.txt
[actual-budget-dir]: https://github.com/actualbudget/actual/tree/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b/packages/loot-core/src/server/budget
[actual-util]: https://github.com/actualbudget/actual/blob/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b/packages/loot-core/src/shared/util.ts
[actual-sync]: https://github.com/actualbudget/actual/blob/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b/packages/loot-core/src/server/accounts/sync.ts
[actual-budgeting]: https://actualbudget.org/docs/budgeting/
[actual-rules]: https://actualbudget.org/docs/budgeting/rules/
[actual-banksync]: https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync.md
[actual-reconcile]: https://github.com/actualbudget/actual/blob/7d4c52647b18f1abeae5cb8f09fdd16a6d6b334b/packages/docs/docs/accounts/reconciliation.md
[selfhostlife]: https://selfhostlife.com/actual-budget-self-hosted/
[finny-actual]: https://getfinny.app/blog/actual-budget-review-2026
[ff-repo]: https://github.com/firefly-iii/firefly-iii/tree/d65e916130c91d8f13ca808ca088d225ddd9a939
[ff-rules]: https://docs.firefly-iii.org/how-to/firefly-iii/features/rules/
[ff-importer]: https://docs.firefly-iii.org/explanation/data-importer/introduction/
[ff-review]: https://www.expensesorted.com/blog/147_firefly_iii
[ff-ballard]: https://www.kennethballard.com/?p=9483
[ff-13163]: https://github.com/firefly-iii/firefly-iii/issues/13163
[ynab-basics]: https://support.ynab.com/en_us/getting-started-ynab-basics-and-key-terms-BJCaIHaTZe.md
[ynab-faq]: https://support.ynab.com/en_us/getting-started-frequently-asked-questions-r1EiQk75Ml.md
[ynab-start]: https://support.ynab.com/en_us/getting-started-with-ynab-BJBFUjkUGg.md
[ynab-reconcile]: https://support.ynab.com/en_us/troubleshooting-reconciliation-issues-rJkijlVki.md
[ynab-api]: https://github.com/ynab/ynab-sdk-python/blob/main/open_api_spec.yaml
[ynab-price]: https://shouldiuse.io/r/ynab
[monarch-rules]: https://help.monarch.com/hc/en-us/articles/360048393372-Transaction-Rules
[monarch-ds]: https://www.dollarscout.net/personal-finance/reviews/monarch/
[monarch-nw]: https://www.nerdwallet.com/finance/learn/monarch-money-app-review
[copilot-ml]: https://help.copilot.money/en/articles/8182433-copilot-intelligence-for-spending
[copilot-apple]: https://envelopebudgeting.com/articles/copilot-money-review
[lm-rules]: https://support.lunchmoney.app/setup/rules
[lm-status]: https://support.lunchmoney.app/finances/transactions/transaction-status
[lm-review]: https://budgetingapps.org/apps/lunch-money
[hl-csv]: https://hledger.org/import-csv.html
[hl-import]: https://github.com/simonmichael/hledger/blob/5b22de2f78b139e7f6c0b019cc99b29d801eb5e1/hledger/Hledger/Cli/Commands/Import.md
[hl-license]: https://github.com/simonmichael/hledger/blob/5b22de2f78b139e7f6c0b019cc99b29d801eb5e1/LICENSE
[hl-repo]: https://github.com/simonmichael/hledger/tree/5b22de2f78b139e7f6c0b019cc99b29d801eb5e1
[bc-repo]: https://github.com/beancount/beancount/tree/9747213802acb733ce53acc6e963f5961f47d6cd
[bc-number]: https://github.com/beancount/beancount/blob/9747213802acb733ce53acc6e963f5961f47d6cd/beancount/core/number.py
[bc-syntax]: https://beancount.io/docs/Basics/syntax
[plus1]: https://www.plus1.com/fi/taloudenhallinta/parhaat-budjettisovellukset
[borderless]: https://borderlessbudget.com/country/finland
[spiir]: https://www.puhelinvertailu.com/uutiset/2021/01/19/spiir-sovellus-kokeiltu
[coderabbit]: https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
[gitclear]: https://www.gitclear.com/ai_assistant_code_quality_2025_research
[so-float]: https://stackoverflow.com/questions/3730019/why-not-use-double-or-float-to-represent-currency
[ao-float]: https://spin.atomicobject.com/floating-point-numbers/
[time-falsehoods]: https://gist.github.com/timvisee/fcda9bbdff88d45cc9061606b4b923ca
