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
  id UUID PRIMARY KEY,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'service')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'disabled', 'deletion_pending', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.users (
  principal_id UUID PRIMARY KEY REFERENCES core.principals(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  email TEXT,
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,32}$')
);
CREATE UNIQUE INDEX users_username_lower_uq ON core.users (lower(username));
CREATE UNIQUE INDEX users_email_lower_uq ON core.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE core.user_profiles (
  principal_id UUID PRIMARY KEY REFERENCES core.users(principal_id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.linked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_username TEXT,
  verified_at TIMESTAMPTZ NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ,
  CONSTRAINT linked_accounts_provider_format CHECK (provider ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT linked_accounts_external_id_nonempty CHECK (length(external_id) BETWEEN 1 AND 255)
);
CREATE UNIQUE INDEX linked_accounts_active_external_uq
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX identity_verifications_expiry_idx ON core.identity_verifications (expires_at);

CREATE TABLE core.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.principals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET
);
CREATE INDEX auth_sessions_principal_idx ON core.auth_sessions (principal_id);
CREATE INDEX auth_sessions_expiry_idx ON core.auth_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE core.service_accounts (
  principal_id UUID PRIMARY KEY REFERENCES core.principals(id) ON DELETE RESTRICT,
  application_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.service_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.service_accounts(principal_id) ON DELETE CASCADE,
  credential_name TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX service_credentials_active_idx ON core.service_credentials (principal_id) WHERE revoked_at IS NULL;

CREATE TABLE core.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
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
  scope_id TEXT NOT NULL DEFAULT '*',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  granted_by UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX principal_role_active_uq
  ON core.principal_role_assignments (principal_id, role_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;
CREATE INDEX principal_role_scope_idx
  ON core.principal_role_assignments (scope_type, scope_id) WHERE revoked_at IS NULL;

CREATE TABLE core.games (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL REFERENCES core.games(id),
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'maintenance', 'offline', 'retired')),
  UNIQUE (game_id, slug)
);
CREATE TABLE core.servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id),
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  host_label TEXT,
  game_port INTEGER CHECK (game_port BETWEEN 1 AND 65535),
  query_port INTEGER CHECK (query_port BETWEEN 1 AND 65535),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'online', 'offline', 'maintenance', 'retired')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, slug)
);

CREATE TABLE operations.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_principal_id UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_time_idx ON operations.audit_logs (actor_principal_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON operations.audit_logs (resource_type, resource_id, created_at DESC);

CREATE TABLE operations.event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version > 0),
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT
);
CREATE INDEX event_outbox_pending_idx ON operations.event_outbox (available_at, occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE operations.event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscriber_key, event_type)
);
CREATE TABLE operations.event_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES operations.event_outbox(id) ON DELETE CASCADE,
  subscriber_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (event_id, subscriber_key)
);
CREATE INDEX event_deliveries_pending_idx ON operations.event_deliveries (available_at)
  WHERE status IN ('pending', 'failed');

INSERT INTO core.games (id, display_name, status) VALUES
  ('atlas', 'ATLAS', 'planned'),
  ('7dtd', '7 Days to Die', 'planned'),
  ('ark-se', 'ARK: Survival Evolved', 'planned')
ON CONFLICT (id) DO NOTHING;
