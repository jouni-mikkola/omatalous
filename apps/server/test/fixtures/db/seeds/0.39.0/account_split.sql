-- The one mode 'source' ("by who paid"): the joint account idn-5 cut by the member u-aino (set_by not NULL), and the
-- account idn-1 cut by the app once (set_by NULL).
INSERT INTO account_split (account_key,mode,set_by,set_at) VALUES ('idn-5','source','u-aino','2026-10-10T08:00:00.000Z');
INSERT INTO account_split (account_key,mode,set_by,set_at) VALUES ('idn-1','source',NULL,'2026-10-10T08:05:00.000Z');
