# ADR 0017 — Contest mode (ICPC-shape competitive programming)

Date: 2026-05-09

## Status

Accepted (implementation in progress)

## Context

SkillForge so far supports three problem-solving shapes — function-style
(JS/TS, Python, Java, Go), SQL, and STDIO (ADR 0015) — all embedded in
the existing course / exam flow (ADR 0009). These cover day-to-day
coursework and graded in-class exams.

AITU also runs university-wide **competitive-programming contests**
(internal rounds, qualifiers for regional ICPC, semester-long practice
series). The exam flow is the wrong fit:

- Exams are course-scoped; contests are university-wide.
- Exams score by "points earned out of total"; contests use ICPC-style
  `(solved count DESC, total penalty ASC)`.
- Exams have a fixed window per course; contests have a global start,
  optional standings freeze near the end, an editorial published after
  finish, and a **rating** that evolves across contests.
- Contest standings are consumed as a live leaderboard during the
  contest, not as a read-once gradebook.

Trying to bolt these semantics onto `exams` would require a status
column, a penalty formula, a separate freeze mechanism, a rating engine,
virtual-participation rules, and a whole new UI — all orthogonal to
what exams are for today.

Full specification:
- [requirements.md](../../.kiro/specs/contest-mode/requirements.md)
- [design.md](../../.kiro/specs/contest-mode/design.md)

## Decision

Introduce a first-class **contest** subsystem as a new module
(`modules/contests/`), sitting alongside `exams` but not sharing its
tables. Scope the v1 deliberately narrow so it can ship inside the AITU
pilot window; richer shapes (teams, Codeforces/IOI scoring, WebSocket
push) are explicit follow-ups.

Per ADR 0001, the whole subsystem is single-tenant on-prem. No
`tenant_id` anywhere.

### ICPC-only scoring for v1

The scoring engine lives in `modules/contests/scoring-engine.js` as a
**pure function** over `(participations, submissions)`. This keeps it
property-testable without any DB in the way.

ICPC formula:

- For each `(participation, problem)` pair, find the first `ACCEPTED`
  submission in declared order.
- Per-problem penalty for a solved problem:

  ```
  floor((acceptedAt - startedAt) / 60000) + 20 * wrongBefore
  ```

  where `wrongBefore` counts compiled-and-ran wrong attempts strictly
  before `acceptedAt`. Unsolved problems contribute zero.
- Aggregate per participant: `solvedCount`, `totalPenalty`.
- Sort by `(solvedCount DESC, totalPenalty ASC)`; ties share a rank.
- Mark first-solves per problem (earliest `acceptedAt` across all
  participants).
- Live and virtual participants are returned in separate collections;
  ranking only considers live participants.

**Codeforces (per-problem points) and IOI (partial scoring) modes are
out of scope for v1.** The engine is shaped so that alternative scoring
strategies can be added later as sibling pure functions behind a mode
switch on the contest row, but that switch is not introduced now.

### Individual contests only

No teams in v1. Participations are per-user.

To guarantee a single live entry per user per contest without blocking
virtual retries, `contest_participations` uses a **partial unique
index**:

```sql
CREATE UNIQUE INDEX uniq_contest_live_participation
  ON contest_participations (contest_id, user_id)
  WHERE is_virtual = false;
```

Live: at most one row per `(contest_id, user_id)`. Virtual: unlimited
rows per user per contest.

Team support is a tracked follow-up, not a hidden future-proofing in the
schema today.

### Glicko-2 rating, separate from `users.rating`

Contest rating lives in its own table, `contest_ratings`, with columns
`(user_id, rating, rating_deviation, volatility, contests_played)`.
Initial values on first contest finalization: `1500 / 350 / 0.06`
(Mark Glickman 2012 defaults).

Why a separate table:

- `users.rating` reflects day-to-day problem solving (the existing
  "bump by +5 on first accepted") and is already used elsewhere in the
  platform.
- Contest rating needs rating + RD + volatility + played count, which
  do not belong on the `users` row.
- Conceptually a student's "solved a practice task" skill and their
  "placed 12th in round 4" skill are different things.

The Glicko-2 engine lives in `modules/contests/glicko2-engine.js` as a
pure function. After computing per-participant deltas, **we normalize
to enforce zero-sum** (subtract the mean delta from each entry). This
is a conscious departure from strict Glicko-2 — we trade a tiny amount
of drift for the property that the mean contest rating of the
population stays stable. Property 6 (rating conservation) pins this
invariant with PBT.

