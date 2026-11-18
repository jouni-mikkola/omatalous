-- migrate: compat 0.64.0
-- The published fixings of the euribor rates a loan can follow (services/reference-rates.ts), one row per rate and day.
-- Public market data of the whole install, not a member's: no user id, and every member's loans read the same rows.
-- rate_milli is thousandths of a percent as published (3328 is 3,328 %) and is negative where the fixing was.
-- Only adds a table, which older code neither reads nor writes: 0.64.0 opens a database that has it and a rollback keeps it.
CREATE TABLE reference_rates (
  reference TEXT NOT NULL CHECK (reference IN ('euribor_3', 'euribor_6', 'euribor_12')),
  day       TEXT NOT NULL,
  rate_milli INTEGER NOT NULL,
  PRIMARY KEY (reference, day)
) WITHOUT ROWID;
