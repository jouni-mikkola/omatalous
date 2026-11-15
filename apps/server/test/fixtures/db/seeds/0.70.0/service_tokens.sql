-- Two tokens of one user: one that has been used (last_used_at and last_used_ip set) and one never used (both NULL). The
-- hashes are made-up 64-character hex strings; no real token is stored.
INSERT INTO service_tokens (id,token_hash,user_id,name,created_at,expires_at,last_used_at,last_used_ip) VALUES ('st-1','0000000000000000000000000000000000000000000000000000000000000001','u-aino','claude','2026-10-01T08:00:00.000Z','2026-10-31T08:00:00.000Z','2026-10-05T09:00:00.000Z','192.0.2.10');
INSERT INTO service_tokens (id,token_hash,user_id,name,created_at,expires_at,last_used_at,last_used_ip) VALUES ('st-2','0000000000000000000000000000000000000000000000000000000000000002','u-aino','script','2026-10-02T08:00:00.000Z','2026-12-31T08:00:00.000Z',NULL,NULL);
