# Implementation Plan

> Feature: `contest-mode`
> Requirements doc: `.kiro/specs/contest-mode/requirements.md`
> Design doc: `.kiro/specs/contest-mode/design.md`
>
> Execution convention:
> - Every task ends with `npm run lint` + `npm test` green in `Backend/`.
> - Every task that touches the frontend also ends with `npm run typecheck`
>   + `npm run build` green in `Frontend/Frontend/`.
> - Task IDs map to PR titles (`feat(contest-mode): <task-title>`).
> - Each task references the Requirements (R-N.M) and Properties (P-N) it
>   satisfies so the reviewer can pin the contract.
> - PBT tasks use fast-check with ≥100 iterations; header comment must
>   read `// Feature: contest-mode, Property N: <text>`.
> - Contest module lives at `Backend/src/modules/contests/`.

## 1. Database migration

- [x] 1.1 Write forward-only migration `db/migrations/0009_contests.sql`
  - Create all 7 tables: `contests`, `contest_problems`,
    `contest_registrations`, `contest_participations`,
    `contest_submissions`, `contest_ratings`, `contest_rating_changes`.
  - Add CHECK constraints: `ends_at > starts_at`, `freeze_minutes >= 0`,
    `letter ~ '^[A-Z]$'`.
  - Add UNIQUE constraints: `contests.slug`, `(contest_id, letter)` on
    `contest_problems`, `(contest_id, user_id)` on
    `contest_registrations`.
  - Add partial unique index `uniq_contest_live_participation` on
    `(contest_id, user_id) WHERE is_virtual = false`.
  - Add all indices from design.md §Data Models.
  - Add foreign keys with CASCADE on contest delete for all child tables;
    RESTRICT on `contest_problems.problem_id`.
  - No `tenant_id` column anywhere.
  - Run migration locally against `skillforge_test`, verify existing
    tables unaffected.
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 1.7_

## 2. Scoring engine

- [x] 2.1 Implement `modules/contests/scoring-engine.js`
  - Pure function `computeICPCStandings(participations, submissions)`.
  - Group submissions by `(participationId, problemId)`.
  - For each group, find first ACCEPTED submission (if any).
  - Penalty for solved problem: `floor((acceptedAt - startedAt) / 60000) + 20 * wrongBefore`.
  - Unsolved problems contribute zero penalty.
  - Aggregate per participant: `solvedCount`, `totalPenalty`.
  - Sort by `(solvedCount DESC, totalPenalty ASC)`.
  - Assign ranks with ties (same rank for equal `(solvedCount, totalPenalty)`).
  - Mark first-solves per problem (earliest `acceptedAt` across all participants).
  - Separate live vs virtual participants in output.
  - No imports from `fs`, `child_process`, `pg`, or any I/O module.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 5.4, 5.5_

## 3. Scoring engine PBT

- [ ]* 3.1 Property test: ranking monotonicity
  - For any generated participant set, if A solved more problems than B,
    A's rank is strictly better. If same solved count and A has less
    penalty, A's rank is strictly better. Equal stats → equal rank.
  - `// Feature: contest-mode, Property 1: Ranking monotonicity`
  - **Property 1: Ranking monotonicity**
  - **Validates: Requirements 7.1, 7.4**

- [ ]* 3.2 Property test: penalty time correctness
  - For any generated submission sequence, penalty for each solved problem
    equals `floor((acceptedAt - startedAt) / 60000) + 20 * wrongBefore`.
    Unsolved problems contribute zero.
  - `// Feature: contest-mode, Property 2: Penalty time correctness`
  - **Property 2: Penalty time correctness**
  - **Validates: Requirements 7.2, 7.3**

- [ ]* 3.3 Property test: idempotent standing recomputation
  - For any submission sequence, computing standings from scratch produces
    the same result as incremental updates.
  - `// Feature: contest-mode, Property 5: Idempotent standing recomputation`
  - **Property 5: Idempotent standing recomputation**
  - **Validates: Requirements 7.5**

## 4. Glicko-2 engine

- [x] 4.1 Implement `modules/contests/glicko2-engine.js`
  - Pure function `computeGlicko2Changes(participants, standings)`.
  - Standard Glicko-2 algorithm (Mark Glickman, 2012):
    convert to μ/φ scale, compute expected outcomes from rank comparison,
    compute variance v, delta Δ, new volatility σ' via Illinois method,
    update φ' and μ', convert back.
  - Normalize deltas to enforce zero-sum: subtract `mean(delta)` from each.
  - Initial values: rating = 1500, RD = 350, volatility = 0.06.
  - No I/O imports; pure computation only.
  - _Requirements: 10.1, 10.2, 10.3, 10.6_

