ALTER TABLE core.servers
  ADD COLUMN public_hostname TEXT,
  ADD COLUMN game_port INTEGER,
  ADD COLUMN query_port INTEGER,
  ADD COLUMN max_players INTEGER,
  ADD COLUMN map_name TEXT,
  ADD COLUMN is_listed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE core.servers
  ADD CONSTRAINT servers_game_port_range
    CHECK (game_port IS NULL OR game_port BETWEEN 1 AND 65535),
  ADD CONSTRAINT servers_query_port_range
    CHECK (query_port IS NULL OR query_port BETWEEN 1 AND 65535),
  ADD CONSTRAINT servers_max_players_positive
    CHECK (max_players IS NULL OR max_players BETWEEN 1 AND 10000),
  ADD CONSTRAINT servers_public_listing_requires_endpoint
    CHECK (NOT is_listed OR (public_hostname IS NOT NULL AND game_port IS NOT NULL));

CREATE INDEX servers_public_listing_idx
  ON core.servers (game_key, is_listed, status);
