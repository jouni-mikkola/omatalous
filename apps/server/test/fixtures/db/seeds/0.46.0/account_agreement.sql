-- Dated agreements for the joint account idn-5: equal from the start of the year, then a share from October, each set by a
-- member; and a fixed one on idn-1 set by nobody (set_by NULL, as after that member was removed).
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-5','2026-01-01','equal','{"who":["u:u-aino","u:u-eero"]}','u-aino','2026-10-20T08:00:00.000Z');
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-5','2026-10-01','share','{"weights":{"u:u-aino":600,"u:u-eero":400}}','u-eero','2026-10-20T08:00:00.000Z');
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-1','2026-06-01','fixed','{}',NULL,'2026-10-20T08:00:00.000Z');
