-- Calls to the bank for the joint account idn-5: one by each member, and one by a member who is gone (user_id NULL).
INSERT INTO account_fetch (account_key,at,trigger,user_id) VALUES ('idn-5','2026-10-20T07:00:00.000Z','schedule','u-aino');
INSERT INTO account_fetch (account_key,at,trigger,user_id) VALUES ('idn-5','2026-10-20T08:00:00.000Z','open','u-eero');
INSERT INTO account_fetch (account_key,at,trigger,user_id) VALUES ('idn-5','2026-10-20T09:00:00.000Z','manual',NULL);
