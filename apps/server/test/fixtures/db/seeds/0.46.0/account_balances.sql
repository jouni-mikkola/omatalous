-- Balances the bank sent for the joint account idn-5 on two days (CLBD with its reference day, ITAV with none), a balance
-- the bank sent in a word that is no four capitals (OTHR), and a seed row from the stored balance of idn-1 (no reference day).
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-20','CLBD','2026-10-19',125000,'2026-10-20T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-20','ITAV',NULL,130000,'2026-10-20T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-21','CLBD','2026-10-20',121550,'2026-10-21T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-21','OTHR',NULL,110000,'2026-10-21T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-1','2026-10-15','OTHR',NULL,90000,'2026-10-15T12:00:00.000Z','seed');
