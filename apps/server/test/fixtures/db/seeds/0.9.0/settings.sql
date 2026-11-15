-- Settings of 0.9.0, three made-up ones: the result of the check of the newest database copy (copy_check, a JSON
-- object with at, file, ok and reason: services/db-health.ts), the time the setup code for the first admin was made
-- (setup_code_at, an ISO time: services/users.ts) and the time of the last rollback report of the host helper that was
-- told to the admins (ops_watchdog_at: services/ops-watchdog.ts, the same time as the ops_watchdog event in security_events.sql).
INSERT INTO settings (key,value,updated_at) VALUES ('copy_check','{"at":"2026-10-10T03:05:00.000Z","file":"auto-20261010T030000.db","ok":true,"reason":null}','2026-10-10T03:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('setup_code_at','2026-09-01T07:55:00.000Z','2026-09-01T07:55:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('ops_watchdog_at','2026-10-09T09:40:00.000Z','2026-10-09T09:40:01.000Z');
