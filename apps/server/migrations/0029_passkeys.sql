-- Passkeys as a second sign-in factor (kind 'passkey' in user_factor, services/passkeys.ts). The public key of a passkey
-- is not a secret, so it is stored as it is in `secret` (base64url, COSE); last_step holds the signature counter and
-- label the name the member gave the device. credential_id is what the browser names a passkey by (base64url, unique
-- across users: an authenticator makes it for one site), transports the JSON list the browser reported, for the hint
-- of the next sign-in. Only adds columns and an index. No compat floor: an older version would ignore a passkey and
-- let its owner in with the password alone, so it refuses this database and a rollback restores the copy from before.
ALTER TABLE user_factor ADD COLUMN credential_id TEXT;
ALTER TABLE user_factor ADD COLUMN transports TEXT;
-- rp_id is the host the passkey was made for. A browser signs a passkey only for that host, so a change of the install's
-- address leaves the old ones unusable and the publish check counts only those made for the address to publish.
ALTER TABLE user_factor ADD COLUMN rp_id TEXT;
CREATE UNIQUE INDEX idx_user_factor_credential ON user_factor(credential_id) WHERE credential_id IS NOT NULL;