Virtual participants are **not rated**: they are excluded from the
input to the engine and no `contest_rating_changes` row is written for
them.

Finalization is triggered explicitly via
`POST /api/contests/:slug/finalize-ratings` (ADMIN-only). This is a
deliberate choice — auto-finalizing on `ends_at` would require a
scheduler, and manual finalization is enough for the AITU pilot shape.

### Frozen standings via time filter, not a separate frozen table

Classic ICPC behaviour: during the last `freeze_minutes` of the contest
the public standings do not reveal new verdicts; attempt counts still
increment, but accepted/rejected outcomes after the freeze point are
hidden until the contest ends.

We implement this as a **query-time filter**, not a snapshot table:

- When `NOW()` is inside `[ends_at - freeze_minutes, ends_at)`, the
  standings service filters submissions to
  `created_at < ends_at - freeze_minutes`.
- Submissions that arrived after the freeze point are still counted
  toward `wrongBefore` for pending (unknown-outcome) purposes in the
  UI, but their verdicts are hidden.
- After `ends_at`, the filter is dropped; standings automatically
  unfreeze.
- When `freeze_minutes = 0`, the filter never kicks in.
- ADMINs may bypass the filter with `?unfrozen=true`. The service
  enforces this gate, not only the route (so CLI / scripts can't
  accidentally leak an unfrozen view).

Rejected alternatives:

- *Snapshot table written at freeze point* — needs a scheduler and
  introduces a write path that must be kept consistent with live
  queries.
- *Materialized view* — adds refresh logic without a corresponding
  performance need at AITU pilot scale.

The time filter is the simplest correct implementation.

### Contest submissions as a link table

Submissions still flow through the main `submissions` table and the
async judge pipeline (ADR 0013). The only contest-specific additions
are:

- `contest_submissions(participation_id, problem_id, submission_id)` —
  a pure link row, inserted at contest-submit time, so per-participant
  standings can be aggregated without scanning the whole `submissions`
  table.
- `submissions.contest_participation_id` — added in migration
  `0010_submissions_contest_link.sql`. Two consumers:
  - **Public feed filtering**: `GET /api/submissions/recent` filters
    `WHERE contest_participation_id IS NULL` so contest submissions
    can't spoil the live leaderboard through a side channel.
    (Mirrors the `exam_attempt_id IS NULL` filter from ADR 0009.)
  - **Worker finalize hook**: when the worker finalizes a submission
    with a non-null `contest_participation_id`, it calls
    `contests.service.onContestSubmissionFinalized(submissionId)` in
    the same transaction so standings are consistent with the
    submission row.

The contest module does not maintain a private copy of the submission
row — it reads from `submissions` and joins via `contest_submissions`.
Idempotency-Key, polling, verdict classification, and exam-style
spoiling rules all come for free.

### Virtual participation — same engine, individual clock, no rating

A student who missed the live window can "virtual-join" after the
contest ends. Virtual participation:

- Requires no prior registration.
- Creates a new `contest_participations` row with `is_virtual = true`
  and `started_at = NOW()`. Personal deadline is
  `NOW() + duration_minutes`.
- Runs through the **same scoring engine** — penalty is computed
  relative to the participant's own `started_at`, so a virtual
  participant's result is directly comparable to a live one with the
  same relative submission timing (Property 4: virtual parity).
- Does **not** affect rating.
- Is displayed in a separate section of the standings table with a
  `virtual` badge so ranks aren't conflated with live ranks.

A user may virtual-join the same contest multiple times (the partial
unique index only constrains live rows).

### Time-driven lifecycle, no status column

Contests have no `status` column. Phase is **computed** from `NOW()`
vs `starts_at`, `ends_at`, and `freeze_minutes`:

| Condition | Phase |
|---|---|
| `NOW() < starts_at` | `upcoming` |
| `starts_at ≤ NOW() < ends_at - freeze_minutes` | `running` |
| `ends_at - freeze_minutes ≤ NOW() < ends_at` | `frozen` |
| `NOW() ≥ ends_at` | `finished` |

This is the same pattern as exams in ADR 0009. A status column would
need a background job to keep it in sync; the computed phase is always
correct by construction.

