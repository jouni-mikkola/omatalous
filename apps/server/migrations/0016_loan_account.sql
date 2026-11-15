-- migrate: compat 0.8.0
-- A saved loan names the connected card or loan account that is the same debt, once the household has said so.
-- NULL: no account named. Removing the account leaves the loan in place and clears the name.
-- Only adds a nullable column and an index, which older code neither reads nor writes, so 0.8.0 opens a database that
-- has them and a rollback keeps the links: an older version counts a linked pair as two debts, as it did before.
-- The index finds the loan of an account. It does not hold an account to one loan: the server does, in the statement
-- that saves a loan (db/finance/loans.ts).
ALTER TABLE loans ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX idx_loans_account ON loans(account_id) WHERE account_id IS NOT NULL;
