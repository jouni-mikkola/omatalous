-- Parts of the three rows of the joint account a-5 (transactions.sql). t-11: a row split between two users (kind
-- 'own', grp ''). t-12: money out, kind 'payment', one part passed on (passed 1) and one not. t-13: unknown money in a
-- payer's group: '?' (a question stands for it), '-' (unknown, not asked) and a pool part of the holders who are no
-- user ('u:'); the three sum to the row.
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-11','u:u-aino','own','',60000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-11','u:u-eero','own','',40000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-12','u:u-aino','payment','',-12000,1);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-12','u:u-eero','payment','',-8000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','?','own','TUNTEMATON MAKSAJA',30000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','-','own','ESIMERKKI OY',15000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','u:','pool','',5000,1);
