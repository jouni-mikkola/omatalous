-- How far back the app asked for the rows of two accounts: the joint account a-5 with an older stored row than the first
-- fetch (source default) and a-1 asked for a longer history.
INSERT INTO account_history (account_id,asked_from,first_row_day,source,recorded_at) VALUES ('a-5','2026-09-01','2026-09-01','default','2026-10-20T08:00:00.000Z');
INSERT INTO account_history (account_id,asked_from,first_row_day,source,recorded_at) VALUES ('a-1','2026-05-01',NULL,'longest','2026-10-20T08:00:00.000Z');
