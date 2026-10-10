-- Frozen database as written by Talous 0.2.0 (commit 66b1759). Never edit; add a new file per release.
-- Both users, a shared account, user-set categories, a regex rule, a pending row, NULL columns, an extreme amount,
-- sealed bank credentials. Loaded by apps/server/test/migration-chain.test.ts.
PRAGMA foreign_keys = OFF;
CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt>$<hash>
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE bank_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  institution TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL,                 -- active | expired | revoked
  valid_until TEXT,
  created_at TEXT NOT NULL,
  last_synced_at TEXT
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,               -- enablebanking | csv | demo
  external_id TEXT,                     -- provider's account uid (changes with every consent)
  identity TEXT,                        -- stable hash of IBAN / identification_hash: the same real account
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  type TEXT NOT NULL DEFAULT 'checking', -- checking | savings | credit_card | other
  balance_cents INTEGER,
  balance_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  booking_date TEXT NOT NULL,           -- YYYY-MM-DD
  value_date TEXT,
  amount_cents INTEGER NOT NULL,        -- negative = money out
  currency TEXT NOT NULL,
  status TEXT NOT NULL,                 -- booked | pending
  counterparty TEXT,
  counterparty_iban TEXT,
  description TEXT,
  reference TEXT,
  mcc TEXT,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  category_source TEXT NOT NULL,        -- user | rule | mcc | default | transfer
  is_transfer INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                 -- enablebanking | csv | demo
  raw TEXT,
  imported_at TEXT NOT NULL
);
CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,                  -- merchant | description | counterparty | any
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
);
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,                -- schedule | manual | connect
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                 -- running | ok | partial | failed
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_connections_user ON connections(user_id);
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_shares_user ON account_shares(user_id);
CREATE INDEX idx_tx_user_date ON transactions(user_id, booking_date);
CREATE INDEX idx_tx_account_date ON transactions(account_id, booking_date);
CREATE INDEX idx_tx_user_merchant ON transactions(user_id, merchant);
CREATE INDEX idx_rules_user ON category_rules(user_id);
CREATE INDEX idx_sync_runs_user ON sync_runs(user_id, id);
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0001_init.sql','2026-09-01T08:00:00.000Z','eaaa4438abe0820896de9910ed0e96b22161d9582da98693134f9ea2a016f9c2');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-aino','aino','Aino','pbkdf2_sha256$600000$c2FsdA$aGFzaA','admin',0,'2026-09-01T08:00:00.000Z');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-eero','eero','Eero','pbkdf2_sha256$600000$c2FsdA$aGFzaA','member',1,'2026-09-01T08:00:00.000Z');
INSERT INTO sessions (id,user_id,created_at,expires_at,last_seen_at,user_agent) VALUES ('s-1','u-aino','2026-09-01T08:00:00.000Z','2099-01-01T00:00:00.000Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO bank_credentials (user_id,app_id,private_key_enc,updated_at) VALUES ('u-aino','app-1','v1.AAAAAAAAAAAAAAAA.sealed-blob-not-a-real-key','2026-09-01T08:00:00.000Z');
INSERT INTO connections (id,user_id,provider,institution,country,status,valid_until,created_at,last_synced_at) VALUES ('c-1','u-aino','enablebanking','Nordea','FI','active','2027-01-01T00:00:00Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-1','u-aino','c-1','enablebanking','ext-1','idn-1','Käyttötili','FI2112345600000785','EUR','checking',123456,'2026-09-30','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z');
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-2','u-aino',NULL,'csv',NULL,NULL,'Visa',NULL,'EUR','credit_card',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-3','u-eero',NULL,'csv',NULL,NULL,'Eeron tili',NULL,'EUR','checking',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO account_shares (account_id,user_id,created_at) VALUES ('a-1','u-eero','2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-01','u-aino','a-1','2026-08-03',NULL,-4590,'EUR','booked','K-MARKET HERTTONIEMI',NULL,'Korttiosto K-MARKET',NULL,'5411','K-MARKET','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-02','u-aino','a-1','2026-08-05',NULL,312050,'EUR','booked','TYONANTAJA OY',NULL,'PALKKA 08/2026',NULL,NULL,'TYONANTAJA OY','salary','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-03','u-aino','a-1','2026-08-07',NULL,-990,'EUR','booked',NULL,NULL,'NETFLIX.COM',NULL,NULL,'NETFLIX.COM','subscriptions','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-04','u-aino','a-1','2026-08-09',NULL,-2500,'EUR','booked',NULL,NULL,'WOLT HELSINKI FI',NULL,'5812','WOLT HELSINKI FI','restaurants','mcc',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-05','u-aino','a-1','2026-09-01',NULL,-1500,'EUR','pending',NULL,NULL,NULL,NULL,NULL,'PENDING SHOP','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-06','u-aino','a-1','2026-09-02',NULL,-99999999999,'EUR','booked',NULL,NULL,'extreme amount',NULL,NULL,'EXTREME','other','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-07','u-aino','a-1','2026-09-03',NULL,0,'EUR','booked',NULL,NULL,NULL,NULL,NULL,'ZERO','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-08','u-aino','a-2','2026-09-04',NULL,-35000,'EUR','booked',NULL,NULL,'VISA LASKU',NULL,NULL,'VISA LASKU','transfer','transfer',1,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-09','u-aino','a-1','2026-09-05',NULL,-60000,'EUR','booked',NULL,NULL,'NEWTECH TESTI 123',NULL,NULL,'NEWTECH TESTI 123','shopping','rule',0,'csv','{"kept":"as the bank sent it"}','2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at) VALUES ('t-10','u-eero','a-3','2026-09-06',NULL,-1200,'EUR','booked',NULL,NULL,'R-KIOSKI',NULL,NULL,'R-KIOSKI','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (1,'u-aino','merchant','WOLT HELSINKI FI','restaurants',10,'2026-09-01T08:00:00.000Z');
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (2,'u-aino','description','^NEWTECH .*\d+$','shopping',10,'2026-09-01T08:00:00.000Z');
INSERT INTO sync_runs (id,user_id,trigger,started_at,finished_at,status,fetched,inserted,message) VALUES (1,'u-aino','schedule','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z','ok',9,9,NULL);
INSERT INTO settings (key,value,updated_at) VALUES ('instance_settings','{"address":"http://localhost:8080","timeZone":"Europe/Helsinki","syncHours":[6,18]}','2026-09-01T08:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('data_version','7','2026-09-01T08:00:00.000Z');
