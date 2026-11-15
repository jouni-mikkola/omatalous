# Contracts of 0.66.0

Frozen when 0.66.0 ships. Until then a later task may update these files (see `../README.md`).

Over 0.56.0 the schema adds the nullable columns of migration 0023 on `accounts` (what the bank says of an account's
type, stored as sent). 0023 carries the compat floor 0.64.0, so 0.64.0 still opens the database. The helper's update
step now accepts a release on a new history that names the installed release as the one it continues, but what
`ops poll`, `ops report` and `ops state` print did not change: the three `ops-*.json` files are copies of 0.56.0's.
