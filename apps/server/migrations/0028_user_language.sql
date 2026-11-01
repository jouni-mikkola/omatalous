-- migrate: compat 0.64.0
-- The language a member reads the app in, chosen by the member (Asetukset > Turvallisuus). Only adds a column with a
-- default, which older code neither reads nor writes: 0.64.0 opens a database that has it and a rollback keeps the choice.
-- language: 'fi' or 'en', the codes of core `LANGUAGES`; the route checks the value against that list.
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'fi';
