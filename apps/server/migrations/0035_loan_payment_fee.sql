-- migrate: compat 0.64.0
-- The fee each payment of a loan carries, as the user typed it, in cents: a plan at 0 % with a fee on every payment is
-- dear, and one with none costs nothing, so the household tells which (`debtCost`). 0 is an answer, a fee of nothing.
-- NULL: none typed, for every loan there is, and the cost of a plan at 0 % with no other evidence stays unknown. A
-- payment split a loan document stated (`loan_payment_parts`) comes first; the fee the rows measure comes after this one.
-- Only adds one nullable column, which older code neither reads nor writes, so 0.64.0 opens a database that has it and
-- a rollback keeps the fee.
ALTER TABLE loans ADD COLUMN payment_fee_cents INTEGER CHECK (payment_fee_cents >= 0);
