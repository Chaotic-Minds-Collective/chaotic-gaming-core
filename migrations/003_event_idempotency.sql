ALTER TABLE operations.event_outbox ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_idempotency_uq
  ON operations.event_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;
