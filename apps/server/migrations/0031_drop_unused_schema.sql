-- migrate: breaking a build before this one refuses the database, so a rollback restores the copy taken before the update
-- view_opens (0030) held the days a member opened a view, for a list that is gone: no code reads or writes it. It holds no
-- money, account or transaction row.
-- idx_tx_user_date(user_id, booking_date) is the leading part of idx_tx_user_date_amount(user_id, booking_date,
-- amount_cents), and idx_tx_user_merchant(user_id, merchant) of idx_tx_user_merchant_date(user_id, merchant, booking_date
-- DESC, id) (both 0008). Neither is unique or partial, so the wider index answers every lookup the narrow one did, and a
-- sync writes one index less per row.
DROP INDEX idx_tx_user_date;
DROP INDEX idx_tx_user_merchant;
DROP TABLE view_opens;
