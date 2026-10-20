-- Accounts for 0.10.0, one made-up row: a bank-connected joint account of the admin (type checking, the connection c-1)
-- whose holder text names two people. The bank sends them as "A;B" and the app stores "A, B" (accountHolder in
-- connectors/enable-banking/mapper.ts), upper case and surname first as a bank writes them. Both names are made up.
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-5','u-aino','c-1','enablebanking','ext-5','idn-5','Yhteistili','FI8757300220000019','EUR','checking',245000,'2026-10-09','2026-10-09T08:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,'MEIKALAINEN MATTI, KORHONEN ELISA',NULL,NULL);
