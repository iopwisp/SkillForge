# 0013 — Asynchronous judge with BullMQ + Redis

- **Status:** accepted (implementation in progress)
- **Date:** 2026-05-09
- **Supersedes for the submit hot-path:** ADR 0004 §"Phase A: in-process
  isolate" — the isolate-per-submission boundary stays, only the
  *pipeline* around it moves off the request thread.

## Context

The synchronous submit pipeline shipped in Phase 0 looks like this:

```
POST /api/submissions/:slug
  → submissions.service.submit()
      → judge.runJudge(problem, code, language)   // 32 MB V8 isolate, ~ms..1s
      → withTransaction:
          insert submission row
          increment problems.total_submissions
          increment problems.accepted_submissions  (if accepted)
          users.bumpRating  (first-solve only)
  → 201 { status: 'ACCEPTED', testsPassed, ... }
```

Single-student dev usage is fine. **For an exam with 200 students
submitting around the same minute, the API process becomes the judge
process.** All of these load up on the same Node event loop:

- Every JS submission creates a fresh `isolated-vm` isolate (32 MB).
  Twenty concurrent isolates = 640 MB of V8 heap on top of the API
  process itself.
- SQL submissions open `:memory:` better-sqlite3 instances. Cheaper
  but still fully synchronous CPU work that blocks the event loop.
- Express keeps the HTTP socket open the whole time. A 1.5 s judge
  call means 1.5 s of unavailable connection slot.
- Postgres transaction is held for the entire judge run because we
  insert the result inside the same `withTransaction` block. That
  pins a connection too.

Phase 1.5 of the roadmap calls this out as a hard prerequisite for the
AITU pilot:

> Phase 1.5 — Load readiness (1–2 months, overlaps end of Phase 1).
> BullMQ + Redis, judge worker pool, idempotency on submit, smoke
> load test 200 concurrent. **MUST FINISH BEFORE first AITU exam.**

This ADR settles how we get there.

## Decision

### Pipeline

Submit becomes a two-phase flow:

```
Phase A — HTTP request (cheap, ms-scale, never blocks on the judge):
  POST /api/submissions/:slug { code, language }
    → INSERT submission row (status='PENDING', no result columns)
    → enqueue { submissionId } to the judge queue
    → 202 Accepted { id, status: 'PENDING' }

Phase B — Worker (one OS process, isolated from API):
  Worker pulls next job from the queue
    → SELECT submission, problem
    → judge.runJudge(...)            // existing 32 MB isolate path
    → withTransaction:
        UPDATE submission SET status, runtime_ms, ... , finished_at
        problems.recordSubmission(...)
        users.bumpRating(...) on first-solve
```

`POST /api/submissions/:slug/run` (the "Run sample" path that does NOT
persist) stays **fully synchronous and in-process**. Run-sample is
explicitly opt-in by the student, traffic is much lower, and not
persisting means no row to poll on. Async would just add latency.

### Queue technology

**BullMQ on Redis 7.** Reasons:

- BullMQ is the modern successor of Bull; same maintainer, full Node
  20 + Promise support, structured logging, retries with backoff,
  delayed jobs, idempotent job ids.
- Redis is already a single small binary that fits the on-prem
  single-tenant budget. No extra database, no schema, no migration
  story for the queue.
- Persistent jobs survive a worker restart. If a worker crashes
  mid-judge, BullMQ re-delivers the job (subject to the
  `max-attempts` policy) and the affected submission stays at
  `PENDING` until a successor finishes it or hits `max-attempts`.

Alternatives considered:
- **PostgreSQL `LISTEN/NOTIFY` + `SELECT FOR UPDATE SKIP LOCKED`** —
  no extra service. Rejected because we'd be reinventing
  retries/backoff/idempotency, and the on-prem ops story (one Redis
  per university, identical to every other deployment) is fine.
- **In-process worker thread (`node:worker_threads`)** — does not
  solve the API process being the bottleneck; a long isolate run
  still blocks the event loop's GC and other callbacks on the API
  process. Same memory-limit pressure on the API container.

### Worker process

A new `src/worker.js` runs in its own Node process. `npm run worker`
starts a single worker; production uses one worker per CPU core via
docker-compose `deploy.replicas` or similar.

The worker shares the rest of `src/`:

- the same `pg` Pool config, so `withTransaction` works identically;
- the same `runJudge` from `modules/judge/service.js`;
- the same `problems.service.recordSubmission` /
  `users.service.bumpRating` cross-module calls.

The Express app does **not** spawn workers in-process. They live in
an entirely separate Node runtime so:

- the API can be restarted without losing in-flight jobs;
- worker memory consumption (V8 isolates + better-sqlite3 instances)
  doesn't squeeze out the request handlers;
- ops teams can scale workers independently.

