INSERT INTO core.roles (role_key, description)
VALUES ('server_heartbeat', 'Report health for assigned game servers only')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description)
VALUES ('servers.heartbeat', 'Submit health heartbeats for assigned game servers')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'server_heartbeat'
   AND p.permission_key = 'servers.heartbeat'
ON CONFLICT DO NOTHING;
