-- A said use of the joint account a-5 of 0.10.0 (the bank names two holders, its key is its identity idn-5): the member u-aino
-- at 60000 and the holders who are no member (user_id NULL) at 40000, both rows said by u-aino.
INSERT INTO account_use (account_key,user_id,weight,said_by,said_at) VALUES ('idn-5','u-aino',60000,'u-aino','2026-10-09T08:00:00.000Z');
INSERT INTO account_use (account_key,user_id,weight,said_by,said_at) VALUES ('idn-5',NULL,40000,'u-aino','2026-10-09T08:00:00.000Z');
