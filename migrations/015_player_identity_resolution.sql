INSERT INTO core.permissions (permission_key, description)
VALUES ('players.resolve', 'Resolve a verified external game identity to its linked Chaotic Gaming player')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'game_event_publisher'
   AND p.permission_key = 'players.resolve'
ON CONFLICT DO NOTHING;
