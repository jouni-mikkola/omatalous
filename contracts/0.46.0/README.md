# Contracts of 0.46.0

Frozen when 0.46.0 ships. Until then a later task may update these files (see `../README.md`). While 0.46.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.39.0 the schema adds the thirteen stores of migration 0021 (`account_balances`, `account_history`,
`account_fetch`, `foreign_rows`, the statement tables, `payer_role`, `household_member`, `account_agreement`,
`user_factor`, `valued_asset`, `contract_terms`, `access_token`) and two empty columns on `expected_bills`. 0021
carries the compat floor 0.45.0, so 0.45.0 still opens the database. The three `ops-*.json` files are copies of
0.39.0's: the helper CLI changed (UP2B) only by adding `ops progress`, which stores one running step and prints
`{"ok":true}` (or `{"ok":false,...}` with exit 1); what `ops poll`, `ops report` and `ops state` print is unchanged,
and a report's output may now carry `STEP-AT: n/m seconds` lines beside the `STEP:` lines, which older servers ignore.
