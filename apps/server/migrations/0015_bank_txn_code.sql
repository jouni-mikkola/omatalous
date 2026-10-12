-- migrate: compat 0.8.0
-- The bank's own transaction code of a row (ISO 20022 BankTransactionCode, "PMNT-RCDT-SALA"), as the bank connection
-- gives it. The rules read it where the row's text says nothing: pay, a cash withdrawal, a move between own accounts.
-- NULL: the bank gave no code, or the row came from a file. A row fetched before this column has its code in `raw`,
-- and the upgrade tasks fill the column from there once (services/upgrade.ts).
-- Only adds a nullable column, which older code neither reads nor writes, so 0.8.0 opens a database that has it and a
-- rollback keeps the codes.
ALTER TABLE transactions ADD COLUMN bank_txn_code TEXT;
