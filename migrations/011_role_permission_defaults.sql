INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE (r.role_key = 'game_admin' AND p.permission_key IN (
          'servers.read', 'servers.manage', 'plugins.read', 'plugins.manage', 'commerce.read'
       ))
    OR (r.role_key = 'moderator' AND p.permission_key IN ('community.moderate'))
    OR (r.role_key = 'support' AND p.permission_key IN ('identity.read', 'commerce.read'))
ON CONFLICT DO NOTHING;
