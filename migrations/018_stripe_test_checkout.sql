ALTER TABLE commerce.payment_transactions
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE commerce.entitlements
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0);

CREATE UNIQUE INDEX IF NOT EXISTS entitlements_order_item_uq
  ON commerce.entitlements(order_item_id)
  WHERE order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_transactions_active_checkout_idx
  ON commerce.payment_transactions(order_id, created_at DESC)
  WHERE provider = 'stripe' AND status IN ('created', 'pending');

CREATE TABLE IF NOT EXISTS commerce.payment_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_transaction_id UUID NOT NULL
    REFERENCES commerce.payment_transactions(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);
