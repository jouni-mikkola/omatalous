-- Accounts for 0.9.0, one made-up row: a bank-connected loan account of the admin (type loan, a negative balance, the
-- connection c-1), the account the fourth loan in loans.sql names in loans.account_id. The csv accounts of the removed
-- CSV import (a-2 and a-3, with their csv transactions t-08 and t-10) are in 0.8.7.sql already, and the fifth loan names a-2.
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-4','u-aino','c-1','enablebanking','ext-4','idn-4','Autolaina','FI4250001510000023','EUR','loan',-1250000,'2026-10-01','2026-10-09T08:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,NULL,NULL,NULL);
