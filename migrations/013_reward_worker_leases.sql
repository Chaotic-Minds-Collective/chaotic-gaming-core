ALTER TABLE commerce.reward_queue
  ADD COLUMN claimed_by_principal_id UUID REFERENCES core.principals(id) ON DELETE RESTRICT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ;

CREATE INDEX reward_queue_server_claimable_idx
  ON commerce.reward_queue (server_id, available_at, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

INSERT INTO core.roles (role_key, description)
VALUES ('reward_worker', 'Claim and acknowledge game reward deliveries for assigned servers')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO core.permissions (permission_key, description) VALUES
  ('rewards.claim', 'Claim pending game reward deliveries for assigned servers'),
  ('rewards.ack', 'Acknowledge delivery outcomes for assigned servers')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM core.roles r
  CROSS JOIN core.permissions p
 WHERE r.role_key = 'reward_worker'
   AND p.permission_key IN ('rewards.claim', 'rewards.ack')
ON CONFLICT DO NOTHING;
