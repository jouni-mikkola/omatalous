-- migrate: compat 0.64.0
-- The split of a loan's payment into repayment, interest and fees, as a loan document stated it (services/loans.ts
-- reads it with the loan): one row per payment, keyed by its due date. It is the first evidence of how a payment row
-- divides (core analysis/debt-split.ts), so it holds exact cents the document printed.
-- A part belongs to its loan's owner: the composite key (user_id, loan_id) refuses a part under another member's loan,
-- and a loan's delete or its user's delete takes its parts with it.
-- Only adds an index and a table, which older code neither reads nor writes: 0.64.0 opens a database that has them and
-- a rollback keeps them.
CREATE UNIQUE INDEX loans_user_loan ON loans(user_id, id);

CREATE TABLE loan_payment_parts (
  user_id         TEXT NOT NULL,
  loan_id         TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents  INTEGER NOT NULL CHECK (interest_cents >= 0),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  PRIMARY KEY (loan_id, due_date),
  FOREIGN KEY (user_id, loan_id) REFERENCES loans(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