Temporal guards (can't update after start, can't register after start,
can't submit after personal deadline) are asserted in the service and
surface as HTTP 409 `CONTEST_ALREADY_STARTED` or HTTP 400
`CONTEST_TIME_EXPIRED`.

### Database schema — 7 tables in one migration

`db/migrations/0009_contests.sql` introduces:

- `contests` — identity, window, freeze, editorial, visibility.
- `contest_problems` — `(contest_id, letter, problem_id)` with
  `letter ~ '^[A-Z]$'` CHECK and `UNIQUE(contest_id, letter)`.
- `contest_registrations` — pre-start opt-in for live participation.
- `contest_participations` — one row per "attempt"; `is_virtual`,
  `started_at`, `personal_deadline`.
- `contest_submissions` — link row `(participation_id, problem_id,
  submission_id)`.
- `contest_ratings` — current Glicko-2 state per user.
- `contest_rating_changes` — per-contest delta history.

FK policy: `ON DELETE CASCADE` on all child tables when a contest is
deleted. `contest_problems.problem_id` is `ON DELETE RESTRICT` so a
problem referenced by a contest can't be dropped. No `tenant_id`
column anywhere.

A second, minimal migration `0010_submissions_contest_link.sql` adds
`submissions.contest_participation_id` with `ON DELETE SET NULL` and
an index. This is split from `0009` because it touches an existing
table and is the one place the contest module reaches across a
boundary at the schema level.

### Module layout

```
Backend/src/modules/contests/
  scoring-engine.js      pure ICPC scorer
  glicko2-engine.js      pure Glicko-2 with zero-sum normalization
  schemas.js             zod schemas for all request shapes
  queries.js             parameterized DB queries, no cross-module imports
  service.js             orchestration, auth gates, audit logging
  routes.js              HTTP surface, schema validation, status codes
```

This follows the same layout as every other module (ADR 0003). The
two engine files are kept separate from `service.js` so they can be
imported by tests without pulling in the `pg` pool, and so the purity
boundary is obvious in a directory listing.

### Endpoint map

Mounted at `/api/contests`:

| Method | Path | Role |
|---|---|---|
| GET | `/` (list, paged, `?status=`) | any auth |
| GET | `/:slug` | any auth |
| POST | `/` | INSTRUCTOR / ADMIN |
| PUT | `/:slug` | INSTRUCTOR / ADMIN (owner-or-admin) |
| DELETE | `/:slug` | ADMIN |
| POST | `/:slug/problems` (attach) | INSTRUCTOR / ADMIN |
| DELETE | `/:slug/problems/:letter` | INSTRUCTOR / ADMIN |
| POST | `/:slug/register` | any auth |
| DELETE | `/:slug/register` | any auth |
| POST | `/:slug/participate` (`?virtual=true`) | any auth |
| POST | `/:slug/submissions/:letter` | any auth (returns 202) |
| GET | `/:slug/standings` (`?unfrozen=true`) | any auth; `unfrozen` gated to ADMIN |
| GET / PUT | `/:slug/editorial` | GET auth; PUT INSTRUCTOR / ADMIN |
| POST | `/:slug/finalize-ratings` | ADMIN |

User-scoped:

| Method | Path | Role |
|---|---|---|
| GET | `/api/users/:username/contests` | any auth |
| GET | `/api/users/:username/contest-rating` | any auth |

All management endpoints call `audit.service.recordEvent` on success
(ADR 0012). The `?unfrozen=true` gate is enforced in
`service.getStandings`, not only at the route — the same rationale as
the last-ADMIN safeguard in users service.

### Frontend surfaces

| Route | Purpose |
|---|---|
| `/contests` | Tabbed list (upcoming / running / finished), register button |
| `/contests/:slug` | Detail with Info / Problems / Standings / Editorial tabs; register / participate / virtual-join buttons |
| `/contests/:slug/standings` | Leaderboard with 15 s polling during running phase, frozen banner during freeze window, separate virtual section |
| `/contests/:slug/problems/:letter` | Workspace: letter strip header, countdown timer, Monaco-lite editor with language selector (allowlist-filtered), Idempotency-Key submit + polling |
| `/u/:username/contests` | Per-user history + rating line chart |

The 15 s polling is deliberate: it covers pilot-scale traffic, avoids a
WebSocket layer, and degrades to plain HTTP caching in front of the
standings endpoint. WebSocket push is a tracked follow-up.

## Consequences

### Positive

- AITU instructors can run university-wide rounds without bolting
  contest semantics onto the exam flow.
- The scoring engine and Glicko-2 engine are pure functions, so the
  three ICPC properties (ranking monotonicity, penalty correctness,
  idempotent recomputation) and the rating conservation property are
  testable with fast-check without any DB harness.
- Contest submissions share the async judge pipeline (ADR 0013),
  Idempotency-Key handling, and verdict classification — no duplicate
  submit path.
- Time-driven lifecycle means standings are correct without a
  scheduler; freeze is "free" as a query filter.
- Separate rating table keeps `users.rating` untouched; existing
  features that read it don't see any behaviour change.
- Virtual participation lets students practice past contests and
  compare themselves fairly against the live cohort, without polluting
  the rating population.

### Negative / costs

- Seven new tables plus one column on `submissions` — more schema to
  maintain, though the shapes are small and the FK graph is acyclic.
- Zero-sum normalization is a pragmatic deviation from strict
  Glicko-2. Property 6 documents and enforces the tolerance
  (`|sum(deltas)| ≤ 0.01 * N`).
- Standings endpoint recomputes from scratch on every call. At AITU
  pilot scale this is fine; at hundreds-of-concurrent-contest scale it
  will need an incremental cache. `onContestSubmissionFinalized` is
  currently a no-op placeholder where that cache would hook in.
- The freeze-time filter is correct but not cheap at very high
  submission volumes; the query needs the composite index on
  `submissions.contest_participation_id, created_at` that migration
  `0010` adds.
- 15 s polling is a simplification. Users on a slow network will see
  up to 15 s lag during the running phase.

### Out of scope (explicit follow-ups)

- **Team contests.** Individuals only in v1; schema reserves nothing
  for teams.
- **Codeforces / IOI scoring modes** switchable per contest. v1 is
  ICPC-only; mode switch is tracked.
- **WebSocket standings push** to replace 15 s polling.
- **Plagiarism detection hook** (Winnowing / MOSS-style) wired into
  the contest finalize path.
- **Incremental standings cache.** The current
  `onContestSubmissionFinalized` is a no-op; `getStandings` does a
  full recompute on every read. A future change turns the hook into
  an incremental updater against a cache table.
- **Auto-finalize ratings on `ends_at`.** Finalization is manual
  (ADMIN endpoint) in v1.
- **Custom checker / interactive problems** in contests — inherited
  non-goals from ADR 0015.

## Implementation outline

1. Migration `0009_contests.sql` (7 tables) + migration
   `0010_submissions_contest_link.sql` (`submissions.contest_participation_id`).
2. Pure `scoring-engine.js` with ICPC formula; property tests for
   ranking monotonicity, penalty correctness, idempotent recomputation.
3. Pure `glicko2-engine.js` with zero-sum normalization; property test
   for rating conservation.
4. Contest module `schemas.js` / `queries.js` / `service.js` /
   `routes.js`.
5. Mount `/api/contests` and user-scoped routes in `src/app.js`;
   audit + auth gates wired through.
6. Frozen standings time filter in `getStandings`; virtual
   participation in `participate`.
7. Worker hook `onContestSubmissionFinalized`; feed filter on
   `/api/submissions/recent`.
8. Editorial CRUD gated on contest end.
9. Frontend `/contests`, `/contests/:slug`, `/contests/:slug/standings`,
   `/contests/:slug/problems/:letter`, `/u/:username/contests`.
10. Integration tests covering the lifecycle, authorization matrix,
    temporal guards, feed filter, editorial gating, rating
    finalization.

## Links

- [Requirements](../../.kiro/specs/contest-mode/requirements.md)
- [Design](../../.kiro/specs/contest-mode/design.md)
- [ADR 0001 — On-prem single-tenant](./0001-on-prem-single-tenant.md)
- [ADR 0003 — Modular monolith with enforced boundaries](./0003-modular-monolith.md)
- [ADR 0009 — Exams: window + per-student duration + attempts](./0009-exams.md)
- [ADR 0012 — Audit log](./0012-audit-log.md)
- [ADR 0013 — Async judge pipeline](./0013-async-judge-pipeline.md)
- [ADR 0015 — STDIO judge](./0015-stdio-judge.md)
