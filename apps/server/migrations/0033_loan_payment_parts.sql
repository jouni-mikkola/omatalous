-- migrate: compat 0.64.0
-- The split of a loan's payment into repayment, interest and fees, as a loan document stated it: one row per payment,
-- keyed by its due date, read with the loan (db/finance/loan-parts.ts). It is the first evidence of how a payment row
-- divides (core analysis/debt-split.ts), so it holds exact cents the document printed.
-- A part belongs to its loan's owner: the repo writes it only under a loan of the user's own (the insert reads the loan
-- by user id and id) and reads it only through the user's own loan rows. A loan's delete or its user's delete takes its
-- parts with it.
-- Only adds a table, which older code neither reads nor writes: 0.64.0 opens a database that has it and a rollback
-- keeps it.
CREATE TABLE loan_payment_parts (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id         TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  due_date        TEXT NOT NULL,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents  INTEGER NOT NULL CHECK (interest_cents >= 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  PRIMARY KEY (loan_id, due_date)
) WITHOUT ROWID;
