CREATE TABLE core.games (
  game_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (lifecycle_status IN ('planned', 'testing', 'active', 'paused', 'retired'))
);

CREATE TABLE core.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'paused', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_key, name)
);

CREATE TABLE core.servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'development'
    CHECK (environment IN ('development', 'test', 'staging', 'production')),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'provisioning', 'online', 'offline', 'maintenance', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX servers_cluster_idx ON core.servers (cluster_id);
CREATE INDEX servers_game_status_idx ON core.servers (game_key, status);

CREATE TABLE operations.server_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  server_version TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  online BOOLEAN NOT NULL,
  player_count INTEGER CHECK (player_count IS NULL OR player_count >= 0),
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX server_heartbeats_latest_idx ON operations.server_heartbeats (server_id, received_at DESC);

INSERT INTO core.games (game_key, display_name, lifecycle_status) VALUES
  ('atlas', 'ATLAS', 'testing'),
  ('7dtd', '7 Days to Die', 'testing'),
  ('ark', 'ARK: Survival Evolved', 'planned')
ON CONFLICT (game_key) DO NOTHING;
