CREATE TABLE operations.game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'player.joined', 'player.left', 'player.chat',
    'server.started', 'server.stopped', 'player.died'
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, external_event_id)
);
CREATE INDEX game_events_server_occurred_idx
  ON operations.game_events (server_id, occurred_at DESC);
CREATE INDEX game_events_type_occurred_idx
  ON operations.game_events (event_type, occurred_at DESC);

INSERT INTO core.roles (role_key, description)
VALUES ('game_event_publisher', 'Publish normalized events from assigned game servers')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description)
VALUES ('events.publish', 'Publish normalized events for assigned game servers')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'game_event_publisher'
   AND p.permission_key = 'events.publish'
ON CONFLICT DO NOTHING;
