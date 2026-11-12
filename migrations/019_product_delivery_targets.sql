ALTER TABLE commerce.product_game_mappings
  ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES core.servers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS product_game_mappings_server_idx
  ON commerce.product_game_mappings(server_id)
  WHERE server_id IS NOT NULL;
