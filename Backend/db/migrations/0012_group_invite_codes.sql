-- 0012_group_invite_codes.sql
-- Phase 2: Google Classroom-style self-enrolment via per-group invite codes.
--
-- Instructors generate a short opaque code per group, share it (URL or
-- verbatim), and any authenticated student enters it to enroll
-- themselves into the group — which in turn grants them access to the
-- owning course per ADR 0008 §"narrowed course visibility".
--
-- Notes:
--   - `invite_code` is globally UNIQUE so `/join` can look up a group
--     from a raw code alone (no course slug required). The partial
--     index speeds up that lookup without paying for rows where the
--     column is NULL (which is the default on legacy groups).
--   - `invite_enabled` is a kill switch. We deliberately keep the code
--     on disable so analytics / audit logs that reference it stay
--     meaningful; re-generation overwrites the code value.

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_groups_invite_code
  ON groups(invite_code)
  WHERE invite_code IS NOT NULL;
