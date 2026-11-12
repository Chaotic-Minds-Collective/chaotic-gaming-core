CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS community;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS integrations;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS games_atlas;
CREATE SCHEMA IF NOT EXISTS games_7dtd;
CREATE SCHEMA IF NOT EXISTS games_ark;

CREATE TABLE core.principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'service')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'disabled', 'deletion_pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.users (
  principal_id UUID PRIMARY KEY REFERENCES core.principals(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  email TEXT,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_username_length CHECK (char_length(username) BETWEEN 3 AND 32)
);
CREATE UNIQUE INDEX users_username_lower_uq ON core.users (LOWER(username));
CREATE UNIQUE INDEX users_email_lower_uq ON core.users (LOWER(email)) WHERE email IS NOT NULL;

CREATE TABLE core.user_profiles (
  principal_id UUID PRIMARY KEY REFERENCES core.users(principal_id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.linked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_username TEXT,
  verified_at TIMESTAMPTZ NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlinked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT linked_accounts_provider_nonempty CHECK (length(trim(provider)) > 0),
  CONSTRAINT linked_accounts_external_nonempty CHECK (length(trim(external_id)) > 0)
);
CREATE UNIQUE INDEX linked_accounts_provider_external_uq
  ON core.linked_accounts (provider, external_id) WHERE unlinked_at IS NULL;
CREATE INDEX linked_accounts_principal_idx ON core.linked_accounts (principal_id);

CREATE TABLE core.identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  method TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX identity_verifications_expiry_idx ON core.identity_verifications (expires_at);

CREATE TABLE core.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.principals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET
);
CREATE INDEX auth_sessions_principal_idx ON core.auth_sessions (principal_id);
CREATE INDEX auth_sessions_active_expiry_idx ON core.auth_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE core.service_accounts (
  principal_id UUID PRIMARY KEY REFERENCES core.principals(id) ON DELETE RESTRICT,
  application_name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.service_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.service_accounts(principal_id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX service_credentials_principal_idx ON core.service_credentials (principal_id);

CREATE TABLE core.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE core.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE core.role_permissions (
  role_id UUID NOT NULL REFERENCES core.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES core.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE core.principal_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.principals(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES core.roles(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('platform', 'game', 'cluster', 'server', 'guild')),
  scope_id TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  granted_by UUID REFERENCES core.principals(id),
  CONSTRAINT role_scope_id_required CHECK (
    (scope_type = 'platform' AND scope_id IS NULL) OR
    (scope_type <> 'platform' AND scope_id IS NOT NULL)
  )
);
CREATE INDEX role_assignments_principal_idx ON core.principal_role_assignments (principal_id);
CREATE INDEX role_assignments_scope_idx ON core.principal_role_assignments (scope_type, scope_id);

CREATE TABLE operations.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_principal_id UUID REFERENCES core.principals(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_actor_created_idx ON operations.audit_logs (actor_principal_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON operations.audit_logs (resource_type, resource_id);

CREATE TABLE operations.event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX event_outbox_pending_idx ON operations.event_outbox (available_at, occurred_at)
  WHERE processed_at IS NULL;

INSERT INTO core.roles (role_key, description) VALUES
  ('platform_admin', 'Full platform administration'),
  ('game_admin', 'Administration scoped to a game'),
  ('server_admin', 'Administration scoped to a server'),
  ('moderator', 'Community moderation within assigned scope'),
  ('support', 'Player support within assigned scope'),
  ('player', 'Standard player access')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description) VALUES
  ('platform.manage', 'Manage platform configuration'),
  ('identity.read', 'Read player identity information'),
  ('identity.link', 'Link and unlink verified external identities'),
  ('players.manage', 'Manage player accounts'),
  ('servers.read', 'Read game server status'),
  ('servers.manage', 'Manage assigned game servers'),
  ('community.moderate', 'Moderate community spaces'),
  ('commerce.read', 'Read commerce and entitlement records'),
  ('commerce.manage', 'Manage products, orders and entitlements'),
  ('plugins.manage', 'Manage game server plugins')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM core.roles r CROSS JOIN core.permissions p
WHERE r.role_key = 'platform_admin'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM core.roles r
JOIN core.permissions p ON p.permission_key IN ('identity.read', 'servers.read')
WHERE r.role_key = 'player'
ON CONFLICT DO NOTHING;
