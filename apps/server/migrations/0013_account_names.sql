-- migrate: compat 0.8.0
-- Accounts you can tell apart: the user's own name for an account, stored apart from the bank's name so that a link
-- (which rewrites `name` from the bank's answer) never replaces it, and three things the bank says about an account
-- when it is linked: who holds it, a card's masked number and its credit limit. Only adds nullable columns, which older
-- code neither reads nor writes, so 0.8.0 opens a database that has them and a rollback keeps what was typed.
-- custom_name: what the user typed in Asetukset > Tilit; NULL shows the bank's name.
-- holder: the account holder or holders as the bank gives them, "A, B".
-- card_mask: the last four digits of a card ("•••• 1234"), never a whole card number.
-- credit_limit_cents: the card's or the account's credit limit, a positive amount.
ALTER TABLE accounts ADD COLUMN custom_name TEXT;
ALTER TABLE accounts ADD COLUMN holder TEXT;
ALTER TABLE accounts ADD COLUMN card_mask TEXT;
ALTER TABLE accounts ADD COLUMN credit_limit_cents INTEGER;
