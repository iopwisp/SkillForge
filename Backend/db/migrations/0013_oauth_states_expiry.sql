-- Add an expiration window to oauth_states so an attacker who captures
-- a state value cannot replay it indefinitely. The 15-minute default
-- matches the typical OAuth consent-screen interaction time.
--
-- New rows inherit the default; existing rows pick up "now + 15 minutes"
-- so we don't break in-flight logins on a deploy. The matching
-- index supports the periodic sweeper that cleans up expired rows.
ALTER TABLE oauth_states
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes');

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires
  ON oauth_states(expires_at);
