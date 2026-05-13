# Requirements Document

## Introduction

SkillForge currently supports course-scoped exams (ADR 0009) for graded
assessments: an instructor creates an exam within a course, attaches problems,
and enrolled students take it within a time window. This model works well for
classroom testing but does not cover the competitive-programming contest
experience that AITU students are familiar with from Codeforces, AtCoder, and
ACM-ICPC regionals.

This feature adds a first-class **Contest Mode** to SkillForge — a
university-wide, public (or restricted) competitive-programming contest system
with real-time leaderboards, ELO/Glicko-style rating, frozen standings, virtual
participation, and post-contest editorials. Contests are fundamentally different
from exams: they are not course-scoped, any registered user can participate,
standings are public, and performance affects a persistent contest rating.

Key design decisions for v1:
- **ICPC-style scoring** (solved count + penalty time) as the only scoring
  model. Codeforces-style (max points decreasing over time) and IOI-style
  (partial per-test scoring) are documented as follow-up items.
- **Individual contests only** — team contests are out of scope for v1.
- **Glicko-2 rating system** with initial rating 1500, stored separately from
  the existing `users.rating` (which is a simple score counter for first-solve
  badges).
- **Frozen standings** in the last N minutes (configurable, default 30 min) —
  public standings freeze while admin can still see the unfrozen view.
- **Virtual participation** — users can join after the contest ends and
  experience it with a personal timer; virtual results are shown separately.
- **Editorials** — markdown content published after the contest ends.

Hard constraints from the existing architecture:
- Single-tenant on-prem (ADR 0001): no `tenant_id`.
- Modular monolith boundaries (ADR 0003): new `modules/contests/` module.
- Async judge pipeline (ADR 0013): contest submissions flow through the same
  BullMQ pipeline with `submit → enqueue → finalize`.
- STDIO judge (ADR 0015): contest problems are primarily STDIO type.
- Docker-per-submission (ADR 0016): contest submissions use hardened containers.
- Existing `problems` table: contest problems are regular problems attached to
  a contest (analogous to `exam_problems`).

## Glossary

- **Contest**: A time-bounded competitive-programming event with a problem set,
  scoring rules, and a public leaderboard. Not course-scoped.
- **Contest_Module**: The new `src/modules/contests/` module containing routes,
  service, queries, and schemas for all contest functionality.
- **Contest_Registration**: A record indicating a user has registered for a
  contest before it starts. Required to participate.
- **Contest_Participation**: A record representing a user's active session in a
  contest, including `started_at`, `is_virtual` flag, and personal deadline.
- **Contest_Submission**: A submission linked to a contest participation. Flows
  through the same async judge pipeline (ADR 0013) as regular submissions.
- **Contest_Standing**: A computed leaderboard entry for a participant showing
  rank, solved count, penalty time, and per-problem attempt details.
- **Contest_Rating_Change**: A per-user record of rating delta computed after a
  contest ends, linking the contest, old rating, new rating, and rank.
- **Penalty_Time**: In ICPC-style scoring, the sum of accepted-submission
  timestamps (minutes from contest start) plus 20 minutes per rejected
  submission on solved problems.
- **Freeze_Time**: A configurable duration (in minutes) before `ends_at` during
  which public standings stop updating. Default: 30 minutes.
- **Virtual_Participation**: A mode where a user joins after the contest has
  ended and experiences it with a personal timer equal to the contest duration.
  Virtual participants appear separately on the standings.
- **Editorial**: Markdown content attached to a contest, published after the
  contest ends, explaining intended solutions.
- **Glicko2_Engine**: The rating computation module that applies the Glicko-2
  algorithm to produce rating changes after a contest ends.
- **ICPC_Scoring**: Scoring model where participants are ranked by (1) number
  of problems solved descending, then (2) total penalty time ascending.
- **Standings_Freeze**: The period during which public standings reflect the
  state at `ends_at - freeze_minutes` rather than real-time results.
