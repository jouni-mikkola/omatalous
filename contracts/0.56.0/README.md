# Contracts of 0.56.0

Frozen when 0.56.0 ships. Until then a later task may update these files (see `../README.md`).

Over 0.46.0 the schema adds the store `settlement_closed` of migration 0022 (one frozen snapshot per closed month of a
shared pool). 0022 carries the compat floor 0.55.0, so 0.55.0 still opens the database. The three `ops-*.json` files are
copies of 0.46.0's: the helper CLI did not change.
