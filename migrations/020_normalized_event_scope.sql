-- Extend normalized game-event scope and vocabulary for cross-grid adapters.
-- Existing rows are backfilled from their authoritative server registration.
ALTER TABLE operations.game_events
  ADD COLUMN cluster_id UUID REFERENCES core.clusters(id) ON DELETE RESTRICT,
  ADD COLUMN grid_id TEXT,
  ADD COLUMN correlation_id TEXT;

UPDATE operations.game_events AS events
   SET cluster_id = servers.cluster_id
  FROM core.servers AS servers
 WHERE servers.id = events.server_id;

ALTER TABLE operations.game_events
  ALTER COLUMN cluster_id SET NOT NULL,
  ADD CONSTRAINT game_events_grid_id_length_check
    CHECK (grid_id IS NULL OR length(btrim(grid_id)) BETWEEN 1 AND 200),
  ADD CONSTRAINT game_events_correlation_id_length_check
    CHECK (correlation_id IS NULL OR length(btrim(correlation_id)) BETWEEN 1 AND 200);

ALTER TABLE operations.game_events
  DROP CONSTRAINT IF EXISTS game_events_event_type_check;

ALTER TABLE operations.game_events
  ADD CONSTRAINT game_events_event_type_check CHECK (event_type IN (
    'player.joined', 'player.left', 'player.connected', 'player.disconnected',
    'player.chat', 'player.died', 'player.killed',
    'character.created', 'character.transferred',
    'tribe.created', 'tribe.member.joined', 'tribe.member.left', 'tribe.updated',
    'chat.global', 'chat.tribe',
    'ship.sunk', 'ship.retrieved', 'structure.destroyed', 'tame.created', 'tame.died',
    'server.started', 'server.stopped', 'server.state.changed'
  ));

CREATE INDEX game_events_cluster_occurred_idx
  ON operations.game_events (cluster_id, occurred_at DESC);
CREATE INDEX game_events_correlation_idx
  ON operations.game_events (correlation_id)
  WHERE correlation_id IS NOT NULL;