- **Problem_Letter**: A single uppercase letter (A, B, C, ...) assigned to each
  problem in a contest's problem set, used for display and navigation.

## Requirements

### Requirement 1: Contest entity and lifecycle

**User Story:** As an admin or instructor, I want to create contests with a
defined time window, duration, and problem set, so that I can run
competitive-programming events for the entire university.

#### Acceptance Criteria

1. WHEN an ADMIN or INSTRUCTOR submits `POST /api/contests` with valid fields
   (`title`, `slug`, `description`, `starts_at`, `ends_at`, `freeze_minutes`,
   `is_public`), THE Contest_Module SHALL create a contest row and return
   HTTP 201 with the contest shape.
2. THE Contest_Module SHALL enforce that `ends_at > starts_at` and
   `freeze_minutes >= 0` at both the schema validation layer and the database
   CHECK constraint layer.
3. IF `freeze_minutes` is not provided, THE Contest_Module SHALL default it
   to 30.
4. WHEN an ADMIN or INSTRUCTOR submits `PUT /api/contests/:slug` before the
   contest has started, THE Contest_Module SHALL allow updates to all mutable
   fields (title, description, starts_at, ends_at, freeze_minutes, is_public).
5. IF a `PUT /api/contests/:slug` request arrives after `starts_at` has passed,
   THEN THE Contest_Module SHALL reject the request with HTTP 409 and an error
   code `CONTEST_ALREADY_STARTED`.
6. WHEN an ADMIN submits `DELETE /api/contests/:slug`, THE Contest_Module SHALL
   delete the contest and cascade-delete all registrations, participations,
   submissions, standings, and rating changes associated with it.
7. THE Contest_Module SHALL NOT introduce any `tenant_id` column or
   multi-tenant field on any contest table.

### Requirement 2: Contest problem attachment

**User Story:** As a contest organizer, I want to attach existing problems to a
contest with letter assignments, so that participants see a labeled problem set
during the event.

#### Acceptance Criteria

1. WHEN an ADMIN or INSTRUCTOR submits
   `POST /api/contests/:slug/problems` with `{ problemSlug, letter }`, THE
   Contest_Module SHALL attach the problem to the contest with the given
   uppercase letter and return HTTP 201.
2. IF the `letter` is already used by another problem in the same contest,
   THEN THE Contest_Module SHALL reject the request with HTTP 409 and an error
   code `LETTER_ALREADY_USED`.
3. IF the `problemSlug` does not exist in the `problems` table, THEN THE
   Contest_Module SHALL reject the request with HTTP 404.
4. WHEN an ADMIN or INSTRUCTOR submits
   `DELETE /api/contests/:slug/problems/:letter` before the contest has started,
   THE Contest_Module SHALL detach the problem and return HTTP 200.
5. IF a problem attach or detach request arrives after `starts_at` has passed,
   THEN THE Contest_Module SHALL reject the request with HTTP 409 and an error
   code `CONTEST_ALREADY_STARTED`.
6. THE Contest_Module SHALL support attaching problems of any type (STDIO,
   ALGORITHM, BACKEND, FRONTEND, SQL), though STDIO is the primary expected
   type for contests.

### Requirement 3: Contest registration

**User Story:** As a registered user, I want to register for an upcoming
contest, so that I can participate when it starts.

#### Acceptance Criteria

1. WHEN an authenticated user submits `POST /api/contests/:slug/register`
   before the contest's `starts_at`, THE Contest_Module SHALL create a
   registration row and return HTTP 201.
2. IF the user is already registered for the contest, THEN THE Contest_Module
   SHALL return HTTP 409 with an error code `ALREADY_REGISTERED`.
3. IF the contest's `starts_at` has already passed and the contest is not
   finished, THEN THE Contest_Module SHALL reject registration with HTTP 400
   and an error code `REGISTRATION_CLOSED`.
