-- 0011_microsoft_sso.sql
--
-- Microsoft SSO: add microsoft_id column to users table for Azure AD
-- Object ID (oid claim) storage. Mirrors the google_id pattern.
-- UNIQUE constraint ensures one-to-one mapping between Azure AD identities
-- and SkillForge accounts.

ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_microsoft_id ON users(microsoft_id);
