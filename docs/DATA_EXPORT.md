# Data export file

Asetukset > Tiedot > "Vie kaikki tiedot" (every signed-in user, `POST /api/data/export`) downloads one JSON file with
your own data and what is shared with you. The import reads the same file, so this page is the contract between them.
The code is `apps/server/src/services/data-export-stores.ts` (the stores) and `data-export.ts`.

## Shape

```json
{
  "format": "omatalous-export",
  "version": 1,
  "exportedAt": "2026-10-09T10:00:00.000Z",
  "appVersion": "0.48.0",
  "users": [ { "id": "...", "username": "...", "display_name": "...", "role": "admin", "created_at": "..." } ],
  "accounts": [],
  "transactions": []
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | always `omatalous-export` |
| `version` | integer | the version of this file format, 1 |
| `exportedAt` | string | the instant of the export, ISO text in UTC |
| `appVersion` | string | the release that wrote the file |
| `exportedBy` | string | optional: the username of the person who exported; a file made before 0.49.0 has none. An import refuses a file whose `exportedBy` is not the signed-in user: "Tiedosto on toisen käyttäjän. Tuo vain omat tietosi." |
| `notExported` | array of strings | tables of the database that are neither in a store below nor left out on purpose (empty unless the database holds a table this release does not know); the file is written without them |

After these come one array per store, listed below in the order of the file. A row is an object with one key per
column of the database table it is read from: the same names, so the migrations (`apps/server/migrations`) explain a
column further. A key is always present; a missing value is `null`. Money is integer cents, a day is `YYYY-MM-DD`, an
instant is ISO text in UTC. Text columns that hold JSON (`account_agreement.value`, `settlement_closed.snapshot`, `optimise_snapshots.data`) are
strings, not nested objects. Rows are ordered by their key, so two exports of one database are equal but for
`exportedAt`.

A change that removes or renames a field, or changes what a field means, raises `version`. A new array or a new field
keeps it: a reader ignores what it does not know.

## Whose data

The file holds what the person who asks sees in the app, and nothing more, for a member and for an administrator
alike: their own accounts, transactions, rules, marks, answers, inputs, loans and statements, the accounts other
members shared with them and the transactions of those accounts, the answers and balances kept under those accounts,
and the household's own tables (`householdMembers`, `valuedAssets`, the household's `payerRoles`). An administrator's
file holds no member's account or row that was not shared with them. `users` holds the person, the owners of the shared
accounts and the members they share an account with; for an administrator every member, as Asetukset > Talouden
jäsenet lists them.

A row of another user (an account or a transaction of a shared account) carries `owner_username`, the owner's
`username`, so an import can tell the rows apart; on the person's own rows it is their own `username`.

The file is a POST behind the same guard as every write of the app, so a link on another site cannot start it; a GET
or a HEAD is answered 405 and writes no security event.

## Keys between the stores

- `user_id`, `said_by`, `set_by`, `answered_by` name a row of `users`. The file holds no password, so a reader that
  restores the users makes new passwords.
- `account_key` is the real account: `accounts.identity`, or `accounts.id` when the account has no identity. A joint
  account is two `accounts` rows and one key.
- `tx_id`, `bill_tx_id` name a row of `transactions`; `account_id` names a row of `accounts`.
- The category of a transaction is `transactions.category` (and `category_source`: `user` is a choice the household
  made). There are no stored categories of their own: the list of categories is in the code.

## What is not in the file

Never: passwords and password hashes, sessions, second-factor secrets, access tokens and their hashes, the bank
application's private key, the bank's consent and session data (`accounts.external_id`, `accounts.connection_id`, the
`connections` table), and the bank's raw payloads (`transactions.raw`), which hold other people's names and account
numbers. Logs and caches are not in it either. `LEFT_OUT` in the code names each table that is not exported, with its
reason; a test fails for a table that is neither a store nor in that list.

`transactions.signature` is the text a fetch from the bank matches a stored row on: a JSON array of the booking date,
value date, amount in cents, status, counterparty, counterparty IBAN, description, reference, MCC, merchant and bank
transaction code. A reader that stores a transaction keeps it as it is.

## Stores

### users

Table `users`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `username` | string |  |
| `display_name` | string |  |
| `role` | string | admin, member |
| `created_at` | string |  |

### accounts

Table `accounts`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `user_id` | string |  |
| `provider` | string | enablebanking, csv, demo |
| `identity` | string or null | stable hash of IBAN / identification_hash: the same real account |
| `name` | string |  |
| `iban` | string or null |  |
| `currency` | string |  |
| `type` | string | checking, savings, credit_card, loan, other |
| `balance_cents` | integer or null |  |
| `balance_at` | string or null |  |
| `last_synced_at` | string or null |  |
| `created_at` | string |  |
| `custom_name` | string or null |  |
| `holder` | string or null |  |
| `card_mask` | string or null |  |
| `credit_limit_cents` | integer or null |  |
| `bank_type_code` | string or null | the bank's `cash_account_type` (CACC, CARD, LOAN, SVGS ...); "" when it sent none |
| `bank_usage` | string or null | PRIV or ORGA, as the bank sends it |
| `bank_product` | string or null | the bank's product name |
| `psu_status` | string or null | what the user is to the account (holder, co-holder ...), as the bank sends it |
| `type_source` | string or null | user: chosen in Asetukset > Tilit, which no link changes; bank or null: worked out from the bank's fields |
| `owner_username` | string or null | the `username` of the owner (`user_id`) |

### accountShares

Table `account_shares`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_id` | string |  |
| `user_id` | string |  |
| `created_at` | string |  |

