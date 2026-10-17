-- Migration: 0205_onboarding
-- Description: What the welcome tour, the getting-started checklist and the
--              first-visit hints need to remember about each person, and the
--              two facts that decide whether the tour starts by itself.
--
-- users.first_login_at: the first time this account signed in. The welcome
-- tour starts by itself only for an account whose first sign-in came after
-- the tour shipped (system_settings.onboarding_introduced_at, written below);
-- an older account is offered it once and never forced through it. Backfilled
-- from last_login_at, which is the closest thing an existing row has and is
-- always before this migration ran — so every account that has signed in reads
-- as existing, and an account imported from the media server but never signed
-- in gets its first sign-in stamped later and reads as new, which it is.
--
-- user_onboarding: its own table rather than a key in user_settings, because
-- the recommendation activity gate reads MAX(user_settings.updated_at). A
-- dismissed hint is not a reason to regenerate anyone's recommendations.
-- NO row means nothing has happened yet, which is what the absent state must
-- keep meaning.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ;

UPDATE users
SET first_login_at = last_login_at
WHERE first_login_at IS NULL AND last_login_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description)
VALUES (
  'onboarding_introduced_at',
  to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'When the welcome tour shipped: accounts first signing in after this get it automatically'
)
ON CONFLICT (key) DO NOTHING;
