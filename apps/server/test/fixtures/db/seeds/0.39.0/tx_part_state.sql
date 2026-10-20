-- The state of two accounts: idn-5, built with lots (JSON), and idn-1, built with no trace ('null').
INSERT INTO tx_part_state (account_key,signature,built_at,lots) VALUES ('idn-5','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','2026-10-10T08:20:00.000Z','{"lots":[],"before":[],"creditCents":0,"openingCents":0}');
INSERT INTO tx_part_state (account_key,signature,built_at,lots) VALUES ('idn-1','fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210','2026-10-10T08:21:00.000Z','null');
