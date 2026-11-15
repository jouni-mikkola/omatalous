-- Folded merchant, counterparty and description (core fold(): upper case,
-- ä/å → A, ö → O) so the transaction search ignores case and the dots.
-- SQLite's own upper() and LIKE only know ASCII, so the app fills this on
-- every insert and the upgrade task (services/upgrade.ts) fills old rows.
ALTER TABLE transactions ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
