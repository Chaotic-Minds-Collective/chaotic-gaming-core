CREATE TABLE commerce.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('digital_item', 'game_entitlement', 'subscription', 'supporter', 'currency_pack', 'service')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE commerce.product_game_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES commerce.products(id) ON DELETE RESTRICT,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  delivery_type TEXT NOT NULL,
  delivery_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (product_id, game_key)
);

CREATE TABLE commerce.product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES commerce.products(id) ON DELETE RESTRICT,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_until TIMESTAMPTZ,
  CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE INDEX product_prices_active_idx ON commerce.product_prices (product_id, currency, active_from DESC);

CREATE TABLE commerce.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed')),
  currency CHAR(3) NOT NULL,
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (principal_id, idempotency_key),
  CHECK (total_minor = subtotal_minor + tax_minor)
);
CREATE INDEX orders_principal_created_idx ON commerce.orders (principal_id, created_at DESC);

CREATE TABLE commerce.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES commerce.products(id) ON DELETE RESTRICT,
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor BIGINT NOT NULL CHECK (unit_amount_minor >= 0),
  line_total_minor BIGINT NOT NULL CHECK (line_total_minor >= 0),
  CHECK (line_total_minor = quantity * unit_amount_minor)
);

CREATE TABLE commerce.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  provider_event_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_transaction_id),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE commerce.entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES commerce.products(id) ON DELETE RESTRICT,
  order_item_id UUID REFERENCES commerce.order_items(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX entitlements_principal_idx ON commerce.entitlements (principal_id, status);

CREATE TABLE commerce.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE RESTRICT,
  currency_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (principal_id, currency_code)
);

CREATE TABLE commerce.wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES commerce.wallets(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit', 'refund', 'adjustment')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX wallet_ledger_wallet_created_idx ON commerce.wallet_ledger (wallet_id, created_at);

CREATE TABLE commerce.reward_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES commerce.entitlements(id) ON DELETE RESTRICT,
  game_key TEXT NOT NULL REFERENCES core.games(game_key) ON DELETE RESTRICT,
  server_id UUID REFERENCES core.servers(id) ON DELETE RESTRICT,
  target_external_id TEXT NOT NULL,
  delivery_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX reward_queue_pending_idx ON commerce.reward_queue (available_at, created_at) WHERE status IN ('pending', 'failed');

CREATE TABLE commerce.reward_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id UUID NOT NULL REFERENCES commerce.reward_queue(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reward_id, attempt_number)
);

CREATE TABLE commerce.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_transaction_id UUID NOT NULL REFERENCES commerce.payment_transactions(id) ON DELETE RESTRICT,
  provider_refund_id TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_refund_id)
);