## 5. Glicko-2 PBT

- [ ]* 5.1 Property test: rating conservation (zero-sum)
  - For any contest with N ≥ 2 participants and random ratings/standings,
    `|sum(deltas)| ≤ 0.01 * N`.
  - `// Feature: contest-mode, Property 6: Rating conservation (zero-sum)`
  - **Property 6: Rating conservation (zero-sum)**
  - **Validates: Requirements 10.6**

## 6. Contest module: schemas

- [x] 6.1 Create `modules/contests/schemas.js`
  - `CreateContestSchema`: title, slug (kebab-case regex), description,
    starts_at (ISO datetime), ends_at (ISO datetime), freeze_minutes
    (optional, default 30), is_public (optional, default true).
  - Zod refine: `ends_at > starts_at`.
  - `UpdateContestSchema`: partial of mutable fields.
  - `AttachProblemSchema`: `{ problemSlug, letter }` with letter matching
    `^[A-Z]$`.
  - `ContestSubmissionSchema`: `{ language, code }`.
  - `PaginationSchema`: page, pageSize, status filter.
  - _Requirements: 1.1, 1.2, 2.1, 6.1, 11.1, 11.2_

## 7. Contest module: queries

- [x] 7.1 Create `modules/contests/queries.js`
  - CRUD queries for `contests` table (insert, findBySlug, update, delete).
  - `contest_problems`: attach, detach, listByContest, findByLetter.
  - `contest_registrations`: insert, delete, findByContestAndUser, count.
  - `contest_participations`: insert, findActiveByContestAndUser,
    findByContest.
  - `contest_submissions`: insert, findByParticipation,
    findByParticipationAndProblem, findAllByContest.
  - `contest_ratings`: findByUserId, upsert.
  - `contest_rating_changes`: insertBatch, findByUserId, findByContest.
  - All queries use parameterized `$1, $2, ...` placeholders.
  - No cross-module query imports.
  - _Requirements: 16.1–16.5_

## 8. Contest module: service

- [x] 8.1 Implement `modules/contests/service.js` — contest CRUD
  - `createContest(actor, payload)`: validate + insert + audit.
  - `updateContest(actor, slug, fields)`: assert not started + update + audit.
  - `deleteContest(actor, slug)`: admin-only + cascade + audit.
  - `getContest(actor, slug)`: return detail with computed status
    (upcoming/running/finished), registration status, participant count.
  - `listContests(actor, { page, pageSize, status })`: paginated, sorted
    by `starts_at DESC`, with computed status and participant count.
  - Time-driven lifecycle: compute phase from `NOW()` vs `starts_at`,
    `ends_at`, `freeze_minutes`.
  - _Requirements: 1.1–1.7, 11.1–11.5, 15.1–15.5_

- [x] 8.2 Implement service — problem attachment
  - `attachProblem(actor, slug, { problemSlug, letter })`: assert not
    started, resolve problem via `problems.service`, insert, audit.
  - `detachProblem(actor, slug, letter)`: assert not started, remove.
  - Reject with 409 `CONTEST_ALREADY_STARTED` if `NOW() >= starts_at`.
  - Reject with 409 `LETTER_ALREADY_USED` on duplicate letter.
  - Reject with 404 if problem slug not found.
  - _Requirements: 2.1–2.6_

- [x] 8.3 Implement service — registration and participation
  - `register(actor, slug)`: assert before `starts_at`, insert.
  - `unregister(actor, slug)`: assert before `starts_at`, remove.
  - `participate(actor, slug, { virtual })`: create participation row
    with computed `personal_deadline`.
  - Live: require registration, assert contest active, compute deadline
    as `MIN(NOW() + duration, ends_at)`.
  - Virtual: no registration required, assert contest finished, deadline
    = `NOW() + duration`.
  - _Requirements: 3.1–3.5, 4.1–4.5, 5.1–5.3_

