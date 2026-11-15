-- Changes no table. Argon2id password hashes (security/password.ts) are written from this version on, and an older
-- version reads only PBKDF2 hashes, so it must not open this database as it is. The file has no compat floor on purpose:
-- older code refuses the database, and a rollback puts back the copy from before the update (docs/RELEASING.md,
-- "Passwords and rollback") instead of keeping a database whose members could not sign in.
SELECT 1;
