CREATE TABLE core.plugins (
  plugin_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('platform', 'atlas', '7dtd', 'ark')),
  latest_version TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (lifecycle_status IN ('DISCOVERED', 'VALIDATED', 'ENABLED', 'HEALTHY', 'DEGRADED', 'DISABLED', 'REMOVED')),
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.plugin_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id TEXT NOT NULL REFERENCES core.plugins(plugin_id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  api_version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  artifact_digest TEXT,
  artifact_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plugin_id, version)
);

CREATE TABLE core.plugin_dependencies (
  plugin_version_id UUID NOT NULL REFERENCES core.plugin_versions(id) ON DELETE CASCADE,
  dependency_plugin_id TEXT NOT NULL REFERENCES core.plugins(plugin_id) ON DELETE RESTRICT,
  required_version TEXT,
  PRIMARY KEY (plugin_version_id, dependency_plugin_id)
);

CREATE TABLE core.plugin_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  plugin_id TEXT NOT NULL REFERENCES core.plugins(plugin_id) ON DELETE RESTRICT,
  plugin_version_id UUID REFERENCES core.plugin_versions(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (lifecycle_status IN ('DISCOVERED', 'VALIDATED', 'ENABLED', 'HEALTHY', 'DEGRADED', 'DISABLED', 'REMOVED')),
  desired_state TEXT NOT NULL DEFAULT 'disabled'
    CHECK (desired_state IN ('enabled', 'disabled')),
  health_message TEXT,
  last_health_at TIMESTAMPTZ,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, plugin_id)
);
CREATE INDEX plugin_installations_server_idx ON core.plugin_installations (server_id, lifecycle_status);

CREATE TABLE core.plugin_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES core.plugin_installations(id) ON DELETE RESTRICT,
  config_version INTEGER NOT NULL CHECK (config_version > 0),
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES core.principals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, config_version)
);
CREATE UNIQUE INDEX plugin_configs_one_active_uq
  ON core.plugin_configs (installation_id) WHERE active = TRUE;

INSERT INTO core.roles (role_key, description) VALUES
  ('plugin_manager', 'Manage the shared plugin catalogue and releases'),
  ('plugin_runtime', 'Report plugin lifecycle and health for assigned servers')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description) VALUES
  ('plugins.read', 'Read plugin catalogue and assigned server installations'),
  ('plugins.report', 'Report plugin lifecycle and health for assigned servers')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE (r.role_key = 'plugin_manager' AND p.permission_key IN ('plugins.manage', 'plugins.read'))
    OR (r.role_key = 'plugin_runtime' AND p.permission_key IN ('plugins.read', 'plugins.report'))
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'server_admin'
   AND p.permission_key IN ('servers.read', 'servers.manage', 'plugins.read', 'plugins.manage')
ON CONFLICT DO NOTHING;
