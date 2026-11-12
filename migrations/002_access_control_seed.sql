-- Permit relinking an identity after it has been explicitly unlinked.
ALTER TABLE core.linked_accounts DROP CONSTRAINT IF EXISTS linked_accounts_provider_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_active_provider_external_uq
  ON core.linked_accounts(provider, external_id) WHERE unlinked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_accounts_application_name_uq
  ON core.service_accounts(application_name);

INSERT INTO core.roles(name, description) VALUES
 ('platform_admin','Full platform administration; tightly restricted'),
 ('game_admin','Administration scoped to an individual game'),
 ('server_admin','Administration scoped to an individual server'),
 ('moderator','Community moderation within assigned scope'),
 ('support','Player support operations'),
 ('player','Standard player access')
ON CONFLICT(name) DO NOTHING;

INSERT INTO core.permissions(permission_key, description) VALUES
 ('platform.manage','Manage platform configuration'),
 ('accounts.read','Read player account records'),
 ('accounts.manage','Manage player accounts and verified identity links'),
 ('games.read','Read game catalog and server status'),
 ('games.manage','Manage game configuration'),
 ('servers.read','Read server status and metadata'),
 ('servers.manage','Manage assigned game servers'),
 ('community.moderate','Moderate community activity'),
 ('support.manage','Handle player support cases'),
 ('commerce.read','Read orders and entitlements'),
 ('commerce.manage','Manage commerce catalog and refunds'),
 ('rewards.deliver','Queue and reconcile game reward delivery')
ON CONFLICT(permission_key) DO NOTHING;

INSERT INTO core.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON
 (r.name = 'platform_admin' AND p.permission_key IN
  ('platform.manage','accounts.read','accounts.manage','games.read','games.manage','servers.read','servers.manage','community.moderate','support.manage','commerce.read','commerce.manage','rewards.deliver'))
 OR (r.name = 'game_admin' AND p.permission_key IN ('games.read','games.manage','servers.read','servers.manage','rewards.deliver'))
 OR (r.name = 'server_admin' AND p.permission_key IN ('games.read','servers.read','servers.manage'))
 OR (r.name = 'moderator' AND p.permission_key IN ('community.moderate'))
 OR (r.name = 'support' AND p.permission_key IN ('accounts.read','support.manage','commerce.read'))
 OR (r.name = 'player' AND p.permission_key IN ('games.read','servers.read'))
ON CONFLICT DO NOTHING;
