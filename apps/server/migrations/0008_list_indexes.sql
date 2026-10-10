-- The transaction list reads a count and a sum over the user's rows in a date range, and the per-merchant and
-- per-category views read one merchant or category newest first. With these indexes the count and sum are
-- answered from the index alone, and a rare merchant is found without walking the user's whole history.
-- Indexes only: no table or column changes, so an older build can still read the database.
CREATE INDEX idx_tx_user_date_amount ON transactions(user_id, booking_date, amount_cents);
CREATE INDEX idx_tx_user_merchant_date ON transactions(user_id, merchant, booking_date DESC, id);
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category, booking_date DESC, id);
-- Without statistics SQLite takes the widest of these for queries it has a narrower partial index for (the pending
-- rows of an account would scan the user's whole history). The server keeps the statistics fresh from now on
-- (PRAGMA optimize at start and every hour).
ANALYZE transactions;
