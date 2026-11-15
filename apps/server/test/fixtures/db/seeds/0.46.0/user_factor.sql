-- Second factors of u-aino: a TOTP seed (a made-up string standing for the sealed text) used once, and a recovery code (a
-- made-up hash) never used.
INSERT INTO user_factor (id,user_id,kind,secret,label,last_step,created_at,last_used_at) VALUES ('uf-1','u-aino','totp','sealed-made-up-seed','Puhelin',58123456,'2026-10-20T08:00:00.000Z','2026-10-21T08:00:00.000Z');
INSERT INTO user_factor (id,user_id,kind,secret,label,last_step,created_at,last_used_at) VALUES ('uf-2','u-aino','recovery','0000made0up0hash',NULL,NULL,'2026-10-20T08:00:00.000Z',NULL);
