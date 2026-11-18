-- migrate: compat 0.64.0
-- A step in a loan's typed rate, as the user typed it: the day the rate changes and the rate from that day on, in
-- hundredths of a percent (a promotional rate that ends, or a rate the loan agreement says will rise). One step a loan.
-- NULL in both: no step typed, for every loan there is. The routes keep the two together (routes/loans.ts), and the
-- rate path of core reads them (`ratePathOf`).
-- Only adds two nullable columns, which older code neither reads nor writes, so 0.64.0 opens a database that has them
-- and a rollback keeps the steps. A date is YYYY-MM-DD as in the other date columns of this table.
ALTER TABLE loans ADD COLUMN rate_step_date TEXT;
ALTER TABLE loans ADD COLUMN rate_step_bp INTEGER CHECK (rate_step_bp >= 0);