- [x] 8.4 Implement service — contest submissions
  - `submitInContest(actor, slug, letter, { code, language })`: validate
    participation active + deadline not passed, resolve letter → problem,
    delegate to `submissions.service.submit` with `contestParticipationId`.
  - Insert `contest_submissions` link row.
  - Return 202 with pending submission shape.
  - Reject 400 `CONTEST_TIME_EXPIRED` if past personal deadline.
  - Reject 400 `LANGUAGE_NOT_ALLOWED` if language not in allowlist.
  - _Requirements: 6.1–6.6, 17.1–17.4_

- [x] 8.5 Implement service — standings and finalization
  - `getStandings(actor, slug, { unfrozen, since })`: compute standings
    via `computeICPCStandings`, apply freeze filter if in freeze period
    and not admin with `unfrozen=true`.
  - `onContestSubmissionFinalized(submissionId)`: called by worker after
    judge finalization, recomputes participant standing.
  - `finalizeContestRatings(slug)`: compute Glicko-2 changes for all
    live participants, insert rating changes, update `contest_ratings`.
  - _Requirements: 7.1–7.5, 8.1–8.3, 9.1–9.5, 10.3–10.5_

- [x] 8.6 Implement service — editorial and user history
  - `publishEditorial(actor, slug, { content })`: store markdown on
    contest row.
  - `getEditorial(actor, slug)`: return editorial only if contest ended;
    404 if not published.
  - `getContestRating(username)`: return current rating + history.
  - `getUserContestHistory(username)`: return list of participated
    contests with rank, solved, rating change.
  - _Requirements: 13.1–13.5, 14.1–14.4, 10.7_

## 9. Contest module: routes

- [x] 9.1 Create `modules/contests/routes.js`
  - Wire all endpoints from design.md §Endpoint Map.
  - Gate management endpoints behind `requireRole(INSTRUCTOR, ADMIN)`.
  - Gate delete behind `requireRole(ADMIN)`.
  - Gate `?unfrozen=true` behind `requireRole(ADMIN)`.
  - Gate all other endpoints behind `requireAuth`.
  - Schema validation via zod on request bodies.
  - Return appropriate HTTP status codes (201, 202, 200, 400, 403, 404, 409).
  - _Requirements: 15.1–15.5_

## 10. Wire into app.js

- [x] 10.1 Mount contest routes in `src/app.js`
  - Import contests router, mount at `/api/contests`.
  - Add user-scoped routes: `/api/users/:username/contests` and
    `/api/users/:username/contest-rating`.
  - Ensure mount order does not conflict with existing routes.
  - Verify `npm run lint` passes (module boundary rules).
  - _Requirements: 1.1, 11.1, 14.1, 10.7_

## 11. Frozen standings

- [x] 11.1 Implement frozen standings time-based query filter
  - In `getStandings`, when `NOW()` is between `ends_at - freeze_minutes`
    and `ends_at`, filter submissions to `created_at < ends_at - freeze_minutes`.
  - Show post-freeze submissions as "pending" (attempt count increments,
    verdict hidden).
  - Admin with `?unfrozen=true` bypasses the filter.
  - After `ends_at`, automatically unfreeze (no filter applied).
  - If `freeze_minutes = 0`, never freeze.
  - _Requirements: 9.1–9.5_

- [ ]* 11.2 Property test: frozen standings consistency
  - For any contest with `freeze_minutes > 0`, public standings during
    freeze period are identical to standings computed from submissions
    before the freeze point. No post-freeze submission alters public view.
  - `// Feature: contest-mode, Property 3: Frozen standings consistency`
  - **Property 3: Frozen standings consistency**
  - **Validates: Requirements 9.1, 9.3**

## 12. Virtual participation

- [x] 12.1 Implement virtual participation mode
  - Virtual join: `POST /api/contests/:slug/participate?virtual=true`
    after contest ends.
  - No registration required for virtual.
  - Personal deadline = `NOW() + duration_minutes`.
  - Virtual submissions accepted until personal deadline.
  - Standings: virtual participants displayed separately with `virtual`
    badge.
  - Penalty computed identically to live (relative to personal `started_at`).
  - _Requirements: 5.1–5.5_

- [ ]* 12.2 Property test: virtual parity
  - For any virtual participant V and live participant L with identical
    relative submission sequences, V's score equals L's score.
  - `// Feature: contest-mode, Property 4: Virtual parity`
  - **Property 4: Virtual parity**
  - **Validates: Requirements 5.4, 7.2**

## 13. Contest submission integration

