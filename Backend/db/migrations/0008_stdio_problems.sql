-- 0008_stdio_problems.sql
--
-- Phase 2 / stdio-judge #1: introduce the STDIO problem subtype.
--
-- See .kiro/specs/stdio-judge/{requirements.md, design.md} and
-- ADR 0015 (to be added). This migration is purely structural:
-- it widens the closed set of `problems.problem_type` values to
-- include `'STDIO'` and adds three nullable columns used only by
-- STDIO problems (`output_size_cap_kb`, `comparator_mode`,
-- `language_allowlist`). Non-STDIO rows are unaffected — the new
-- columns stay NULL on them, and every STDIO-specific CHECK is
-- gated on `problem_type = 'STDIO'` so existing
-- ALGORITHM / SQL / BACKEND / FRONTEND rows keep passing even if
-- their `time_limit_ms` / `memory_limit_mb` sit outside the new
-- STDIO ranges.
--
-- `time_limit_ms` and `memory_limit_mb` already live on the row
-- from `0001_initial.sql` with global defaults (1000 / 256); we
-- reuse them rather than shadowing them with `stdio_*` twins.

-- 1) Close the problem_type enum defensively at the DB layer. The
--    column previously relied on application-layer validation; this
--    matches the defence-in-depth pattern used by the users/role and
--    audit-log migrations.
ALTER TABLE problems
  ADD CONSTRAINT problems_type_check
  CHECK (problem_type IN ('ALGORITHM', 'SQL', 'BACKEND', 'FRONTEND', 'STDIO'));

-- 2) STDIO-specific columns. All nullable so non-STDIO rows are
--    unaffected (Requirement 1.5).
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS output_size_cap_kb  INTEGER,
  ADD COLUMN IF NOT EXISTS comparator_mode     TEXT,
  ADD COLUMN IF NOT EXISTS language_allowlist  TEXT[];

-- 3) Value-range guards for STDIO rows. Each constraint short-circuits
--    via `problem_type <> 'STDIO'` so existing non-STDIO rows are not
--    re-validated against STDIO-only ranges and the new columns stay
--    NULL on them without tripping `array_length(...) >= 1`.
ALTER TABLE problems
  ADD CONSTRAINT problems_stdio_time_range
    CHECK (problem_type <> 'STDIO' OR (time_limit_ms BETWEEN 100 AND 10000));

ALTER TABLE problems
  ADD CONSTRAINT problems_stdio_memory_range
    CHECK (problem_type <> 'STDIO' OR (memory_limit_mb BETWEEN 16 AND 512));

ALTER TABLE problems
  ADD CONSTRAINT problems_stdio_output_range
    CHECK (problem_type <> 'STDIO' OR (output_size_cap_kb BETWEEN 1 AND 1024));

ALTER TABLE problems
  ADD CONSTRAINT problems_stdio_comparator
    CHECK (problem_type <> 'STDIO'
           OR comparator_mode IN ('EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED'));

ALTER TABLE problems
  ADD CONSTRAINT problems_stdio_allowlist
    CHECK (problem_type <> 'STDIO' OR array_length(language_allowlist, 1) >= 1);
