-- 0010_submissions_contest_link.sql
--
-- Contest-mode task 13.1: thread contest submissions through the
-- existing async judge pipeline (ADR 0013).
--
-- Mirrors the `exam_attempt_id` pattern introduced in
-- `0005_exams.sql`. A submission made inside a contest participation
-- carries the participation id on the row itself. This lets the
-- worker's finalize step recognise contest submissions (and hand
-- control back to contests.service.onContestSubmissionFinalized) and
-- lets the public activity feed filter them out just like in-exam
-- submissions.
--
-- The link table `contest_submissions` (created in 0009) continues to
-- be the canonical per-participation / per-problem join; this new
-- column is the "fast path" flag used by the hot-path code
-- (insert → enqueue → worker → feed) where we'd otherwise have to
-- LEFT JOIN on every submissions read.
--
-- ON DELETE SET NULL so that removing a participation (which cascades
-- through `contest_submissions`) does not also destroy the underlying
-- submission row; the submission survives as an orphaned practice
-- entry, matching the exam behaviour.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS contest_participation_id INTEGER
    REFERENCES contest_participations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_contest_participation
  ON submissions(contest_participation_id);
