-- Rows of another currency for the joint account idn-5: a USD row with two decimals, a JPY row with none, and a row of an
-- unknown currency (XXX) with no text.
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-1','2026-10-01',-5400,2,'USD','ESIMERKKI INC Subscription','2026-10-20T08:00:00.000Z');
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-2','2026-10-03',-1200,0,'JPY','ESIMERKKI KK','2026-10-20T08:00:00.000Z');
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-3','2026-10-04',700,2,'XXX',NULL,'2026-10-20T08:00:00.000Z');
