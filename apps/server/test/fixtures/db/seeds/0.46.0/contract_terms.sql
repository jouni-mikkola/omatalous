-- Notice periods two members answered for the same contract series: one with a period and a renewal day, one with neither.
INSERT INTO contract_terms (user_id,series_key,notice_days,renews_on,answered_at) VALUES ('u-aino','esimerkki oy',30,'2027-01-01','2026-10-20T08:00:00.000Z');
INSERT INTO contract_terms (user_id,series_key,notice_days,renews_on,answered_at) VALUES ('u-eero','esimerkki oy',NULL,NULL,'2026-10-20T08:00:00.000Z');
