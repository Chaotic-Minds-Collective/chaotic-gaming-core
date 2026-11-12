ALTER TABLE core.users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Password hashes are Argon2id PHC strings. Never store plaintext passwords.
-- Existing users may remain passwordless and authenticate through verified linked providers.
CREATE INDEX IF NOT EXISTS auth_sessions_active_principal_idx
  ON core.auth_sessions (principal_id, expires_at)
  WHERE revoked_at IS NULL;