### transactions

Table `transactions`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `user_id` | string |  |
| `account_id` | string |  |
| `booking_date` | string | YYYY-MM-DD |
| `value_date` | string or null |  |
| `amount_cents` | integer | negative = money out |
| `currency` | string |  |
| `status` | string | booked, pending |
| `counterparty` | string or null |  |
| `counterparty_iban` | string or null |  |
| `description` | string or null |  |
| `reference` | string or null |  |
| `mcc` | string or null |  |
| `merchant` | string |  |
| `category` | string |  |
| `category_source` | string | user, rule, mcc, default, transfer |
| `is_transfer` | integer |  |
| `source` | string | enablebanking, csv, demo |
| `imported_at` | string |  |
| `bank_txn_code` | string or null |  |
| `signature` | string | the text a fetch matches the row on, see "What is not in the file" |
| `owner_username` | string or null | the `username` of the owner (`user_id`) |

### rules

Table `category_rules`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | integer |  |
| `user_id` | string |  |
| `field` | string | merchant, merchant_exact, description, counterparty, any |
| `pattern` | string |  |
| `category` | string |  |
| `priority` | integer |  |
| `created_at` | string |  |

### marks

Table `user_marks`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `user_id` | string |  |
| `subject` | string |  |
| `mark` | string |  |
| `marked_at` | string |  |

### answers

Table `owner_answer`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `kind` | string |  |
| `key` | string |  |
| `owner` | string |  |
| `said_by` | string |  |
| `said_at` | string |  |

### accountSplits

Table `account_split`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `mode` | string |  |
| `set_by` | string or null |  |
| `set_at` | string |  |

### accountUse

Table `account_use`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `user_id` | string or null |  |
| `weight` | integer |  |
| `said_by` | string or null |  |
| `said_at` | string |  |

### parts

Table `tx_part`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `tx_id` | string |  |
| `owner` | string |  |
| `kind` | string |  |
| `grp` | string |  |
| `cents` | integer |  |
| `passed` | integer |  |

### loans

Table `loans`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `user_id` | string |  |
| `name` | string | what the user calls it |
| `lender` | string or null | who lent |
| `kind` | string | mortgage, consumer, car, student, credit_line, card, instalment, other |
| `granted_cents` | integer or null |  |
| `balance_cents` | integer | owed on balance_date |
| `balance_date` | string |  |
| `rate_bp` | integer or null | the whole rate a year, reference and margin together |
| `reference` | string or null | euribor_12, euribor_6, euribor_3, fixed |
| `margin_bp` | integer or null |  |
| `repayment` | string or null | annuity, equal_principal, fixed_instalment, bullet |
| `interval_months` | integer or null | months between payments |
| `payment_cents` | integer or null | paid each interval; equal_principal: the amortisation alone |
| `end_date` | string or null | the last due date |
| `limit_cents` | integer or null | the limit of a credit line or card |
| `series_key` | string or null | the debt series its payments belong to, NULL until linked |
| `created_at` | string |  |
| `updated_at` | string |  |
| `account_id` | string or null |  |
| `rate_review_date` | string or null |  |