4. WHEN an authenticated user submits `DELETE /api/contests/:slug/register`
   before the contest's `starts_at`, THE Contest_Module SHALL remove the
   registration and return HTTP 200.
5. IF the contest's `is_public` flag is false, THE Contest_Module SHALL still
   allow any authenticated user to register (university-wide visibility within
   the single-tenant installation).

### Requirement 4: Contest participation and personal timer

**User Story:** As a registered user, I want to start my contest participation
when the contest is live, so that my personal timer begins and I can submit
solutions.

#### Acceptance Criteria

1. WHEN a registered user submits `POST /api/contests/:slug/participate` while
   the contest is between `starts_at` and `ends_at`, THE Contest_Module SHALL
   create a participation row with `started_at = NOW()`, `is_virtual = false`,
   and return HTTP 201 with the participation shape including personal deadline.
2. THE Contest_Module SHALL compute the personal deadline as
   `MIN(started_at + duration_minutes, ends_at)` where
   `duration_minutes = (ends_at - starts_at) / 60000` (the full contest
   duration).
3. IF the user is not registered for the contest, THEN THE Contest_Module SHALL
   reject participation with HTTP 403 and an error code `NOT_REGISTERED`.
4. IF the user already has an active participation for the contest, THEN THE
   Contest_Module SHALL return HTTP 409 with an error code
   `ALREADY_PARTICIPATING`.
5. IF the current time is before `starts_at` or after `ends_at`, THEN THE
   Contest_Module SHALL reject participation with HTTP 400 and an error code
   `CONTEST_NOT_ACTIVE`.

### Requirement 5: Virtual participation

**User Story:** As a user who missed a contest, I want to join it virtually
after it ended, so that I can practice under contest conditions and see how I
would have ranked.

#### Acceptance Criteria

1. WHEN an authenticated user submits
   `POST /api/contests/:slug/participate?virtual=true` after the contest's
   `ends_at` has passed, THE Contest_Module SHALL create a participation row
   with `started_at = NOW()`, `is_virtual = true`, and a personal deadline of
   `NOW() + duration_minutes`.
2. THE Contest_Module SHALL NOT require prior registration for virtual
   participation.
3. WHILE a virtual participant's personal deadline has not passed, THE
   Contest_Module SHALL accept submissions from the virtual participant
   through the same submission endpoint as live participants.
4. THE Contest_Module SHALL compute penalty time for virtual participants using
   the same formula as live participants (minutes from their personal
   `started_at`).
5. WHEN standings are rendered, THE Contest_Module SHALL display virtual
   participants in a separate section or with a `virtual` badge, distinct from
   live participants.

### Requirement 6: Contest submission flow

**User Story:** As a contest participant, I want to submit solutions to contest
problems through the existing async judge pipeline, so that my submissions are
judged and reflected on the leaderboard.

#### Acceptance Criteria

1. WHEN an active participant submits
   `POST /api/contests/:slug/submissions/:letter` with `{ language, code }`,
   THE Contest_Module SHALL insert a PENDING submission row linked to the
   participation, enqueue a judge job through the async pipeline (ADR 0013),
   and return HTTP 202.
2. IF the participant's personal deadline has passed, THEN THE Contest_Module
   SHALL reject the submission with HTTP 400 and an error code
   `CONTEST_TIME_EXPIRED`.
3. IF the problem letter does not exist in the contest's problem set, THEN THE
   Contest_Module SHALL reject the submission with HTTP 404.
4. IF the language is not in the problem's `language_allowlist`, THEN THE
   Contest_Module SHALL reject the submission with HTTP 400 and an error code
   `LANGUAGE_NOT_ALLOWED`.
5. WHEN a contest submission finalizes through the judge worker, THE
   Contest_Module SHALL update the participant's standing (solved count and
   penalty time) based on the verdict.
