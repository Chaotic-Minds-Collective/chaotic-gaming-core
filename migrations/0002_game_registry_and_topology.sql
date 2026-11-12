-- Game catalog and server topology. Game-specific schemas are deliberately separate.
CREATE TABLE core.games (
  game_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  integration_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (integration_status IN ('planned', 'development', 'available', 'maintenance', 'retired')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.clusters (
  id UUID PRIMARY KEY,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  cluster_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'online', 'offline', 'maintenance', 'retired')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_key, cluster_key),
  UNIQUE (id, game_key)
);

CREATE TABLE core.servers (
  id UUID PRIMARY KEY,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  cluster_id UUID,
  server_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'online', 'offline', 'maintenance', 'retired')),
  public_host TEXT,
  public_port INTEGER CHECK (public_port BETWEEN 1 AND 65535),
  query_host TEXT,
  query_port INTEGER CHECK (query_port BETWEEN 1 AND 65535),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (cluster_id, game_key) REFERENCES core.clusters(id, game_key) ON DELETE RESTRICT,
  UNIQUE (game_key, server_key),
  CONSTRAINT server_cluster_game_pair CHECK (cluster_id IS NOT NULL OR game_key IS NOT NULL)
);
CREATE INDEX servers_cluster_status_idx ON core.servers (cluster_id, status);

CREATE SCHEMA IF NOT EXISTS games_atlas;
CREATE TABLE games_atlas.grids (
  id UUID PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  grid_key TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, grid_key),
  UNIQUE (server_id)
);
CREATE TABLE games_atlas.characters (
  id UUID PRIMARY KEY,
  owner_principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_character_id TEXT NOT NULL,
  character_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (cluster_id, external_character_id)
);
CREATE TABLE games_atlas.character_locations (
  character_id UUID PRIMARY KEY REFERENCES games_atlas.characters(id) ON DELETE CASCADE,
  grid_id UUID REFERENCES games_atlas.grids(id) ON DELETE SET NULL,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE games_atlas.tribes (
  id UUID PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_tribe_id TEXT NOT NULL,
  tribe_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, external_tribe_id)
);
CREATE TABLE games_atlas.tribe_members (
  tribe_id UUID NOT NULL REFERENCES games_atlas.tribes(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES games_atlas.characters(id) ON DELETE CASCADE,
  member_role TEXT,
  joined_at TIMESTAMPTZ,
  PRIMARY KEY (tribe_id, character_id)
);
CREATE TABLE games_atlas.character_transfers (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES games_atlas.characters(id) ON DELETE CASCADE,
  source_grid_id UUID REFERENCES games_atlas.grids(id) ON DELETE SET NULL,
  destination_grid_id UUID REFERENCES games_atlas.grids(id) ON DELETE SET NULL,
  transfer_status TEXT NOT NULL CHECK (transfer_status IN ('requested', 'completed', 'failed', 'cancelled')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE SCHEMA IF NOT EXISTS games_7dtd;
CREATE TABLE games_7dtd.worlds (
  id UUID PRIMARY KEY,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  world_key TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, world_key)
);
CREATE TABLE games_7dtd.players (
  id UUID PRIMARY KEY,
  owner_principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  external_player_id TEXT NOT NULL,
  player_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (server_id, external_player_id)
);
CREATE TABLE games_7dtd.player_sessions (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES games_7dtd.players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  session_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE SCHEMA IF NOT EXISTS games_ark;
CREATE TABLE games_ark.maps (
  id UUID PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  map_key TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, map_key),
  UNIQUE (server_id)
);
CREATE TABLE games_ark.survivors (
  id UUID PRIMARY KEY,
  owner_principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_survivor_id TEXT NOT NULL,
  survivor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (cluster_id, external_survivor_id)
);
CREATE TABLE games_ark.tribes (
  id UUID PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_tribe_id TEXT NOT NULL,
  tribe_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, external_tribe_id)
);
CREATE TABLE games_ark.tribe_members (
  tribe_id UUID NOT NULL REFERENCES games_ark.tribes(id) ON DELETE CASCADE,
  survivor_id UUID NOT NULL REFERENCES games_ark.survivors(id) ON DELETE CASCADE,
  member_role TEXT,
  joined_at TIMESTAMPTZ,
  PRIMARY KEY (tribe_id, survivor_id)
);
CREATE TABLE games_ark.survivor_transfers (
  id UUID PRIMARY KEY,
  survivor_id UUID NOT NULL REFERENCES games_ark.survivors(id) ON DELETE CASCADE,
  source_map_id UUID REFERENCES games_ark.maps(id) ON DELETE SET NULL,
  destination_map_id UUID REFERENCES games_ark.maps(id) ON DELETE SET NULL,
  transfer_status TEXT NOT NULL CHECK (transfer_status IN ('requested', 'completed', 'failed', 'cancelled')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
