-- Payment splits a loan document stated, for loans of two users: two payments of one loan (one with a fee, one without),
-- and one of the other user's loan with no repayment (an interest-only month).
INSERT INTO loan_payment_parts (user_id,loan_id,due_date,principal_cents,interest_cents,fee_cents) VALUES ('u-aino','c1e2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d','2026-09-15',61234,40518,250);
INSERT INTO loan_payment_parts (user_id,loan_id,due_date,principal_cents,interest_cents,fee_cents) VALUES ('u-aino','c1e2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d','2026-10-15',61391,40361,0);
INSERT INTO loan_payment_parts (user_id,loan_id,due_date,principal_cents,interest_cents,fee_cents) VALUES ('u-eero','c1e2c3d4-0003-4a5b-8c6d-7e8f9a0b1c2d','2026-10-01',0,12875,300);
