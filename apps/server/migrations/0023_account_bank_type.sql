-- migrate: compat 0.64.0
-- What the bank says of an account, stored as sent, so a wrong guess of its type can be seen and a later rule can read
-- the bank's own words. Only adds nullable columns, which older code neither reads nor writes: 0.64.0 opens a database
-- that has them, and a rollback keeps them.
-- bank_type_code: `cash_account_type` (CACC, CARD, CASH, LOAN, OTHR, SVGS), upper case; "" when the bank was asked and
--   sent none, null when not asked yet. bank_usage: `usage` (PRIV, ORGA). bank_product: the bank's product name, never
--   the holder. psu_status: what the user is to the account (holder, co-holder, attorney), as sent.
-- type_source: who set `type`. 'user' when the user chose it in Asetukset > Tilit, which no link or fetch changes;
--   'bank' or null (a row from before this file) when the app worked it out from what the bank sent, which every link
--   and the first fetch after this file work out again.
ALTER TABLE accounts ADD COLUMN bank_type_code TEXT;
ALTER TABLE accounts ADD COLUMN bank_usage TEXT;
ALTER TABLE accounts ADD COLUMN bank_product TEXT;
ALTER TABLE accounts ADD COLUMN psu_status TEXT;
ALTER TABLE accounts ADD COLUMN type_source TEXT CHECK (type_source IN ('bank', 'user'));