- [x] 13.1 Link contest submissions to async judge pipeline
  - Add `contest_participation_id` field to judge job metadata.
  - On finalization in the worker, call
    `contests.service.onContestSubmissionFinalized(submissionId)`.
  - Atomically update participant standing with submission status update.
  - Support both `inline` and `bullmq` queue modes.
  - On `JUDGE_ERROR`, do NOT alter participant standing.
  - Filter contest submissions from `GET /api/submissions/recent` feed.
  - _Requirements: 17.1–17.4, 6.5, 6.6_

- [x] 13.2 Implement rating computation trigger
  - After contest ends, admin can trigger
    `POST /api/contests/:slug/finalize-ratings` (or auto-trigger).
  - Call `finalizeContestRatings(slug)` which computes Glicko-2 for all
    live participants and inserts rating changes in a single transaction.
  - Virtual participants excluded from rating computation.
  - _Requirements: 10.3, 10.4, 10.5_

## 14. Checkpoint

- [x] 14. Checkpoint — Ensure all backend tests pass
  - Run `npm run lint` + `npm test` in `Backend/`.
  - All pre-existing 437+ checks stay green.
  - New contest module tests present and passing.
  - Ensure all tests pass, ask the user if questions arise.

## 15. Editorial

- [x] 15.1 Implement editorial CRUD
  - `PUT /api/contests/:slug/editorial` with `{ content }` (markdown).
  - Store on `contests.editorial` column.
  - `GET /api/contests/:slug/editorial`: return content only after
    `ends_at` has passed; 404 if not published or contest not ended.
  - Gate publish behind `requireRole(INSTRUCTOR, ADMIN)`.
  - Gate read behind `requireAuth`.
  - _Requirements: 13.1–13.5_

## 16. User contest history + rating endpoint

- [x] 16.1 Implement user contest history and rating endpoints
  - `GET /api/users/:username/contests`: list of participated contests
    with `contest_slug`, `contest_title`, `date`, `rank`, `solved_count`,
    `rating_change`, `new_rating`.
  - `GET /api/users/:username/contest-rating`: current rating, RD,
    volatility, contests_played, rating history array.
  - Return empty array / null rating for users with no contest history.
  - _Requirements: 14.1–14.4, 10.7_

## 17. Integration tests

- [ ]* 17.1 `test/integration-contests.test.mjs` — full lifecycle
  - Create contest → attach problems → register → participate → submit →
    verify standings → end contest → verify unfrozen → compute ratings.
  - Virtual participation flow: join after ends_at → submit → verify
    separate standings → verify no rating change.
  - Authorization matrix: STUDENT cannot create/update/delete; unauth
    gets 401; ADMIN can see unfrozen standings.
  - Temporal guards: cannot update after start, cannot register after
    start, cannot submit after deadline.
  - Feed filtering: contest submissions excluded from
    `/api/submissions/recent`.
  - Editorial: hidden before end, visible after end, 404 if not published.
  - ~60+ supertest assertions.
  - _Requirements: 1.1–1.7, 2.1–2.6, 3.1–3.5, 4.1–4.5, 5.1–5.5,
    6.1–6.6, 7.1–7.5, 8.1–8.3, 9.1–9.5, 10.3–10.7, 13.1–13.5,
    15.1–15.5, 17.1–17.4_

## 18. Frontend: contest list

- [x] 18.1 Implement `/contests` page
  - `ContestList` component with status tabs: upcoming / running / finished.
  - Fetch from `GET /api/contests?status=<tab>` with pagination.
  - Display: title, time window, participant count, status badge.
  - "Register" button for upcoming contests (if not already registered).
  - Link to contest detail page.
  - _Requirements: 11.1, 11.2, 3.1_

## 19. Frontend: contest detail/workspace

- [x] 19.1 Implement `/contests/:slug` page
  - `ContestDetail` component with tabs: Info / Problems / Standings /
    Editorial.
  - Info tab: description, time window, freeze config, registration
    status, participant count.
  - Problems tab: letter list with titles (statements hidden before start,
    visible during/after for participants).
  - Register / Participate / Virtual Join buttons based on contest phase.
  - Countdown timer showing remaining time during active participation.
  - Disable submit button when personal deadline expires.
  - _Requirements: 11.3–11.5, 12.1, 12.5_

## 20. Frontend: standings