6. THE Contest_Module SHALL filter contest submissions out of the public
   `GET /api/submissions/recent` feed, consistent with the exam filtering
   pattern from ADR 0009.

### Requirement 7: ICPC-style scoring

**User Story:** As a contest organizer, I want ICPC-style scoring where
participants are ranked by problems solved (descending) then penalty time
(ascending), so that the contest follows standard competitive-programming
conventions.

#### Acceptance Criteria

1. THE Contest_Module SHALL rank participants by (1) number of distinct problems
   solved in descending order, then (2) total penalty time in ascending order.
2. THE Contest_Module SHALL compute penalty time for a solved problem as the
   number of minutes from the participant's `started_at` to the timestamp of
   the first ACCEPTED submission for that problem, plus 20 minutes for each
   rejected submission on that problem before the first ACCEPTED one.
3. THE Contest_Module SHALL NOT add penalty time for problems that the
   participant attempted but did not solve.
4. WHEN two participants have the same solved count and the same penalty time,
   THE Contest_Module SHALL assign them the same rank (tied ranking).
5. THE Contest_Module SHALL recompute standings on every submission
   finalization, so that the leaderboard reflects the latest state within
   seconds of a verdict.

### Requirement 8: Real-time leaderboard

**User Story:** As a contest participant or spectator, I want to see a
real-time leaderboard during the contest, so that I can track my position
and the competition.

#### Acceptance Criteria

1. WHEN an authenticated user requests `GET /api/contests/:slug/standings`,
   THE Contest_Module SHALL return the current standings as a JSON array sorted
   by rank, including for each participant: `rank`, `username`, `solved_count`,
   `penalty_time`, and a per-problem breakdown with `{ letter, attempts,
   accepted_at, is_first_solve }`.
2. WHILE the contest is between `starts_at` and `ends_at - freeze_minutes`,
   THE Contest_Module SHALL return standings reflecting all finalized
   submissions up to the current moment.
3. THE Contest_Module SHALL support a polling-based real-time update pattern
   via `GET /api/contests/:slug/standings?since=<timestamp>` that returns only
   changes since the given timestamp, enabling efficient client-side polling.
4. THE Standings_UI SHALL render the leaderboard at
   `/contests/:slug/standings` with auto-refresh (polling every 15 seconds
   during an active contest).
5. THE Standings_UI SHALL highlight first-solves per problem with a distinct
   visual indicator.

### Requirement 9: Frozen standings

**User Story:** As a contest organizer, I want standings to freeze in the last
N minutes of the contest, so that the final minutes are suspenseful and
participants cannot deduce others' progress.

#### Acceptance Criteria

1. WHILE the current time is between `ends_at - freeze_minutes` and `ends_at`,
   THE Contest_Module SHALL return public standings frozen at the state they
   were at `ends_at - freeze_minutes`, showing submissions after the freeze
   point as "pending" (attempt count increments but verdict is hidden).
2. WHILE standings are frozen, WHEN an ADMIN requests
   `GET /api/contests/:slug/standings?unfrozen=true`, THE Contest_Module SHALL
   return the real-time unfrozen standings.
3. WHEN the contest ends (current time passes `ends_at`), THE Contest_Module
   SHALL automatically unfreeze standings so that all participants see the
   final results.
4. THE Standings_UI SHALL visually indicate when standings are frozen (e.g., a
   banner or icon) and SHALL show pending submissions with a "?" indicator
   instead of a verdict.
5. IF `freeze_minutes` is set to 0, THEN THE Contest_Module SHALL never freeze
   standings for that contest.

### Requirement 10: Glicko-2 rating system

**User Story:** As a competitive user, I want my contest performance to affect
a persistent rating that reflects my skill level over time, so that I can track
my improvement and compare with peers.

#### Acceptance Criteria

1. THE Contest_Module SHALL store contest ratings in a `contest_ratings` table
   with columns `user_id`, `rating`, `rating_deviation`, `volatility`,
   `contests_played`, and `last_contest_at`, separate from the existing
   `users.rating` column.
