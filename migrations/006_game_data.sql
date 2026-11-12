-- ATLAS: clusters contain maps/grids; each map is hosted by a server.
CREATE TABLE games_atlas.maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL UNIQUE REFERENCES core.servers(id) ON DELETE RESTRICT,
  map_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cluster_id, map_key)
);

CREATE TABLE games_atlas.tribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_tribe_id TEXT NOT NULL,
  name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (cluster_id, external_tribe_id)
);

CREATE TABLE games_atlas.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  map_id UUID REFERENCES games_atlas.maps(id) ON DELETE SET NULL,
  external_character_id TEXT NOT NULL,
  character_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (map_id, external_character_id)
);
CREATE INDEX atlas_characters_principal_idx ON games_atlas.characters (principal_id);

CREATE TABLE games_atlas.tribe_members (
  tribe_id UUID NOT NULL REFERENCES games_atlas.tribes(id) ON DELETE RESTRICT,
  character_id UUID NOT NULL REFERENCES games_atlas.characters(id) ON DELETE RESTRICT,
  member_role TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (tribe_id, character_id, joined_at)
);

CREATE TABLE games_atlas.player_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES games_atlas.characters(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX atlas_sessions_character_started_idx ON games_atlas.player_sessions (character_id, started_at DESC);

CREATE TABLE games_atlas.character_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES games_atlas.characters(id) ON DELETE RESTRICT,
  from_map_id UUID REFERENCES games_atlas.maps(id) ON DELETE RESTRICT,
  to_map_id UUID REFERENCES games_atlas.maps(id) ON DELETE RESTRICT,
  external_transfer_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiated', 'completed', 'failed', 'cancelled')),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (from_map_id IS DISTINCT FROM to_map_id)
);

-- 7 Days to Die: world and player identity are scoped to a server.
CREATE TABLE games_7dtd.worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL UNIQUE REFERENCES core.servers(id) ON DELETE RESTRICT,
  world_name TEXT NOT NULL,
  world_seed TEXT,
  world_size INTEGER CHECK (world_size IS NULL OR world_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE games_7dtd.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  external_player_id TEXT NOT NULL,
  player_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (server_id, external_player_id)
);
CREATE INDEX seven_dtd_players_principal_idx ON games_7dtd.players (principal_id);

CREATE TABLE games_7dtd.player_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES games_7dtd.players(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE games_7dtd.player_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  player_id UUID REFERENCES games_7dtd.players(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, external_event_id)
);

-- ARK: Survival Evolved, deliberately isolated from ARK: Survival Ascended.
CREATE TABLE games_ark.maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL UNIQUE REFERENCES core.servers(id) ON DELETE RESTRICT,
  map_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  UNIQUE (cluster_id, map_key)
);

CREATE TABLE games_ark.tribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES core.clusters(id) ON DELETE RESTRICT,
  external_tribe_id TEXT NOT NULL,
  name TEXT,
  UNIQUE (cluster_id, external_tribe_id)
);

CREATE TABLE games_ark.survivors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  map_id UUID REFERENCES games_ark.maps(id) ON DELETE SET NULL,
  external_survivor_id TEXT NOT NULL,
  survivor_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (map_id, external_survivor_id)
);
CREATE INDEX ark_survivors_principal_idx ON games_ark.survivors (principal_id);

CREATE TABLE games_ark.tribe_members (
  tribe_id UUID NOT NULL REFERENCES games_ark.tribes(id) ON DELETE RESTRICT,
  survivor_id UUID NOT NULL REFERENCES games_ark.survivors(id) ON DELETE RESTRICT,
  member_role TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (tribe_id, survivor_id, joined_at)
);

CREATE TABLE games_ark.player_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id UUID NOT NULL REFERENCES games_ark.survivors(id) ON DELETE RESTRICT,
  server_id UUID NOT NULL REFERENCES core.servers(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE games_ark.survivor_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id UUID NOT NULL REFERENCES games_ark.survivors(id) ON DELETE RESTRICT,
  from_map_id UUID REFERENCES games_ark.maps(id) ON DELETE RESTRICT,
  to_map_id UUID REFERENCES games_ark.maps(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('initiated', 'completed', 'failed', 'cancelled')),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (from_map_id IS DISTINCT FROM to_map_id)
);