### expectedBills

Table `expected_bills`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `user_id` | string |  |
| `name` | string |  |
| `amount_cents` | integer |  |
| `due_date` | string | the first due date, YYYY-MM-DD; later ones follow the cadence |
| `cadence` | string |  |
| `category` | string or null |  |
| `created_at` | string |  |
| `reference` | string or null |  |
| `payee_iban` | string or null |  |

### optimiseInputs

Table `optimise_inputs`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `user_id` | string |  |
| `key` | string |  |
| `value` | string |  |
| `as_of` | string | the day it was saved, YYYY-MM-DD; a stale input counts as missing |

### optimiseStates

Table `optimise_states`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `user_id` | string |  |
| `finding_id` | string |  |
| `status` | string |  |
| `reason` | string or null |  |
| `until` | string or null |  |
| `effective_date` | string or null |  |
| `mid_cents` | integer or null |  |
| `baseline` | string or null |  |
| `decided_at` | string |  |

### optimiseSnapshots

Table `optimise_snapshots`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `user_id` | string |  |
| `month` | string |  |
| `data` | string |  |
| `created_at` | string |  |

### accountBalances

Table `account_balances`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `day` | string |  |
| `type` | string |  |
| `reference_date` | string or null |  |
| `cents` | integer |  |
| `fetched_at` | string |  |
| `source` | string |  |

### accountHistory