2. WHEN a user participates in their first contest, THE Glicko2_Engine SHALL
   initialize their rating at 1500, rating deviation at 350, and volatility
   at 0.06 (standard Glicko-2 initial values).
3. WHEN a contest ends and standings are finalized, THE Glicko2_Engine SHALL
   compute rating changes for all live participants based on their final rank
   relative to other participants, applying the Glicko-2 algorithm.
4. THE Glicko2_Engine SHALL NOT compute rating changes for virtual
   participants.
5. WHEN rating changes are computed, THE Contest_Module SHALL insert a
   `contest_rating_changes` row per participant with `contest_id`, `user_id`,
   `old_rating`, `new_rating`, `old_rd`, `new_rd`, `rank`, and `delta`.
6. FOR ALL contests, the sum of all `delta` values across all participants
   SHALL be zero (zero-sum property), within a floating-point tolerance of
   ±0.01 per participant.
7. THE Contest_Module SHALL expose `GET /api/users/:username/contest-rating`
   returning the user's current rating, rating deviation, rating history
   (array of `{ contest_slug, date, rating, delta }`), and contests played.

### Requirement 11: Contest listing and detail pages

**User Story:** As a user, I want to browse upcoming, running, and past
contests, so that I can find events to participate in or review.

#### Acceptance Criteria

1. WHEN an authenticated user requests `GET /api/contests`, THE Contest_Module
   SHALL return a paginated list of contests sorted by `starts_at` descending,
   with fields `slug`, `title`, `starts_at`, `ends_at`, `is_public`, `status`
   (one of `upcoming`, `running`, `finished`), and `participant_count`.
2. THE Contest_Module SHALL support filtering by `status` query parameter
   (`upcoming`, `running`, `finished`).
3. WHEN an authenticated user requests `GET /api/contests/:slug`, THE
   Contest_Module SHALL return the full contest detail including description,
   time window, freeze configuration, problem list (letters and titles only,
   no statements before start), registration status of the requesting user,
   and participant count.
4. WHILE the contest has not started, THE Contest_Module SHALL NOT expose
   problem statements or test cases in the contest detail response.
5. WHEN the contest is running or finished, THE Contest_Module SHALL include
   problem statements (with SAMPLE test cases) in the contest detail response
   for registered participants.

### Requirement 12: Contest workspace frontend

**User Story:** As a contest participant, I want a dedicated contest workspace
with problem navigation, code editor, and submission history, so that I can
focus on solving problems during the contest.

#### Acceptance Criteria

1. THE Contest_Workspace_UI SHALL render at `/contests/:slug` during an active
   participation with a problem sidebar (letters A, B, C, ...), a code editor,
   a submission panel, and a countdown timer showing remaining time.
2. THE Contest_Workspace_UI SHALL render problem statements at
   `/contests/:slug/problems/:letter` with SAMPLE test cases, input/output
   format description, and per-problem limits.
3. THE Contest_Workspace_UI SHALL allow the participant to submit solutions and
   see per-submission verdicts (ACCEPTED, WRONG_ANSWER, TLE, etc.) with
   polling for async results.
4. THE Contest_Workspace_UI SHALL display the participant's own submission
   history per problem within the contest.
5. WHEN the participant's personal deadline expires, THE Contest_Workspace_UI
   SHALL disable the submit button and display a "Contest ended" message.

### Requirement 13: Editorials

**User Story:** As a user reviewing a past contest, I want to read editorials
explaining the intended solutions, so that I can learn from the problems I
could not solve.

#### Acceptance Criteria

1. WHEN an ADMIN or INSTRUCTOR submits
   `PUT /api/contests/:slug/editorial` with `{ content }` (markdown string),
   THE Contest_Module SHALL store the editorial content on the contest row.
