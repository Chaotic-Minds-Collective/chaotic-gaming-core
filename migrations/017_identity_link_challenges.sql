CREATE TABLE IF NOT EXISTS core.identity_link_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS identity_link_challenges_active_idx
  ON core.identity_link_challenges (provider, principal_id, expires_at)
  WHERE consumed_at IS NULL;