- [x] 20.1 Implement `/contests/:slug/standings` leaderboard
  - Real-time standings table with auto-refresh (polling every 15s during
    active contest).
  - Columns: rank, username, solved count, penalty time, per-problem
    breakdown (attempts + accepted time).
  - First-solve highlight per problem.
  - Frozen indicator banner when standings are frozen.
  - Pending submissions shown with "?" during freeze.
  - Virtual participants in separate section with badge.
  - _Requirements: 8.1–8.5, 9.4, 9.5_

## 21. Frontend: contest problem view

- [x] 21.1 Implement `/contests/:slug/problems/:letter` page
  - Problem statement with SAMPLE test cases, input/output format,
    per-problem limits.
  - Full-program code editor (Monaco) with language selector filtered
    to problem's `language_allowlist`.
  - Submit button → `POST /api/contests/:slug/submissions/:letter` with
    async polling for verdict.
  - Per-submission verdict display (ACCEPTED, WRONG_ANSWER, TLE, etc.).
  - Participant's own submission history for this problem within contest.
  - _Requirements: 12.2–12.4_

## 22. Frontend: profile contest history

- [x] 22.1 Implement `/profile/:username/contests` page
  - Contest history table: contest title, date, rank, solved count,
    rating change, new rating.
  - Rating graph: line chart of rating over time (lightweight chart lib
    or SVG).
  - Current contest rating displayed prominently.
  - Empty state for users with no contest history.
  - _Requirements: 14.1–14.4_

## 23. Frontend checkpoint

- [x] 23. Checkpoint — Frontend build + typecheck
  - Run `npm run typecheck` + `npm run build` in `Frontend/Frontend/`.
  - Ensure all tests pass, ask the user if questions arise.

## 24. ADR

- [x] 24.1 Write `docs/decisions/0017-contest-mode.md`
  - Summarise design decisions: ICPC-only scoring, individual contests,
    Glicko-2 separate from `users.rating`, frozen standings via time
    filter, contest submissions as link table, virtual participation.
  - Reference requirements.md and design.md.
  - Note follow-ups: team contests, Codeforces/IOI scoring, WebSocket
    standings.
  - _Requirements: none (housekeeping / traceability)_

## 25. Update AGENTS.md + .env.example

- [x] 25.1 Update `Backend/.env.example`
  - Document any new env vars (none expected beyond existing ones, but
    confirm no contest-specific config needed).
  - _Requirements: none (housekeeping)_

- [x] 25.2 Update `AGENTS.md`
  - Add ADR 0017 entry to section 4.
  - Add contest-mode to Phase 2 table with commit hash placeholders.
  - Document new test files and module under section 11.
  - _Requirements: none (housekeeping)_

## 26. Verification

- [x] 26.1 Full `npm test` green
  - All pre-existing 437+ checks stay green.
  - New suites present: `scoring-engine-properties`,
    `glicko2-properties`, `integration-contests`.
  - _Requirements: all_

- [x] 26.2 Frontend build + typecheck
  - `npm run typecheck` + `npm run build` green in `Frontend/Frontend/`.
  - _Requirements: all frontend requirements_

- [x] 26.3 Manual smoke: contest lifecycle end-to-end
  - Create contest via `/teach` or API, attach STDIO problems, register
    as student, participate, submit, verify standings update, verify
    freeze behaviour, verify rating computation after contest ends.
  - _Requirements: 1.1, 6.1, 7.1, 8.1, 9.1, 10.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests validate universal correctness properties from the design.
- Unit tests validate specific examples and edge cases.
- The scoring engine and Glicko-2 engine are pure functions — ideal for PBT.
- Contest lifecycle is time-driven (no state column); service computes phase
  from `NOW()` vs `starts_at` / `ends_at` / `freeze_minutes`.
- Contest submissions reuse the existing async judge pipeline (ADR 0013).
- Virtual participation uses the same scoring engine with different `started_at`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "6.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "5.1", "7.1"] },
    { "id": 3, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 4, "tasks": ["8.4", "8.5", "8.6"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["11.1", "12.1", "13.1", "13.2", "15.1", "16.1"] },
    { "id": 8, "tasks": ["11.2", "12.2", "17.1"] },
    { "id": 9, "tasks": ["18.1", "19.1", "20.1", "21.1", "22.1"] },
    { "id": 10, "tasks": ["24.1", "25.1", "25.2"] },
    { "id": 11, "tasks": ["26.1", "26.2", "26.3"] }
  ]
}
```
