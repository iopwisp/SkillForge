-- 0002_user_roles.sql
-- Phase 1 #1: replace the single 'USER' role with STUDENT / INSTRUCTOR / ADMIN.
--
-- Per ADR 0006:
--   - Default role for self-service signups becomes 'STUDENT'.
--   - The very first user on a fresh installation is bootstrapped as
--     'ADMIN' by the auth provider, NOT by this migration.
--   - 'USER' rows that already exist are mapped to 'STUDENT' before the
--     CHECK constraint is added, so the constraint can never be violated
--     by historical data.

-- 1. Migrate any pre-existing 'USER' rows to 'STUDENT'.
UPDATE users SET role = 'STUDENT' WHERE role = 'USER' OR role IS NULL;

-- 2. Switch the default for new rows to 'STUDENT'.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'STUDENT';

-- 3. Enforce the closed set of valid roles.
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('STUDENT', 'INSTRUCTOR', 'ADMIN'));
