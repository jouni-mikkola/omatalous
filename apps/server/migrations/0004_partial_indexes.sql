-- Pending rows are replaced and read at every sync, and rows nothing
-- categorised are read by the register lookup and the category settings.
-- Both are small slices of a large table, so partial indexes keep those
-- reads off the user's whole history.
CREATE INDEX idx_tx_account_pending ON transactions(account_id) WHERE status = 'pending';
CREATE INDEX idx_tx_user_uncategorised ON transactions(user_id) WHERE category_source = 'default';
