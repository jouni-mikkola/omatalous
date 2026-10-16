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
| `notExported` | array of strings | tables of the database that are neither in a store below nor left out on purpose (empty unless the database holds a table this release does not know); the file is written without them |

After these come one array per store, listed below in the order of the file. A row is an object with one key per
column of the database table it is read from: the same names, so the migrations (`apps/server/migrations`) explain a
column further. A key is always present; a missing value is `null`. Money is integer cents, a day is `YYYY-MM-DD`, an
instant is ISO text in UTC. Text columns that hold JSON (`account_agreement.value`, `optimise_snapshots.data`) are
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
| `type` | string | checking, savings, credit_card, other |
| `balance_cents` | integer or null |  |
| `balance_at` | string or null |  |
| `last_synced_at` | string or null |  |
| `created_at` | string |  |
| `custom_name` | string or null |  |
| `holder` | string or null |  |
| `card_mask` | string or null |  |
| `credit_limit_cents` | integer or null |  |
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
| `field` | string | merchant, description, counterparty, any |
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
