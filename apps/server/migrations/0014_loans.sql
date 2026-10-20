-- migrate: compat 0.8.0
-- Loans the user typed in and confirmed. The bank connection shows payment accounts only, so the debt itself comes from
-- the user: one row per loan, own rows only, removed with the user. Only adds a table, which older code neither reads
-- nor writes, so 0.8.0 opens a database that has it and a rollback keeps the rows.
-- Money is cents and what is owed is never negative. Rates are hundredths of a percent (325 is 3,25 %). Dates are
-- YYYY-MM-DD. NULL is a field the source did not give.
-- The value lists of kind, reference and repayment are in core (LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS) and
-- the routes check them, so a new value needs no change to this table.
CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- what the user calls it
  lender TEXT,                           -- who lent
  kind TEXT NOT NULL,                    -- mortgage | consumer | car | student | credit_line | card | instalment | other
  granted_cents INTEGER CHECK (granted_cents > 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),  -- owed on balance_date
  balance_date TEXT NOT NULL,
  rate_bp INTEGER CHECK (rate_bp >= 0),  -- the whole rate a year, reference and margin together
  reference TEXT,                        -- euribor_12 | euribor_6 | euribor_3 | fixed
  margin_bp INTEGER CHECK (margin_bp >= 0),
  repayment TEXT,                        -- annuity | equal_principal | fixed_instalment | bullet
  interval_months INTEGER CHECK (interval_months >= 1),  -- months between payments
  payment_cents INTEGER CHECK (payment_cents > 0),  -- paid each interval; equal_principal: the amortisation alone
  end_date TEXT,                         -- the last due date
  limit_cents INTEGER CHECK (limit_cents > 0),  -- the limit of a credit line or card
  series_key TEXT,                       -- the debt series its payments belong to, NULL until linked
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_loans_user ON loans(user_id);
