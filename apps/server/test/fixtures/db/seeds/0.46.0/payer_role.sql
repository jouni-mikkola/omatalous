-- Answers about money from a payer: a member's own answer (u-aino, gift), the household's default for the same payer
-- (cost_share) and a member's answer for a payer named by IBAN (own_money).
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('member','u-aino','name:matti meikalainen','gift','u-aino','2026-10-20T08:00:00.000Z');
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('household',NULL,'name:matti meikalainen','cost_share','u-eero','2026-10-20T08:00:00.000Z');
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('member','u-eero','iban:FI2112345600000785','own_money','u-eero','2026-10-20T08:00:00.000Z');
