-- 0007_submissions_async.sql
--
-- Per ADR 0013 (asynchronous judge with BullMQ + Redis), the submit
-- flow becomes two-phase:
--   1. HTTP request inserts a row with status='PENDING' and no result
--      columns, then enqueues a job. 202 Accepted with the row id.
--   2. A separate worker process pulls the job, runs the judge, and
--      UPDATEs the row with the final verdict + finished_at.
--
-- We add two columns. Both are nullable on existing PENDING rows
-- (which is the whole point of two-phase). The status column itself
-- already lives without a CHECK constraint so 'PENDING' just slots in.
--
-- `idempotency_key` is opt-in: the frontend can supply an
-- Idempotency-Key HTTP header and the server stores it here so a
-- network retry collapses onto the original submission rather than
-- creating a duplicate / paying the judge twice.
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ;

-- Partial unique index: every non-null key must be unique, but rows
-- without a key (the default for non-idempotent submits) coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_submissions_idempotency_key
  ON submissions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The status filter stays helpful — querying "all the in-flight
-- submissions" is now a real operational need (e.g. the worker /
-- admin can see "12 jobs PENDING for > 30s"). The pre-existing
-- idx_submissions_status already covers it; nothing new here.
