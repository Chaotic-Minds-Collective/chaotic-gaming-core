ALTER TABLE core.linked_accounts
  DROP CONSTRAINT IF EXISTS linked_accounts_provider_external_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_provider_external_id_active_idx
  ON core.linked_accounts (provider, external_id)
  WHERE unlinked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_principal_provider_active_idx
  ON core.linked_accounts (principal_id, provider)
  WHERE unlinked_at IS NULL;

CREATE TABLE IF NOT EXISTS core.identity_assertion_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS identity_assertion_nonces_created_idx
  ON core.identity_assertion_nonces (created_at);
