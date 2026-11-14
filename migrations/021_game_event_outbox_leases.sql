ALTER TABLE operations.event_outbox
  ADD COLUMN claimed_by_principal_id UUID REFERENCES core.principals(id) ON DELETE RESTRICT,
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ;

CREATE INDEX event_outbox_game_claimable_idx
  ON operations.event_outbox (available_at, occurred_at, id)
  WHERE processed_at IS NULL AND event_type = 'game.event.received';

INSERT INTO core.roles (role_key, description)
VALUES ('game_event_consumer', 'Claim and acknowledge normalized game events for assigned servers')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description) VALUES
  ('events.claim', 'Claim pending normalized game events for assigned servers'),
  ('events.ack', 'Acknowledge normalized game event processing for assigned servers')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'game_event_consumer'
   AND p.permission_key IN ('events.claim', 'events.ack')
ON CONFLICT DO NOTHING;
