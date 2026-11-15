-- Answers to "whose money was this?". On idn-5, kind 'in' with a payer as key and each owner form: a user ('u:<id>',
-- twice, two users), the holders who are no user ('u:'), 'all' and 'none'. On idn-1, kind 'opening' with key '' and
-- owner 'all'; idn-5 also has an opening answer for one user.
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','MATTI MEIKALAINEN','u:u-aino','u-aino','2026-10-10T08:10:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','ESIMERKKI OY','u:u-eero','u-eero','2026-10-10T08:11:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','LAHJA','u:','u-aino','2026-10-10T08:12:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','YHTEINEN','all','u-aino','2026-10-10T08:13:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','KUKAAN','none','u-eero','2026-10-10T08:14:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','opening','','u:u-aino','u-aino','2026-10-10T08:15:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-1','opening','','all','u-aino','2026-10-10T08:16:00.000Z');
