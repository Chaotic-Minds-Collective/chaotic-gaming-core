CREATE TABLE community.guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE TABLE community.guild_settings (
  guild_id TEXT PRIMARY KEY REFERENCES community.guilds(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community.guild_members (
  guild_id TEXT NOT NULL REFERENCES community.guilds(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  PRIMARY KEY (guild_id, external_user_id)
);
CREATE INDEX guild_members_principal_idx ON community.guild_members (principal_id);

CREATE TABLE community.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES community.guilds(id) ON DELETE RESTRICT,
  external_channel_id TEXT,
  opened_by UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'resolved', 'closed')),
  assigned_to UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX tickets_guild_status_idx ON community.tickets (guild_id, status, created_at DESC);

CREATE TABLE community.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES community.tickets(id) ON DELETE CASCADE,
  author_principal_id UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  external_message_id TEXT,
  body TEXT NOT NULL,
  internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ticket_messages_ticket_created_idx ON community.ticket_messages (ticket_id, created_at);

CREATE TABLE community.moderation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES community.guilds(id) ON DELETE RESTRICT,
  external_user_id TEXT NOT NULL,
  principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'appealed', 'overturned', 'upheld', 'closed')),
  created_by UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES community.moderation_cases(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('warn', 'timeout', 'kick', 'ban', 'unban', 'note')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  external_action_id TEXT,
  performed_by UUID REFERENCES core.principals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community.suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES community.guilds(id) ON DELETE RESTRICT,
  author_principal_id UUID REFERENCES core.users(principal_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'implemented', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community.suggestion_votes (
  suggestion_id UUID NOT NULL REFERENCES community.suggestions(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES core.users(principal_id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (suggestion_id, principal_id)
);
