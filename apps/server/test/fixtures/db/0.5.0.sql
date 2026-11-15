-- Frozen database as written by Omatalous 0.5.0. Never edit; add a new file per release.
-- Everything in 0.4.0.sql (both users, a shared account, user-set categories, a regex rule, a pending row, NULL columns,
-- an extreme amount, sealed bank credentials, search_text, trade register answers of every status, security events of
-- every kind in use) plus the 0007 ops_requests table with the maintenance actions logs, prune and helper-renew, the 0008
-- list indexes with their statistics, and the settings keys of the durability and performance work: a needs_reprocess
-- mark, per-user data_version and per-user app_build. Loaded by apps/server/test/migration-chain.test.ts.
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
, search_text TEXT NOT NULL DEFAULT '');
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
CREATE TABLE merchant_industry (
  merchant TEXT PRIMARY KEY,
  status TEXT NOT NULL,                 -- found | none | ambiguous | error
  business_id TEXT,
  company_name TEXT,
  industry_code TEXT,                   -- TOL code, e.g. 56300
  code_set TEXT,                        -- TOL2008 | TOL2025
  industry_label TEXT,                  -- Finnish description from the register
  checked_at TEXT NOT NULL
);
CREATE TABLE merchant_industry_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  PRIMARY KEY (user_id, merchant)
);
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  detail TEXT,
  notify INTEGER NOT NULL DEFAULT 0,
  seen_at TEXT
);
CREATE TABLE "ops_requests" (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL CHECK (action IN ('update','rollback','backup','restart','doctor','check-update','logs','prune','helper-renew','access','port')),
  params        TEXT NOT NULL DEFAULT '{}',
  secret_sealed BLOB,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ok','failed','expired','cancelled')),
  requested_by  TEXT NOT NULL,
  requested_at  TEXT NOT NULL,
  claimed_at    TEXT,
  finished_at   TEXT,
  exit_code     INTEGER,
  summary       TEXT,
  output        TEXT,
  steps         TEXT
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
CREATE INDEX idx_tx_account_pending ON transactions(account_id) WHERE status = 'pending';
CREATE INDEX idx_tx_user_uncategorised ON transactions(user_id) WHERE category_source = 'default';
CREATE INDEX idx_security_events_at ON security_events(at);
CREATE INDEX idx_security_events_user ON security_events(user_id, at);
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update','logs');
CREATE INDEX idx_tx_user_date_amount ON transactions(user_id, booking_date, amount_cents);
CREATE INDEX idx_tx_user_merchant_date ON transactions(user_id, merchant, booking_date DESC, id);
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category, booking_date DESC, id);
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0001_init.sql','2026-10-10T08:00:00.000Z','eaaa4438abe0820896de9910ed0e96b22161d9582da98693134f9ea2a016f9c2');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0002_merchant_industry.sql','2026-10-10T08:00:00.000Z','cff4fff770c07304810c3a0d56b7827b4f59bcc8a101802432af50accac3dc1b');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0003_search_text.sql','2026-10-10T08:00:00.000Z','a2a9eacc5f5e7cec4832c41bdbe6436be1099e94aae1ee7cbb2d97c483505ab2');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0004_partial_indexes.sql','2026-10-10T08:00:00.000Z','ac98af7be524d4e14b2e56546980c2338d07f721dddc2a1f12e2225252e68f76');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0005_security_events.sql','2026-10-10T08:00:00.000Z','79b354a01312f4d10ed2d4017ea53af0bab61355e8a6e5982b3aea5be0c86bf0');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0006_ops_requests.sql','2026-10-10T08:00:00.000Z','59eb4860c33882e1355d67b1d36a331ede88972efd4f4580d719042aafdfbefd');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0007_ops_more_actions.sql','2026-10-10T08:00:00.000Z','141631cce9618911e7aa15d89dcc1581cbd783f1399db621c9b6a9c1e75164fc');
INSERT INTO _migrations (name,applied_at,checksum) VALUES ('0008_list_indexes.sql','2026-10-10T08:00:00.000Z','f9780f0301662f17023cb91ef4ca2b8b1c422ecb2b8bf3adbf447f81eeec4a8b');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-aino','aino','Aino','pbkdf2_sha256$600000$c2FsdA$aGFzaA','admin',0,'2026-09-01T08:00:00.000Z');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-eero','eero','Eero','pbkdf2_sha256$600000$c2FsdA$aGFzaA','member',1,'2026-09-01T08:00:00.000Z');
INSERT INTO sessions (id,user_id,created_at,expires_at,last_seen_at,user_agent) VALUES ('s-1','u-aino','2026-09-01T08:00:00.000Z','2099-01-01T00:00:00.000Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO bank_credentials (user_id,app_id,private_key_enc,updated_at) VALUES ('u-aino','app-1','v1.AAAAAAAAAAAAAAAA.sealed-blob-not-a-real-key','2026-09-01T08:00:00.000Z');
INSERT INTO connections (id,user_id,provider,institution,country,status,valid_until,created_at,last_synced_at) VALUES ('c-1','u-aino','enablebanking','Nordea','FI','active','2027-01-01T00:00:00Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-1','u-aino','c-1','enablebanking','ext-1','idn-1','Käyttötili','FI2112345600000785','EUR','checking',123456,'2026-09-30','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z');
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-2','u-aino',NULL,'csv',NULL,NULL,'Visa',NULL,'EUR','credit_card',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at) VALUES ('a-3','u-eero',NULL,'csv',NULL,NULL,'Eeron tili',NULL,'EUR','checking',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z');
INSERT INTO account_shares (account_id,user_id,created_at) VALUES ('a-1','u-eero','2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-01','u-aino','a-1','2026-08-03',NULL,-4590,'EUR','booked','K-MARKET HERTTONIEMI',NULL,'Korttiosto K-MARKET',NULL,'5411','K-MARKET','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','K-MARKET
K-MARKET HERTTONIEMI
KORTTIOSTO K-MARKET');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-02','u-aino','a-1','2026-08-05',NULL,312050,'EUR','booked','TYONANTAJA OY',NULL,'PALKKA 08/2026',NULL,NULL,'TYONANTAJA OY','salary','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','TYONANTAJA OY
TYONANTAJA OY
PALKKA 08/2026');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-03','u-aino','a-1','2026-08-07',NULL,-990,'EUR','booked',NULL,NULL,'NETFLIX.COM',NULL,NULL,'NETFLIX.COM','subscriptions','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z','NETFLIX.COM
NETFLIX.COM');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-04','u-aino','a-1','2026-08-09',NULL,-2500,'EUR','booked',NULL,NULL,'WOLT HELSINKI FI',NULL,'5812','WOLT HELSINKI FI','restaurants','mcc',0,'csv',NULL,'2026-09-01T08:00:00.000Z','WOLT HELSINKI FI
WOLT HELSINKI FI');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-05','u-aino','a-1','2026-09-01',NULL,-1500,'EUR','pending',NULL,NULL,NULL,NULL,NULL,'PENDING SHOP','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z','PENDING SHOP');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-06','u-aino','a-1','2026-09-02',NULL,-99999999999,'EUR','booked',NULL,NULL,'extreme amount',NULL,NULL,'EXTREME','other','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z','EXTREME
EXTREME AMOUNT');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-07','u-aino','a-1','2026-09-03',NULL,0,'EUR','booked',NULL,NULL,NULL,NULL,NULL,'ZERO','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z','ZERO');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-08','u-aino','a-2','2026-09-04',NULL,-35000,'EUR','booked',NULL,NULL,'VISA LASKU',NULL,NULL,'VISA LASKU','transfer','transfer',1,'csv',NULL,'2026-09-01T08:00:00.000Z','VISA LASKU
VISA LASKU');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-09','u-aino','a-1','2026-09-05',NULL,-60000,'EUR','booked',NULL,NULL,'NEWTECH TESTI 123',NULL,NULL,'NEWTECH TESTI 123','shopping','rule',0,'csv','{"kept":"as the bank sent it"}','2026-09-01T08:00:00.000Z','NEWTECH TESTI 123
NEWTECH TESTI 123');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text) VALUES ('t-10','u-eero','a-3','2026-09-06',NULL,-1200,'EUR','booked',NULL,NULL,'R-KIOSKI',NULL,NULL,'R-KIOSKI','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','R-KIOSKI
R-KIOSKI');
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (1,'u-aino','merchant','WOLT HELSINKI FI','restaurants',10,'2026-09-01T08:00:00.000Z');
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (2,'u-aino','description','^NEWTECH .*\d+$','shopping',10,'2026-09-01T08:00:00.000Z');
INSERT INTO sync_runs (id,user_id,trigger,started_at,finished_at,status,fetched,inserted,message) VALUES (1,'u-aino','schedule','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z','ok',9,9,NULL);
INSERT INTO settings (key,value,updated_at) VALUES ('data_version','7','2026-09-01T08:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('instance_settings','{"address":"http://localhost:8080","timeZone":"Europe/Helsinki","syncHours":[6,18],"industryLookup":true}','2026-09-01T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('K-MARKET','found','1234567-8','Kesko Oyj','47111','TOL2008','Vähittäiskauppa, päivittäistavarat','2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('NEWTECH TESTI 123','none',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('WOLT HELSINKI FI','ambiguous',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('ZERO','error',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','K-MARKET');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','NEWTECH TESTI 123');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','WOLT HELSINKI FI');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-eero','K-MARKET');
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (1,'2026-10-08T07:00:00.000Z','u-aino','login_ok','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (2,'2026-10-08T07:05:00.000Z','u-eero','login_fail','192.168.1.21','Mozilla/5.0 (iPhone) Safari/605.1',NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (3,'2026-10-08T07:06:00.000Z','u-eero','new_device','192.168.1.21','Mozilla/5.0 (iPhone) Safari/605.1','iPhone, Safari',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (4,'2026-10-08T07:30:00.000Z',NULL,'lockout','203.0.113.9',NULL,NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (5,'2026-10-08T08:00:00.000Z','u-aino','password_reset_by_admin','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',NULL,1,'2026-10-08T09:00:00.000Z');
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (6,'2026-10-08T08:10:00.000Z','u-aino','ops_request','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Varmuuskopio: jonossa',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (7,'2026-10-08T08:11:00.000Z','u-aino','ops_result',NULL,NULL,'Varmuuskopio: valmis',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (8,'2026-10-08T08:20:00.000Z','u-aino','ops_denied','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Päivitys: salasana',0,NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-1','backup','{}',NULL,'ok','u-aino','2026-10-08T08:10:00.000Z','2026-10-08T08:10:30.000Z','2026-10-08T08:11:00.000Z',0,'Varmuuskopio valmis','ok','["backup"]');
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-2','update','{}','115,101,97,108,101,100,45,98,108,111,98,45,110,111,116,45,97,45,114,101,97,108,45,115,101,99,114,101,116','failed','u-aino','2026-10-08T08:20:00.000Z','2026-10-08T08:20:30.000Z','2026-10-08T08:25:00.000Z',1,'Päivitys epäonnistui','build failed','["fetch","build"]');
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-3','doctor','{}',NULL,'expired','u-aino','2026-10-07T08:00:00.000Z',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-4','restart','{}',NULL,'queued','u-aino','2026-10-09T07:50:00.000Z',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-5','logs','{}',NULL,'ok','u-aino','2026-10-09T09:00:00.000Z','2026-10-09T09:00:10.000Z','2026-10-09T09:00:12.000Z',0,'Lokit luettu','app started',NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-6','prune','{}',NULL,'failed','u-aino','2026-10-09T09:10:00.000Z','2026-10-09T09:10:10.000Z','2026-10-09T09:10:20.000Z',1,'Siivous epäonnistui','docker: permission denied',NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-7','helper-renew','{}',NULL,'ok','u-aino','2026-10-09T09:20:00.000Z','2026-10-09T09:20:10.000Z','2026-10-09T09:20:30.000Z',0,'Apuri uusittu','helper 3',NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (9,'2026-10-09T09:20:00.000Z','u-aino','ops_request','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Apurin uusiminen: jonossa',0,NULL);
INSERT INTO settings (key,value,updated_at) VALUES ('data_version:u-aino','12','2026-10-09T09:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('data_version:u-eero','3','2026-10-09T09:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('needs_reprocess:u-eero','7f0c2d1e-3b5a-4c8d-9e6f-1a2b3c4d5e6f','2026-10-09T09:30:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build:u-aino','0.5.0+3f2a9c1','2026-10-09T08:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build:u-eero','0.4.0+812b219','2026-10-09T08:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build','0.4.0+812b219','2026-10-09T08:05:00.000Z');
