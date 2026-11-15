-- Three purchases of the bill t-12, by u-aino: two shops and a refund (money back, so a plus).
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-1','t-12','idn-5','u-aino','2026-09-05',-12000,'KAHVILA ESIMERKKI','k1','2026-10-20T08:00:00.000Z');
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-2','t-12','idn-5','u-aino','2026-09-12',-9000,'KIRJAKAUPPA ESIMERKKI','k2','2026-10-20T08:00:00.000Z');
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-3','t-12','idn-5','u-aino','2026-09-20',1000,'PALAUTUS','k3','2026-10-20T08:00:00.000Z');