2. WHILE the contest has not ended (current time is before `ends_at`), THE
   Contest_Module SHALL NOT expose the editorial content in any API response.
3. WHEN an authenticated user requests `GET /api/contests/:slug/editorial`
   after the contest has ended, THE Contest_Module SHALL return the editorial
   markdown content.
4. THE Contest_Detail_UI SHALL render the editorial as formatted markdown at
   `/contests/:slug` (in an "Editorial" tab) only after the contest has ended.
5. IF no editorial has been published for a contest, THEN THE Contest_Module
   SHALL return HTTP 404 for `GET /api/contests/:slug/editorial`.

### Requirement 14: User contest history and rating graph

**User Story:** As a user, I want to see my contest history and rating
progression on my profile, so that I can track my competitive growth.

#### Acceptance Criteria

1. WHEN an authenticated user requests `GET /api/users/:username/contests`,
   THE Contest_Module SHALL return a list of contests the user participated in,
   with `contest_slug`, `contest_title`, `date`, `rank`, `solved_count`,
   `rating_change`, and `new_rating` per entry.
2. THE Profile_UI SHALL render a contest history section at
   `/profile/:username/contests` showing a table of past contests and a rating
   graph (line chart of rating over time).
3. THE Profile_UI SHALL display the user's current contest rating prominently
   on their profile page.
4. WHEN a user has not participated in any contest, THE Contest_Module SHALL
   return an empty array for their contest history and SHALL NOT display a
   rating on their profile.

### Requirement 15: Authorization and access control

**User Story:** As a platform operator, I want contest management restricted to
ADMIN and INSTRUCTOR roles while participation is open to all authenticated
users, so that the permission model is consistent with the rest of SkillForge.

#### Acceptance Criteria

1. THE Contest_Module SHALL gate `POST /api/contests`,
   `PUT /api/contests/:slug`, `DELETE /api/contests/:slug`, problem
   attach/detach, and editorial publish behind
   `requireRole(INSTRUCTOR, ADMIN)`.
2. THE Contest_Module SHALL gate registration, participation, submission, and
   standings read endpoints behind `requireAuth` (any authenticated user).
3. THE Contest_Module SHALL gate the `?unfrozen=true` standings parameter
   behind `requireRole(ADMIN)`.
4. IF an unauthenticated user requests any contest endpoint, THEN THE
   Contest_Module SHALL return HTTP 401.
5. IF a STUDENT attempts to create, update, or delete a contest, THEN THE
   Contest_Module SHALL return HTTP 403.

### Requirement 16: Database schema and migration

**User Story:** As a platform developer, I want the contest tables defined in a
forward-only migration with proper constraints and indices, so that the data
model is consistent with the rest of SkillForge.

#### Acceptance Criteria

1. THE Migrations_Runner SHALL apply a forward-only migration at
   `db/migrations/0009_contests.sql` that creates tables `contests`,
   `contest_problems`, `contest_registrations`, `contest_participations`,
   `contest_submissions`, and `contest_rating_changes`, plus a
   `contest_ratings` table for current rating state.
2. THE migration SHALL add CHECK constraints for `ends_at > starts_at`,
   `freeze_minutes >= 0`, and `letter` matching `^[A-Z]$`.
3. THE migration SHALL add UNIQUE constraints on `contests.slug`,
   `(contest_id, letter)` on `contest_problems`,
   `(contest_id, user_id)` on `contest_registrations`, and
   `(contest_id, user_id)` on `contest_participations`.
4. THE migration SHALL add foreign keys with CASCADE on contest delete for all
   child tables, and REFERENCES to `users(id)` and `problems(id)` with
   appropriate ON DELETE policies.
5. THE migration SHALL add indices on `contest_submissions(participation_id)`,
   `contest_submissions(problem_id)`, `contest_rating_changes(user_id)`, and
   `contest_ratings(user_id)` for query performance.