Table `account_history`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_id` | string |  |
| `asked_from` | string |  |
| `first_row_day` | string or null |  |
| `source` | string |  |
| `recorded_at` | string |  |

### statementBills

Table `statement_bill`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `bill_tx_id` | string |  |
| `user_id` | string |  |
| `account_key` | string |  |
| `period_from` | string |  |
| `period_to` | string |  |
| `statement_cents` | integer or null |  |
| `saved_at` | string |  |
| `detached_at` | string or null |  |
| `detached_reason` | string or null |  |

### statementRows

Table `statement_rows`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `bill_tx_id` | string |  |
| `account_key` | string |  |
| `user_id` | string |  |
| `day` | string |  |
| `cents` | integer |  |
| `text` | string |  |
| `row_key` | string |  |
| `imported_at` | string |  |

### foreignRows

Table `foreign_rows`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `raw_key` | string |  |
| `booking_date` | string |  |
| `amount_minor` | integer |  |
| `scale` | integer |  |
| `currency` | string |  |
| `text` | string or null |  |
| `seen_at` | string |  |

### payerRoles

Table `payer_role`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `scope` | string |  |
| `user_id` | string or null |  |
| `counterparty_key` | string |  |
| `role` | string |  |
| `answered_by` | string or null |  |
| `answered_at` | string |  |

### householdMembers

Table `household_member`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `name` | string |  |
| `weight` | integer |  |
| `created_at` | string |  |

### accountAgreements

Table `account_agreement`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `valid_from` | string |  |
| `kind` | string |  |
| `value` | string |  |
| `set_by` | string or null |  |
| `set_at` | string |  |

### settlementClosed

Table `settlement_closed`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `account_key` | string |  |
| `month` | string |  |
| `closed_on` | string |  |
| `snapshot` | string |  |
| `written_at` | string |  |

`accountAgreements` and `settlementClosed` are in the file only for the accounts the person is weighted in (they say what the
partners of a pool owe each other, so a person who only sees a shared account gets none). A row that still waits for a
partner (an `income` agreement, or a `fixed` one whose remainder follows income, that not every user it names has put) is
in the file only for the users it names and the ones who have put it. On import such a row is taken only for an account
the person is weighted in, of a kind this server knows and a value of the shape the app writes (anything else is skipped
with the reason `refused`). A `settlementClosed` row is taken only for a month that has ended, from the pool's first booked
month on, whose `closed_on` is a day that month can close on (from its last day to 90 days after, not in the future, with
`by` as that day gives), and only when it equals what this server works out for that month of that pool (the same lines and
cents); it is never put in place of a month that is stored. So a month that comes in one file with the agreement it was
worked out with is skipped the first time and taken when the file is imported again. An agreement that shows the income
ratio is read as put by the person alone: the others it names put it themselves.

### valuedAssets

Table `valued_asset`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `id` | string |  |
| `kind` | string |  |
| `name` | string |  |
| `day` | string |  |
| `cents` | integer |  |

### contractTerms

Table `contract_terms`, one object per row.

| Field | Type | Note |
| --- | --- | --- |
| `user_id` | string |  |
| `series_key` | string |  |
| `notice_days` | integer or null |  |
| `renews_on` | string or null |  |
| `answered_at` | string |  |

## Import

Asetukset > Tiedot > "Tuo tiedot" reads the file back into the signed-in user's own data (`apps/server/src/services/data-import.ts`,
the checks of each store in `data-import-stores.ts`, the routes in `apps/server/src/routes/data.ts`). A member and an
administrator alike import into their own data only. The import is a dry run first: nothing is written until the commit.

### Endpoints

All are POST (the CSRF header and origin of every write), for a signed-in user whose password is their own (a temporary
password gets 403, no session 401). A refusal is HTTP 400 `{ "error": "<Finnish sentence>" }`.

| Call | Body | Answer |
| --- | --- | --- |
| `POST /api/data/import` | the file's head: `{ "format": "omatalous-export", "version": 1, "appVersion", "exportedAt", "exportedBy" }` (`exportedBy` optional) | `{ session, expiresAt, limits }` |
| `POST /api/data/import/:session/chunk` | `{ "seq": 0, "stores": { "<store>": [rows] } }` | `{ staged }` |
| `POST /api/data/import/:session/check` | none | the dry run: the plan below, `committed: false` |
| `POST /api/data/import/:session/commit` | none | the plan of that moment, `committed: true` |
| `DELETE /api/data/import/:session` | none | `{ ok: true }` |

The page reads the file in the browser, sends the head, then the rows of every array (every key of the file that is an
array) in chunks, then `check`, shows the plan, and sends `commit` when the user presses "Tuo". A chunk holds rows of any
stores, at most 192 KiB of JSON text (`limits.chunkBytes`; the app refuses a body over 256 KiB), numbered `seq` from 0
with no gap and no repeat. Keys of the file that are not arrays (`exportedAt`, `notExported`) are not sent.

### Limits

- A session belongs to the user who opened it and ends 15 minutes after its last call (`limits.sessionMinutes`), at the
  commit, at a refusal, and on `DELETE`. A user has one session: opening another ends the first. At most eight sessions
  are open at a time. A session that is missing, over or another user's gets one sentence: "Tuonti on päättynyt tai vanhentunut. Aloita alusta."
  A session not used for 15 minutes is dropped from memory at the next call of anyone, not only at the next import.
- The chunks of one session add up to 64 MiB of JSON text and 2000 chunks. The cost at the cap (a file of 58.5 MiB with
  125 000 transactions): the dry run takes about 0.6 s and the commit about 6 s, the event loop stalls up to 0.9 s at
  the commit (the batch and one processing), and the staged rows take about 80 MiB of heap.
- An array holds at most: transactions 500 000, parts 1 500 000, accounts and users 1000, loans 500, expectedBills 100,
  householdMembers 200, rules 2000, 50 000 for the others (the exact figures are `max` in `data-import-stores.ts`).
- A row has at most 200 keys; every value is checked against the type, length and list of its column (the tables above).
  Money is whole cents within a hundred billion euros, a day must exist on the calendar, a text holds no control character.
  A loan is also checked by the same rules as the loan form (`parseLoan`).
- Version first: another `version` or `format` is refused at the head, before any row. The first value that fails refuses
  the whole file and ends the session: "Tiedoston kohdan transactions rivi 3 on virheellinen (amount_cents). Mitään ei tuotu."
- A reference must point to a row in the file or to a row the user has here: `account_id`, `account_key`, `tx_id`,
  `bill_tx_id` and `user_id` that point nowhere (or to another user's row here) refuse the file.

### What is written

Only rows that are missing, in one transaction (`INSERT OR IGNORE`); then the user's transactions are processed once.
Nothing is updated or deleted: a row with a key the table has is kept as it is and counted as existing.

- Whose: a row is the user's when its owner's username is the signed-in user's (`owner_username`, or the `users` row its
  `user_id` names; account-key rows follow the account). A row of another user is skipped (`other_user`), and so is a
  person other than the user inside a row (`account_use` of another person). A person named as who said something
  (`said_by`, `set_by`, `answered_by`) other than the user is the user where the column is required, else null.
  `users` and `accountShares` are never written (`users`, `sharing`): no user, password, session, second factor or token is
  created, and sharing is set again in the app.
- Owners: a person named as an owner (`owner` of `answers` and `parts`: `u:<user id>`) is read through the file's `users`
  to a person here; the file's ids mean nothing here, so every one of them (the user's own, another person's, an id the
  file does not know, an id of a user here) becomes the user (`u:<id here>`). `u:` (a holder who is no user) stays.
- Household-wide rows (`householdMembers`, `valuedAssets`, the `payerRoles` of scope `household`) have no owner and no
  other writer in the app: only an administrator's import writes them. For a member they are skipped (`household`, the
  page says "ei tuoda"). For an administrator an asset id that is here under another kind or name gets a fresh id with
  all its days in the file, so no row lands under an asset it does not describe.
- Accounts: matched to the user's own by id, then `identity`, then IBAN; a match is kept. A new account has no bank link
  (provider `csv`, `demo` stays `demo`, no `connection_id` or `external_id`) and keeps `identity`, so linking the bank
  later folds it as an imported account is folded. It keeps the file's id unless another account here has it. An
  account whose `identity` or IBAN another user of this instance holds (and the user does not) is added with no
  `identity`, and with a fresh id if its own id is a key another user holds: its rows stay the user's own, keyed by the
  new account, and nothing is attached to the other user's account. A joint account is joined by linking the bank. The
  dry run counts such an account as if no other user existed.
- A category the user set (`category_source` `user`) is never changed by the processing that follows the commit; a row
  the rules decide may be re-categorised, as when a rule is added in the app.
- Transactions: by id, then by the bank signature a fetch matches on (account and `signature`, recomputed from the
  fields, the file's `signature` is never trusted): each stored row is used once, so two equal rows of the file are two
  rows. A new row keeps its id unless the table has it, gets no `raw`, and an unknown category becomes `other`. The parts
  of a transaction that was here already are kept as they are.
- The other stores by the key in the "Stores" tables: `rules` by (`field`, `pattern`), `householdMembers` by `name`,
  `loans` and `expectedBills` by id, `statementRows` by (bill, `row_key`), the rest by their primary key. An id the table has
  for another user's row is not used: the new row gets a fresh one.

### The dry run's answer

```json
{
  "session": "...", "expiresAt": "2026-10-09T10:15:00.000Z",
  "head": { "version": 1, "appVersion": "0.48.0", "exportedAt": "2026-10-09T10:00:00.000Z" },
  "stores": [ { "key": "transactions", "add": 12, "exists": 3, "skipped": [ { "reason": "other_user", "n": 2 } ] } ],
  "otherUsers": [ { "username": "kaisa", "rows": 40 } ],
  "ignored": { "stores": [ { "key": "mystery", "rows": 2 } ], "keys": 1 },
  "total": { "add": 12, "exists": 3, "skipped": 2 },
  "committed": false
}
```

`stores` lists the stores that have rows in the file, in the order of the file; a store of the file this release does
not know is in `ignored.stores` (rows counted), a key of a known row it does not know in `ignored.keys`. `reason` is
`other_user` (the page says "toisen käyttäjän"), `users`, `sharing`, `household` (the page says "ei tuoda") or `refused` (a settlement row the person may not bring). `otherUsers` are the other usernames the file names, with
the rows skipped for them. The commit writes one security event `ops_import` with the totals.