### `JUDGE_QUEUE` env switch

Two implementations of the same `submitJudgeJob(submissionId)`
interface live behind `shared/queue.js`:

- `JUDGE_QUEUE=inline` (default for `NODE_ENV !== 'production'`,
  forced for `NODE_ENV=test`) — the queue calls the worker function
  immediately on the same event loop. Used for:
    - the existing `integration-submissions.test.mjs` suite, which
      asserts on the final verdict in the HTTP response;
    - solo developer experience without Redis;
    - first-week post-pilot smoke testing.
- `JUDGE_QUEUE=bullmq` — real BullMQ producer. The Express route
  returns `202` with `status='PENDING'`; the verdict becomes
  available via `GET /api/submissions/:id` once the worker finishes.

This dual-mode keeps the test suite fast, but makes the production
default different from the dev default. The route handler itself
stays the same; only the queue adapter changes.

### Idempotency

A separate but tightly-coupled concern. Without it, a flaky student
network can result in two submissions being created for the same
"Submit" click — and worse, both being judged twice, with the rating
bumped twice if they both pass.

**Solution:** an optional `Idempotency-Key` header (UUID, ≤ 64 chars,
URL-safe). Stored in `submissions.idempotency_key` (`UNIQUE`). When
the column collides:

- the `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`
  yields zero rows;
- we then `SELECT` the existing submission with the same key for
  the same user/problem;
- if it matches, return its current state (which may still be
  PENDING if the original is still being judged);
- if it does not match (different user or different problem),
  return 409 with a clear error.

The frontend generates a fresh UUID per "Submit" click and re-uses
it on automatic retry. Browsers without `crypto.randomUUID` (none of
our supported ones) fall back to the existing `Date.now() + Math.random`
shape — collision probability is fine for a UI dedupe key.

Why a header, not a body field: matches RFC-style behaviour
(`Idempotency-Key` is the de-facto convention from Stripe/PayPal),
keeps the request body unchanged, and lets us add idempotency to
other endpoints (e.g. role changes, course creation) without
re-shaping their schemas.

### Status field

The `submissions.status` column is already `TEXT` with no `CHECK`
constraint. No DB migration is required to support `'PENDING'` — we
just start writing it. The TypeScript `SubmissionStatus` already
contains `'PENDING'`. Existing code paths that assume a final status
(history endpoints, exam scoring) read the row as-is and the UI
renders `PENDING` as "Judging…".

Exam scoring (`exams.service.describeAttempt`) ignores PENDING
submissions for the "is this problem solved" predicate (`status =
'ACCEPTED'`), so a PENDING submission never silently counts toward
the score.

## Consequences

### Positive

- Long judge runs no longer pin Express connections or block the
  event loop on the API process.
- Workers can be scaled horizontally (`replicas: N`) per university's
  expected concurrency.
- Crashes in the judge (out-of-memory, disposed isolate, runaway
  user code) only restart the *worker*, not the API.
- Idempotent submit handles network retries cleanly, including
  inside an exam attempt.

### Negative / costs

- One more on-prem service to install (Redis). Mitigated by a small
  alpine image, built into `docker-compose.yml`.
- API responses for submit are now `202 PENDING` followed by client
  poll. The frontend grows a small "Judging…" UI state.
- Tests have to either run in `inline` mode or poll. We pick `inline`
  for the existing supertest suite — load testing the queue path is
  a separate concern (see `tests/load/`).

### Out of scope for this ADR

- WebSocket / SSE push of verdicts. Polling on `GET /api/submissions/:id`
  is good enough for our concurrency targets and avoids a long-lived
  per-user connection.
- Per-tenant queue isolation. We are still on-prem single-tenant
  (ADR 0001), so one queue per installation is the right shape.
- Sandboxing escalation (Docker-per-submission). That's "Phase B"
  of ADR 0004 and tracked separately.

## Implementation outline

1. `db/migrations/0007_submissions_async.sql` adds
   `idempotency_key TEXT UNIQUE` and `finished_at TIMESTAMPTZ`.
2. `shared/queue.js` exports a `judgeQueue` object with two adapters
   (`inline`, `bullmq`) chosen by env.
3. `submissions.service.submit` does insert-PENDING + enqueue.
4. `src/worker.js` boots a BullMQ worker that calls a new
   `submissions.service.finalize(submissionId)` per job.
5. `Idempotency-Key` middleware reads the header into `req.idempotencyKey`.
6. `GET /api/submissions/:id` returns the current row.
7. Frontend `ProblemDetail.tsx` polls `/api/submissions/:id` every
   600 ms while `status === 'PENDING'`.
8. `tests/load/submit-200.mjs` runs an `autocannon`-style smoke test
   against a docker-compose stack with one Redis, one Postgres, one
   API, two workers.