6. THE migration SHALL NOT introduce any `tenant_id` column.

### Requirement 17: Integration with existing judge pipeline

**User Story:** As a platform developer, I want contest submissions to flow
through the same BullMQ async judge pipeline as regular submissions, so that
no parallel judging infrastructure is needed.

#### Acceptance Criteria

1. WHEN a contest submission is enqueued, THE Contest_Module SHALL use the same
   queue name, job payload structure, and worker processor as regular
   submissions (ADR 0013), adding only a `contest_participation_id` field to
   the job metadata.
2. WHEN the judge worker finalizes a contest submission, THE Contest_Module
   SHALL update the participant's standing entry (solved count and penalty
   time) atomically with the submission status update.
3. THE Contest_Module SHALL support both `inline` and `bullmq` queue modes for
   contest submissions, matching the existing `JUDGE_QUEUE` env switch.
4. IF the judge worker encounters an unhandled error during contest submission
   finalization, THEN THE Contest_Module SHALL set the submission status to
   `JUDGE_ERROR` and SHALL NOT alter the participant's standing.

## Correctness Properties (Executable PBT Candidates)

The following properties are intended to be encoded as property-based tests and
each one should be mechanically checkable.

1. **Rating conservation (zero-sum).** For all contests with N ≥ 2 live
   participants, the sum of all `delta` values in `contest_rating_changes`
   SHALL equal zero within ±0.01 per participant. (Requirement 10.6.)

2. **Monotonicity of ranking.** For all pairs of participants (A, B) in the
   same contest, if A solved strictly more problems than B, then A's rank is
   strictly better (lower number) than B's rank. If A and B solved the same
   number of problems and A has strictly less penalty time, then A's rank is
   strictly better than B's. (Requirement 7.1, 7.2.)

3. **Frozen standings consistency.** For all contests with `freeze_minutes > 0`,
   the public standings returned during the freeze period SHALL be identical to
   the standings computed from submissions finalized before
   `ends_at - freeze_minutes`. No submission finalized after the freeze point
   SHALL alter the public standings response until after `ends_at`.
   (Requirement 9.1, 9.3.)

4. **Virtual parity.** For all virtual participants V and hypothetical live
   participants L with identical submission sequences (same problems, same
   verdicts, same relative timestamps from their respective `started_at`),
   V's computed score (solved count and penalty time) SHALL equal L's computed
   score. (Requirement 5.4, Requirement 7.2.)

5. **Penalty time correctness.** For all participants and all solved problems,
   penalty time for that problem SHALL equal
   `(accepted_submission_time - started_at) / 60000 + 20 * rejected_attempts_before_accept`.
   For unsolved problems, penalty contribution SHALL be zero.
   (Requirement 7.2, 7.3.)

6. **Idempotent standing recomputation.** For all contests, recomputing
   standings from scratch using all finalized submissions SHALL produce the
   same ranking as the incrementally-maintained standings. (Requirement 7.5.)

## Non-Goals (Documented Follow-ups)

The following items are explicitly out of scope for v1 and tracked for future
specs:

1. **Team contests** — only individual participation in v1.
2. **Codeforces-style scoring** — max points per problem decreasing over time,
   with partial scoring. Requires a `scoring_model` discriminator on the
   contest and a pluggable scorer interface.
3. **IOI-style scoring** — partial scoring per test case. Requires per-test
   point values and a different aggregation model.
4. **Custom scoring formulas** — user-defined scoring expressions.
5. **Plagiarism detection during contest** — Phase 2 item, requires the
   Winnowing engine from the plagiarism spec.
6. **Proctoring** — not applicable to public contests.
7. **Multi-round tournaments** — bracket/elimination formats.
8. **WebSocket-based real-time standings** — v1 uses polling; WebSocket upgrade
   is a performance optimization for large contests.
9. **Floating-point comparator mode (FLOAT)** — epsilon-based comparison for
   numerical problems.
