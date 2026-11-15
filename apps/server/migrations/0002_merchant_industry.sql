-- Industry of a merchant from the Finnish trade register (PRH open data),
-- keyed by the merchant name the app shows. Public company data only: no
-- user ids, amounts or dates. Shared by all users so a name is looked up once.
-- The category is not stored: it is derived from the code at every reprocess,
-- so a new version's code table applies without a migration.
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

-- Which user's lookups asked about which name. A user sees a register answer
-- only for names recorded here for them, so the shared cache above does not
-- tell one member what another member's lookups found.
CREATE TABLE merchant_industry_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  PRIMARY KEY (user_id, merchant)
);
