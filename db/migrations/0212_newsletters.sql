-- Migration: 0212_newsletters
-- Description: Admin-written newsletters, the send groups they go to, and a
-- per-user opt-in that defaults to OFF.
--
-- The opt-in is its own column on purpose. `email_notifications_enabled`
-- (0088) defaults to TRUE and was set while the switch did nothing, so it
-- cannot be read as anyone having agreed to anything; a newsletter is sent
-- only to accounts that switched THIS on themselves.

ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- The capability an unsubscribe link carries. Random per account, never shown
-- in the app, and rotated by nothing: a link in an old email keeps working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_token TEXT NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_newsletter_token ON users(newsletter_token);

COMMENT ON COLUMN users.newsletter_opt_in IS
  'The person''s own choice to receive newsletters. Default off; only they (or the unsubscribe link) change it.';
COMMENT ON COLUMN users.newsletter_token IS
  'Random token in every newsletter''s unsubscribe link. Grants nothing but switching newsletter_opt_in off.';

CREATE TABLE IF NOT EXISTS newsletter_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- { "match": "rules" | "none", "languages": ["el"], "role": "any" | "admins" | "viewers" }
  -- Read through core newsletter/groups.ts `readGroupRules`; anything it does
  -- not recognise is dropped there, so no CHECK here.
  rules JSONB NOT NULL DEFAULT '{"match":"rules"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS newsletter_group_members (
  group_id UUID NOT NULL REFERENCES newsletter_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('include', 'exclude')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS newsletters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  -- The editor's document (TipTap JSON). Never rendered as HTML: core
  -- newsletter/document.ts reads it into plain-text blocks that the email
  -- renderer escapes.
  content JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  group_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  send_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletters_updated ON newsletters(updated_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  id BIGSERIAL PRIMARY KEY,
  newsletter_id UUID NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  -- SET NULL so the record of what was sent outlives a removed account.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One delivery per person per newsletter: a retried send skips anyone already sent to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_deliveries_once
  ON newsletter_deliveries(newsletter_id, user_id) WHERE user_id IS NOT NULL;
