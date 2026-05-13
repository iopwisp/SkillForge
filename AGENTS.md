# AGENTS.md

> Quick-start context for AI coding sessions on the SkillForge codebase.
> Read this BEFORE doing anything else when continuing work after a break.
> Last updated: 2026-05-09 (after Phase 1 step #9: instructor + admin
> frontend surfaces — courses + groups + exams + gradebook + problem
> creator + audit log UIs. Backend still 402 checks green, no backend
> changes. Frontend: tsc + react-router build green, all uncommitted).

---

## 1. What this project is

**SkillForge** — a coding-practice platform aimed at being sold to
universities, starting with a pilot at AITU (Astana IT University,
Kazakhstan). Working name niche: SQL + backend + frontend tasks (not
competitive programming). Currently a working Node + Postgres SPA at
~10k LOC; being evolved into a B2B EdTech product.

The user is a solo full-time developer, currently a student at AITU,
based in Kazakhstan. Communication is in Russian; code, comments,
commit messages, and ADRs are in English.

---

## 2. Strategic context (non-negotiable inputs)

These were decided in conversation; do not relitigate them without
explicit reason.

| Decision | Value |
|---|---|
| Target market | Kazakhstan universities (AITU first, then KBTU/NU/Satbayev/KazNU) |
| Deployment model | **On-prem only** — each university hosts its own copy |
| Tenancy | **Single-tenant per installation** (no `tenant_id` column anywhere) |
| Differentiation | Real-world skills (SQL / backend / frontend), NOT LeetCode-style algorithms |
| Working mode | Solo, full-time, 3–5 months runway to AITU pilot |
| First customer | AITU as a free pilot for one semester → case study → paid customers |
| Sales horizon | Realistically 12–18 months to first paying contract |

If the user pivots any of these, the technical roadmap below changes
significantly — re-read the chat history first.

---

## 3. Tech stack

```
Backend/                        Node 20 + Express 4 + PostgreSQL (`pg`) + isolated-vm
  src/
    index.js                    bootstrap (only place modules are wired)
    shared/
      db.js                     pg pool + query helpers + transactions
      migrations.js             forward-only SQL migration runner
      errors.js                 HttpError + asyncHandler
      seed/                     algorithm/backend/frontend/sql data + runSeed
    modules/
      auth/        (5 files)    routes, service, queries, schemas, middleware
      users/       (4 files)    routes, service, queries, schemas
      problems/    (3 files)    routes, service, queries
      categories/  (3 files)    routes, service, queries
      submissions/ (4 files)    routes, service, queries, schemas
      judge/       (1 file)     service.js — runSqlJudge / runJsJudge / runJudge
  eslint.config.js              boundary rules (no-restricted-imports)
  Dockerfile                    multi-stage (build for native modules)

Frontend/Frontend/              React 19 + React Router 7 (SPA) + Tailwind 4 + shadcn/ui
  app/
    routes/, components/, lib/  feature-based-ish (loaders for data)
```

Native modules (`isolated-vm`, `better-sqlite3`) compile from source on
install. Locally on Windows that needs MSVC build tools; Ubuntu CI has
gcc/g++/python3/make by default; Docker uses a multi-stage build.

---

## 4. Architectural decisions (read these, they're short)

`docs/decisions/`:

- **0001 — On-prem single-tenant.** Each university gets its own
  installation. No multi-tenancy in code.
- **0002 — Postgres + versioned migrations.** `db/migrations/NNNN_*.sql`,
  forward-only, applied at startup. **Shipped** with raw `pg` and a
  hand-rolled migration runner in `shared/migrations.js`.
- **0003 — Modular monolith with enforced boundaries.** Three rules:
    - `queries.js`: no cross-module imports.
    - `routes.js`: no `queries.js` (own or other), no `shared/db.js`.
    - `service.js`: no other module's `queries.js`.
  Enforced via ESLint `no-restricted-imports`. Cross-module access is
  always `service.js → other-module/service.js`.
- **0004 — `isolated-vm` for JS judge.** Phase A (in-process V8
  isolate) **shipped**. Phase B (Docker-per-submission for graded
  exams) is Phase 2 of the roadmap.
- **0005 — Pluggable auth providers.** **Shipped.** Local + Google
  behind a common provider interface; `AUTH_PROVIDERS` env controls
  which are registered; frontend discovers via `GET /api/auth/providers`.
  Microsoft / OIDC / LDAP / SAML drop in as new files in
  `modules/auth/providers/` for Phase 2.
- **0006 — User roles for the university model.** **Foundation
  shipped** (uncommitted). Three roles: STUDENT (default), INSTRUCTOR,
  ADMIN. First user on a fresh on-prem installation is bootstrapped as
  ADMIN by the auth providers; subsequent self-service signups default
  to STUDENT. `requireRole(...allowed)` middleware in
  `auth/middleware.js` gates routes; a `ROLES` constant is exported so
  typos surface at boot time, not as silent 403s in prod.
- **0007 — Courses (minimal model + permissions).** **Initial CRUD
  shipped** (uncommitted). Two tables: `courses(owner_id REFERENCES
  users)` and `course_problems` (cascade on both ends, non-unique
  `position` for simple reorders). Create requires INSTRUCTOR/ADMIN;
  update/delete/attach/detach require owner-or-ADMIN, enforced in the
  service so CLI / scripts go through the same gate. Read endpoints
  are open to any authenticated user for now; enrolment-scoped
  visibility ships with the groups module.
- **0008 — Groups, enrolment, and narrowed course visibility.**
  **Shipped** (uncommitted). Two tables: `groups(course_id, slug,
  title)` with `UNIQUE(course_id, slug)` (slug is unique per course,
  not globally) and `group_members(group_id, user_id)`. Both cascade
  on course / user delete. Management permissions match courses
  (owner-or-ADMIN). STUDENTs see only groups they belong to; the
  same enrolment check also narrows the `GET /api/courses` and
  `GET /api/courses/:slug` endpoints from "all authenticated" to
  "courses the student is enrolled in" (404 for not-enrolled, so the
  existence of other courses doesn't leak).
- **0009 — Exams: window + per-student duration + attempts.**
  **Shipped** (uncommitted). Three tables (`exams`, `exam_problems`,
  `exam_attempts`) plus `submissions.exam_attempt_id` FK. Exam =
  course-wide (`group_id NULL`) or per-group. Per-student personal
  deadline = `min(started_at + duration_minutes, ends_at)`. Scoring
  is computed on read (no persisted cache). In-exam submissions are
  filtered out of the public `/api/submissions/recent` feed so it
  can't spoil answers. "Exam frozen once started" blocks PUT /
  attach / detach after `starts_at`; DELETE is always allowed.
- **0010 — Gradebook + CSV export.** **Shipped** (uncommitted). No new
  tables: the course gradebook is a read model over `groups` +
  `group_members` + `exams` + `exam_problems` + `exam_attempts` +
  `submissions`. Owner-or-ADMIN only. Group-scoped exams render as
  blank / non-applicable for students outside that group, and totals
  sum only the exams that apply to the given student.
- **0011 — Instructor problem creator.** **Shipped** (uncommitted). No
  per-problem owner yet: any INSTRUCTOR or ADMIN may create, edit, and
  delete unused problems. Authoring data uses the existing `problems`
  table; `/api/problems/:slug/edit` is the protected editor payload, and
  delete is blocked while a problem is referenced by courses, exams, or
  submissions.
- **0012 — Audit log.** **Shipped** (uncommitted). New `audit_events`
  table plus `GET /api/audit-log` for ADMINs. Logs successful privileged
  mutations with actor snapshots (`actor_username`, `actor_role`), action,
  entity type/key, JSON details, and timestamp. Failed mutations are not
  logged.

- **0013 — Async judge pipeline (BullMQ).** **Shipped** (uncommitted).
  Two-phase submit: Phase A (HTTP) inserts a PENDING row + enqueues a
  BullMQ job; Phase B (worker) runs the judge + atomically updates the
  row + problem counters + rating. `JUDGE_QUEUE` env switches between
  `inline` (tests/dev: finalize on the same event loop) and `bullmq`
  (production: Redis-backed queue + separate worker process). Idempotent
  submit via `Idempotency-Key` header collapses retries onto the same
  row. `GET /api/submissions/:id` polling endpoint for async verdict
  retrieval. Smoke-tested at 200 concurrent submits in bullmq mode.

- **0014 — Polyglot function judge.** **Initial implementation shipped**
  (uncommitted). Function-style problems with `test_cases_json` now run
  JavaScript/TypeScript, Python, Java, and Go. JS/TS still use
  `isolated-vm`; Python/Java/Go use generated per-language runners via
  local runtimes or Docker (`JUDGE_RUNTIME_MODE=auto|local|docker|off`).
  SQL remains SQLite-only. Legacy algorithm problems without test cases
  still use the old heuristic fallback.

- **0015 — STDIO judge.** **Shipped** (uncommitted). New `STDIO` problem
  type for stdin/stdout problems (classic Codeforces / Kattis / ACM-ICPC
  shape). Students submit full programs that read from stdin and write to
  stdout; the judge compares output under configurable comparator modes
  (`EXACT`, `TRIMMED`, `WHITESPACE_NORMALIZED`). Per-problem limits:
  `time_limit_ms`, `memory_limit_mb`, `output_size_cap_kb`. Per-problem
  `language_allowlist` restricts which languages students may submit in.
  Day-one languages: JavaScript, Python, Java, Go, C++ (new runtime).
  Reuses the async submit pipeline (ADR 0013) and honours
  `JUDGE_RUNTIME_MODE` (ADR 0014). New migration `0008_stdio_problems.sql`
  adds STDIO-specific columns. Seed catalog includes `stdio-sum-of-n`,
  `stdio-fizzbuzz`, `stdio-stable-sort-by-key`.

- **0017 — Contest mode.** **Shipped** (uncommitted).
  Competitive-programming contest system (ICPC shape). 7 tables in
  migration `0009_contests.sql`; `0010_submissions_contest_link.sql`
  threads contest submissions through the shared async judge pipeline
  (ADR 0013). Pure scoring + Glicko-2 engines live in `modules/contests/`
  alongside schemas/queries/service/routes. Contest rating is separate
  from `users.rating`. Frozen standings via time filter. Virtual
  participation supported (same engine, no rating impact). New frontend
  pages at `/contests`, `/contests/:slug`, `/contests/:slug/standings`,
  `/contests/:slug/problems/:letter`, `/u/:username/contests`.

If you make another big call, write a new ADR (`docs/decisions/000N-*.md`).

---

## 5. What was done in Phase 0 so far

Seven commits, in order:

1. `32f6dd3 chore(phase-0): foundation cleanup and B2B direction setup`
   - Removed Java/Spring scaffold (~14k LOC) — 9 microservices + Maven
     wrappers + multi-service docker-compose. The SPA never used them.
   - Flattened `Backend/server/*` → `Backend/`.
   - Tightened CORS: production rejects unknown origins; dev warns.
   - Added GitHub Actions CI (`.github/workflows/ci.yml`).
   - Created the four ADRs above.
2. `c2d3597 refactor(phase-0): introduce modular monolith with enforced boundaries`
   - Restructured `Backend/src/` into `modules/{auth,users,problems,categories,submissions,judge}/`
     and `shared/{db,errors,seed}`.
   - Routes throw `HttpError`; index.js error middleware maps it.
   - Async routes wrapped with `asyncHandler` (Express 4 doesn't auto-forward
     promise rejections).
   - Submissions does atomic `db.transaction()` for
     insert + problems counters + users rating bump.
   - Judge gets a unified `runJudge(problem, code, language)` facade.
   - ESLint flat config enforces module boundaries; CI runs lint.
3. `8060fa4 feat(phase-0): replace Node vm with isolated-vm for JS judge`
   - 32 MB isolate per submission, 1 s per-call wall-clock, structured-clone
     args/results, no host globals exposed.
   - 10 explicit isolation tests (`test/judge-isolation.test.mjs`) covering
     `vm` escape attempts, memory bomb, infinite loop, isolate disposal under
     load.
   - Multi-stage Dockerfile so native modules build in a stage with toolchain
     and the runtime image stays slim.
4. `c423e3b chore: add AGENTS.md for cross-session context` — this file.
5. `21d305b feat(phase-0): pluggable auth provider abstraction`
   - `modules/auth/providers/{local,google,index}.js` — provider plugins.
   - `modules/auth/service.js` is now a thin facade; JWT / refresh /
     password-change logic stays here, "how to authenticate" lives in
     providers.
   - `AUTH_PROVIDERS` env + `GET /api/auth/providers` for runtime discovery.
   - New generic `/api/auth/oauth/:provider/*` route shape; the legacy
     `/api/auth/google/*` URLs stay (Google console has them as redirect URI).
   - 23 unit tests in `test/auth-providers.test.mjs` covering register
     happy/duplicate paths, login happy/wrong-pw/unknown-user (with no
     enumeration), refresh rotation + double-use rejection, registry,
     provider capability flags, google `enabled()` reflects env.
6. `<prev> feat(phase-0): structured logging + request-id + Sentry hook`
   - `shared/logger.js` (pino: JSON in prod, pino-pretty in dev,
     warn-only in tests; redacts password / accessToken / refreshToken /
     authorization / cookie / client_secret).
   - `shared/middleware/request-id.js` (`X-Request-Id` round-trip; uses
     incoming header if sane, else generates a UUID; echoes back; sets
     `req.id`).
   - `shared/sentry.js` (`@sentry/node`, no-op unless `SENTRY_DSN` is
     set; Glitchtip-compatible for on-prem error tracking).
   - `pino-http` replaces `morgan('dev')`; `req.log` is a child logger
     with `reqId` baked in. Health checks no longer spam logs. 4xx
     log at warn, 5xx at error and forward to Sentry.
   - All `console.log/warn/error` in `src/` migrated to the logger
     (auth providers + seed runner).
   - New env: `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_RELEASE`,
     `SENTRY_TRACES_SAMPLE_RATE`.
7. `<next> test(phase-0): supertest integration tests for auth + submissions`
   - Extracted `src/app.js` with a `createApp()` factory. `src/index.js`
     is now a thin bootstrap (Sentry init, migrations, first-run seed,
     `app.listen`). This is the only change to production wiring.
   - `test/integration-auth.test.mjs` drives the real HTTP stack
     (routes → service → providers → queries → Postgres) via supertest.
     Covers register (201 / 409 / 400), login (by username + email,
     wrong pw + unknown user yielding identical error message so there
     is no user enumeration), `/me` (401 without / with bad token, 200
     with valid one, no `password_hash` leak), refresh rotation +
     double-use rejection + `/me` after refresh, logout revoking the
     refresh token, `/providers` discovery, `/api/health`, and a 404
     fallthrough. ~25 assertions.
   - `test/integration-submissions.test.mjs` drives the full submit
     pipeline (auth middleware → submissions service → judge → atomic
     transaction touching `submissions` + `problems` counters +
     `users.rating`). Covers 401 gating, 404 on unknown slug, 400 on
     invalid body, an **ACCEPTED** JS submission that bumps rating
     1200 → 1205, a second ACCEPTED for the same problem that does NOT
     bump rating again (first-solve invariant), a WRONG_ANSWER that
     leaves rating untouched, a SQL submission through the real SQL
     judge, `/me` history, per-problem history, public `/recent`, and
     verifies `/run` does NOT persist a row. ~26 assertions.
   - `scripts/ensure-test-db.mjs` — idempotent `CREATE DATABASE
     skillforge_test` helper so a fresh clone can do
     `docker compose up -d postgres && node scripts/ensure-test-db.mjs`
     before `npm test`.
   - `supertest ^7` added as devDependency.
   - `npm test` wired to run `integration-auth` and `integration-submissions`
     after `auth-providers`, before the seed reference-solution tests.
   - `createApp()` bumps the auth rate limiter ceiling to 100k/window
     when `NODE_ENV=test` so the integration suite's tight loop doesn't
     start tripping 429s (the limiter still behaves normally in
     dev/prod).

---

## 6. Phase 0 — what remains

| # | Task | Effort | Notes |
|---|---|---|---|
| ~~4~~ | ~~Pluggable auth providers~~ | done | ADR 0005 shipped. |
| ~~5~~ | ~~Pino logging + request-id + Sentry hook~~ | done | pino + pino-http + Glitchtip-compatible Sentry SDK. |
| ~~6~~ | ~~Migrate SQLite → PostgreSQL (ADR 0002), versioned migrations~~ | done | Implemented with raw `pg`, `db/migrations/0001_initial.sql`, async module queries/services/routes, and a Postgres service in CI. |
| ~~7~~ | ~~`docker-compose.yml` (Postgres + Backend) + `pg_dump` backup script~~ | done | `Backend/docker-compose.yml` runs `postgres` + `backend`; `scripts/backup-postgres.{sh,ps1}` write timestamped dumps to `Backend/backups/`. |
| ~~8~~ | ~~Integration tests for auth + submissions (supertest)~~ | done | 51 supertest assertions; verified green on a docker postgres on port 55432 because the dev box has another Postgres on 5432. |

**Phase 0 is done in the working tree** (still one big uncommitted bundle).
Phase 1 is now in progress; see section 6b below.

## 6b. Phase 1 — what was done so far

1. `<unc> feat(phase-1): roles foundation (STUDENT/INSTRUCTOR/ADMIN)`
   - **ADR 0006** — `docs/decisions/0006-user-roles.md` settles three
     roles, the closed-set TEXT+CHECK storage choice, the
     "first-user-becomes-ADMIN" bootstrap on a fresh on-prem install,
     and the `requireRole(...)` middleware contract.
   - **`db/migrations/0002_user_roles.sql`** — moves `'USER'` rows to
     `'STUDENT'`, switches the column default to `'STUDENT'`, adds the
     `users_role_check` CHECK constraint that closes the role set to
     `('STUDENT', 'INSTRUCTOR', 'ADMIN')`.
   - **`auth/queries.js`** — `insertLocalUser` and `insertGoogleUser`
     now take an explicit `role`, and `isFirstUser(executor)` returns
     true iff the `users` table is empty. Caller is expected to run it
     in the same transaction as the insert so two simultaneous registers
     on a brand-new install can't both end up as ADMIN.
   - **`auth/providers/local.js`** — `register` is now wrapped in
     `withTransaction`; bootstraps the first user as ADMIN, every
     subsequent self-service signup as STUDENT.
   - **`auth/providers/google.js`** — same bootstrap on the user-create
     branch of `loginOrCreateWithGoogle`.
   - **`auth/middleware.js`** — adds the frozen `ROLES` constant (so a
     typo in a route is a SyntaxError, not a silent 403) and the
     `requireRole(...allowed)` factory that 401s on missing/bad token,
     403s on wrong role, populates `req.user` on success. Construction
     itself throws on empty / typo'd role lists so a route bug can't
     accidentally allow everyone.
   - **`test/auth-middleware.test.mjs`** — 18 assertions covering the
     ROLES constant, `requireRole` input validation, the bootstrap
     ADMIN-vs-STUDENT path, and HTTP behaviour against a tiny mounted
     app with `requireRole(ADMIN)` and `requireRole(INSTRUCTOR, ADMIN)`
     endpoints. Wired into `npm test`.
   - **`test/integration-auth.test.mjs`** — three new assertions
     (first user is ADMIN, second user registers, second user is
     STUDENT) and the existing `role === 'USER'` check is gone.

   No public role-gated routes exist yet. Endpoints that consume
   `requireRole(...)` arrive in the subsequent Phase 1 commits when
   courses / groups / exams land.

2. `<unc> feat(phase-1): admin role-management endpoint`
   - **`PUT /api/users/:id/role`** — first route gated by
     `requireRole(ROLES.ADMIN)`. Body `{ role: 'STUDENT' | 'INSTRUCTOR'
     | 'ADMIN' }` validated by zod (`UpdateRoleSchema`). Path id is
     parsed and rejected with 400 if non-positive-integer; unknown
     id → 404; invalid role string → 400.
   - **`users.service.setRole(targetUserId, newRole)`** — atomic
     `withTransaction`: looks up the target, returns 404 if missing,
     short-circuits as a no-op if role is unchanged, otherwise checks
     the "last-ADMIN" invariant (`countAdmins() <= 1` blocks any
     ADMIN→non-ADMIN move) before issuing the UPDATE. Returns the
     public user shape post-update. The safeguard lives in the service
     so a future CLI / admin-script that calls the service directly
     can't accidentally orphan the installation either.
   - **`users.queries.js`** — `updateRole(userId, role, executor)` and
     `countAdmins(executor)`.
   - **Authorization is DB-driven, not JWT-driven.** `requireRole`
     calls `findUserById(payload.sub)` on every request, so a user
     who was just demoted from ADMIN loses access on the next call,
     regardless of how recently their access token was issued.
     Verified by the integration test "demoted theadmin can no longer
     call /role -> 403".
   - **`test/integration-users-roles.test.mjs`** — 25 supertest
     assertions covering: unauth 401, garbage-token 401, STUDENT 403,
     INSTRUCTOR 403, promote STUDENT→INSTRUCTOR→ADMIN, idempotent
     same-role 200, role-not-in-enum 400, missing body 400, bad id
     400, unknown id 404, the last-ADMIN safeguard (refuses self-
     demote when alone, allows it once a second ADMIN exists),
     post-demote loss of capability.

3. `<unc> feat(phase-1): courses module (CRUD + syllabus)`
   - **ADR 0007** — settles the minimal courses model, the owner-or-
     admin mutation contract, the "read endpoints open to all
     authenticated users for now" compromise, and the FK policy
     (cascade on `course_problems`; NO ACTION on `courses.owner_id`).
   - **`db/migrations/0003_courses.sql`** — creates `courses` and
     `course_problems` with the indices the read queries need.
   - **New module `src/modules/courses/`** — `schemas.js` (slug regex,
     zod for create/update/attach), `queries.js` (list with owner
     join + per-course `problem_count`, detail, attach via
     `ON CONFLICT DO NOTHING`, detach with RETURNING so the service
     can map the "not-attached" case to 404), `service.js` (atomic
     create / update / delete via `withTransaction`; local
     `assertCanMutate(actor, course)` helper centralises the
     owner-or-ADMIN check; cross-module read of
     `problems.service.getProblemBySlug` to resolve problem slugs),
     `routes.js` (GET endpoints behind `requireAuth`, write endpoints
     behind `requireRole(INSTRUCTOR, ADMIN)`).
   - **`src/app.js`** — wires `/api/courses`.
   - **`test/integration-courses.test.mjs`** — 45 supertest
     assertions covering: 401 on both read endpoints when unauth, 403
     for STUDENT on create, 201 for INSTRUCTOR and ADMIN, 409 on
     duplicate slug, 400 on invalid slug / empty title / missing
     title, list view (summary shape + problem counts update after
     attach), detail view shape, 403 update/delete by non-owner
     INSTRUCTOR, 200 by owner, 200 by ADMIN override, 404 on unknown
     slug, 400 on empty update body, attach+detach happy path with
     position preserved, 409 duplicate attach, 404 unknown problem,
     404 detach when not attached, cascade on course delete removes
     the link rows, and a direct DB-level FK guard that
     `DELETE FROM users` on a course-owner is rejected with a
     "violates foreign key" error (ADR 0007 §FK behaviour).

4. `<unc> feat(phase-1): groups + enrolment + narrowed course visibility`
   - **ADR 0008** — settles the groups model, per-course slug scoping,
     owner-or-ADMIN management, STUDENT-only "see your own group"
     visibility, and the course-visibility narrowing (STUDENTs see
     only enrolled courses; 404 for unrelated ones).
   - **`db/migrations/0004_groups.sql`** — `groups(course_id, slug,
     title)` with `UNIQUE(course_id, slug)` + `group_members(group_id,
     user_id)`. All cascades on `groups.course_id`, `group_members.*`.
   - **New module `src/modules/groups/`** — `schemas.js` (same slug
     regex style), `queries.js` (list per course, list per-user
     narrowed, membership predicate, CRUD + `ON CONFLICT DO NOTHING`
     attach, RETURNING detach; plus two read-only view queries into
     other modules' tables: `findCourseRefBySlug` against `courses`
     and `findUserIdByUsername` against `users`, so the service can
     do owner-check and username-lookup without creating a circular
     import with `courses.service`). `service.js` keeps the local
     `assertCanManageCourse(actor, course)` gate (mirror of
     courses.service) and the STUDENT narrowing logic on every read
     endpoint. `routes.js` uses `Router({ mergeParams: true })` and
     is mounted under `/api/courses/:courseSlug/groups` in `app.js`
     *before* the top-level `/api/courses` router so the more
     specific path wins.
   - **`src/modules/courses/queries.js`** — adds `listCoursesForStudent`
     and `isStudentInCourse` as read-only view queries that JOIN
     through `groups + group_members`. Same "view query" pragma as in
     users/queries.js.
   - **`src/modules/courses/service.js`** — `listCourses(actor)` and
     `getCourse(actor, slug)` now branch on `actor.role === 'STUDENT'`
     and narrow to their enrolments; not-enrolled is 404, not 403,
     per ADR 0008 (no existence leakage).
   - **`src/modules/courses/routes.js`** — GET handlers pass
     `req.user` through to the service. No other route changes.
   - **`test/integration-courses.test.mjs`** — 2 new assertions
     added for the narrowed STUDENT visibility (empty list + 404 on
     detail when not enrolled). Existing assertions that previously
     used a STUDENT token for reads now use the ADMIN token
     (functional equivalent — ADMIN always sees all).
   - **`test/integration-groups.test.mjs`** — 55 supertest assertions:
     401/403 auth-gating, unknown-course 404, 201 owner + admin
     create, 403 non-owner INSTRUCTOR, 409 dup slug in same course,
     201 same slug in different course (scoping), 400 invalid
     slug/title, list + detail shapes, update/delete non-owner 403
     vs owner/admin 200, add/remove members with owner/admin/409 dup
     /404 unknown user/403 non-owner/404 not-member, STUDENT sees
     only their own group in listings, STUDENT-in-no-group 404 on
     detail, enrol-then-sees / remove-then-hides visibility on
     `GET /api/courses` + `GET /api/courses/:slug`, and the cascade
     on course delete cleans up `groups` and `group_members`.

5. `<unc> feat(phase-1): exams (timed, per-student duration, attempts)`
   - **ADR 0009** — settles the exam data model, per-student personal
     deadline = `min(started_at + duration_minutes, ends_at)`, the
     "exam frozen once started" rule for PUT / attach / detach, the
     one-attempt-per-student invariant, and on-demand scoring (no
     cached score column). Also documents the
     `exam_attempt_id IS NULL` filter that keeps the public recent
     feed from spoiling in-flight exams.
   - **`db/migrations/0005_exams.sql`** — `exams`, `exam_problems`,
     `exam_attempts` (all cascade on course / user delete; attempts
     unique per `(exam_id, user_id)`); `ALTER TABLE submissions ADD
     COLUMN exam_attempt_id ... ON DELETE SET NULL` plus an index.
     CHECK constraints enforce `ends_at > starts_at` and
     `duration_minutes > 0` at the DB level.
   - **`submissions/queries.js`** — `insertSubmission` now accepts an
     optional `examAttemptId` (defaults to NULL), `getRecentActivity`
     filters `WHERE exam_attempt_id IS NULL`.
   - **`submissions/service.js`** — `submit({ …, examAttemptId })`
     propagates the attempt id into the DB row; rating bump / problem
     counters still run as before.
   - **New module `src/modules/exams/`** — `schemas.js` (zod refine
     checks for endsAt > startsAt and empty-body PUT), `queries.js`
     (CRUD + `solvedProblemsInAttempt` + `submissionsInAttempt` +
     read-only view queries on `courses`, `groups`, `users` and
     `group_members` for scope checks), `service.js` (create /
     update / delete / attach / detach with `assertCanManageCourse`
     and `assertNotStarted`; `startAttempt` / `submitInAttempt` /
     `finishAttempt` / `getMyAttempt` / `getAttemptForUser` driving
     the attempt lifecycle; `describeAttempt` returns
     `{ score: { earned, total, solved, outOf }, submissions }` with
     scoring computed via a single EXISTS-per-problem query),
     `routes.js` (mergeParams-nested under `/api/courses/:courseSlug/
     exams`, mutation endpoints behind `requireRole(INSTRUCTOR,
     ADMIN)`, attempt endpoints behind `requireAuth`).
   - **`src/app.js`** — wires `/api/courses/:courseSlug/exams` next to
     groups before the top-level `/api/courses` mount.
   - **`test/integration-exams.test.mjs`** — 52 supertest assertions:
     CRUD auth gating + non-owner 403 + 409 dup + validation
     (bad window, 0 duration, unknown group); visibility (scoped vs
     course-wide, STUDENT-not-enrolled -> 404); frozen-once-started
     blocks PUT / attach after `starts_at`; attempts (403 for
     instructor, 404 for out-of-scope student, 201 then 409 on
     double-start, 400 before window, 400 time-is-up); submit inside
     attempt (ACCEPTED + WRONG_ANSWER persisted with
     `exam_attempt_id` set; submitting a problem not in the exam -> 404);
     scoring (earned=5/total=8 after p-alpha solved); 403 for non-owner
     instructor trying to peek at student attempt; public
     `/api/submissions/recent` contains zero in-exam rows; deletion
     preserves submissions with `exam_attempt_id` SET NULL.

   Temporal predicates are exercised by directly editing
   `exams.starts_at` and `exam_attempts.started_at` in the test DB —
   the suite does not sleep.

6. `<unc> feat(phase-1): gradebook + CSV export`
   - **ADR 0010** — `docs/decisions/0010-gradebook-and-csv.md` settles
     the owner-or-ADMIN visibility model, the "no cache table yet"
     decision, the rule that group-scoped exams are non-applicable
     outside their target group, and the flat CSV shape
     `username,full_name,groups,<exam-slug...>,total`.
   - **`src/modules/courses/queries.js`** — adds three read-only view
     queries for the gradebook: enrolled-student roster
     (`groups + group_members + users`), exam columns with
     `problem_count` + `total_points` (`exams + exam_problems`), and
     per-attempt earned points / solved count collapsed from
     `submissions`.
   - **`src/modules/courses/service.js`** — adds `getGradebook(slug,
     actor)` and `gradebookToCsv(...)`. JSON rows contain student
     identity, group memberships, one score cell per exam, and a total.
     Applicable-but-unattempted exams show `0 / total`; non-applicable
     exams produce `score: null` and do not contribute to the row total.
   - **`src/modules/courses/routes.js`** — adds
     `GET /api/courses/:slug/gradebook` and
     `GET /api/courses/:slug/gradebook.csv`, both gated by
     `requireRole(INSTRUCTOR, ADMIN)` at the route layer and owner-or-
     ADMIN in the service.
   - **`test/integration-gradebook.test.mjs`** — 31 supertest
     assertions covering 401 unauth, 403 STUDENT, 403 non-owner
     INSTRUCTOR, 200 owner/admin, group-scoped vs course-wide exam
     applicability, unattempted applicable exams showing `0 / total`,
     totals excluding non-applicable exams, and CSV headers/body/content
     type / attachment filename.

7. `<unc> feat(phase-1): instructor problem creator`
   - **ADR 0011** — `docs/decisions/0011-instructor-problem-creator.md`
     settles the "shared installation-level catalog, no owner column
     yet" decision, the protected `/api/problems/:slug/edit` endpoint,
     and the safe-delete rule that refuses removal while a problem is
     referenced by `course_problems`, `exam_problems`, or `submissions`.
   - **`src/modules/problems/schemas.js`** — new zod schemas for create
     and partial update, including type-specific validation:
     `SQL` requires `sqlSetup` + `starterCode.sql` + `testCases`,
     `BACKEND`/`FRONTEND` require `functionName` + `starterCode` +
     `testCases`, and `ALGORITHM` requires `expectedOutput` or real
     tests.
   - **`src/modules/problems/routes.js`** — adds protected
     `POST /api/problems`, `GET /api/problems/:slug/edit`,
     `PUT /api/problems/:slug`, and `DELETE /api/problems/:slug`
     routes behind `requireRole(INSTRUCTOR, ADMIN)`. Public
     `GET /api/problems/:slug` stays student-safe and does not expose
     raw `testCases`.
   - **`src/modules/problems/service.js` / `queries.js`** — add create /
     update / delete flows, category lookup by slug, editor-detail
     serialisation, full-definition revalidation on update after merging
     the patch with the existing row, and the delete-usage summary across
     course / exam / submission references.
   - **`test/integration-problem-creator.test.mjs`** — 26 supertest
     assertions covering 401 unauth, 403 STUDENT, 201 create, 200 edit
     payload, duplicate-slug 409, unknown-category 404, per-type
     validation 400, "any INSTRUCTOR can update/delete" semantics, and
     delete refusal for course-attached, exam-attached, or already-
     submitted problems.

8. `<unc> feat(phase-1): audit log`
   - **ADR 0012** — `docs/decisions/0012-audit-log.md` settles the
     installation-level `audit_events` schema, ADMIN-only visibility,
     actor snapshots at write time, and the "successful privileged
     mutations only" rule.
   - **`db/migrations/0006_audit_events.sql`** — adds the
     `audit_events` table with `actor_id`, `actor_username`,
     `actor_role`, `action`, `entity_type`, `entity_key`, `details_json`,
     and indices on time / action / entity type / actor username.
   - **New module `src/modules/audit/`** — `queries.js` inserts and
     lists audit rows; `service.js` exposes `recordEvent(...)` and
     paginated/filterable `listEvents(...)`; `routes.js` wires
     `GET /api/audit-log` behind `requireRole(ADMIN)`.
   - **Mutation instrumentation** — successful privileged changes in
     `users.service.setRole`, `courses.service`, `groups.service`,
     `exams.service`, and `problems.service` now append audit events.
     Operations that throw before success (validation/auth/conflict) do
     not append a row.
   - **`test/integration-audit-log.test.mjs`** — 15 supertest
     assertions covering 401 unauth, 403 STUDENT/INSTRUCTOR, 200 ADMIN,
     actor/entity/action filters, event ordering, detail payload shape,
     and the absence of DELETE events for failed deletions.

9. `<unc> feat(phase-1): instructor + admin frontend surfaces`
   - **No backend changes.** The frontend now drives every existing
     instructor / admin endpoint; backend tests still 402 / 0.
   - **`Frontend/Frontend/app/lib/types.ts`** — `User.role` widened from
     the legacy `"USER" | "ADMIN"` to the proper closed set
     `"STUDENT" | "INSTRUCTOR" | "ADMIN"`. New `canTeach()` /
     `isAdmin()` helpers live alongside it. The pre-existing
     `User.theme` and other shapes are unchanged.
   - **`app/lib/teaching-types.ts`** — JSON shapes for courses, groups,
     exams, gradebook, problem-editor and audit events, mirroring the
     serialisers in the corresponding backend services.
   - **`app/lib/guards.tsx`** — adds `<RoleGuard allowed={[...]} />`
     that wraps `<ProtectedRoute>` with a server-mirror role check and
     a friendly "no access" page (driven by the existing `Empty`
     component) instead of a confusing 403 from the next API call.
     Server is still the source of truth — this guard exists for UX.
   - **`app/components/layout/AppShell.tsx`** — sidebar has new "Teach"
     and "Admin" sections rendered by `canTeach()` / `isAdmin()` so a
     STUDENT never sees the entries; the user role label shows in the
     sidebar footer as a quick at-a-glance debug aid.
   - **`app/routes.ts`** — adds `/teach` (redirect), `/teach/courses`,
     `/teach/courses/:slug`, `/teach/problems`, `/teach/problems/new`,
     `/teach/problems/:slug/edit`, `/admin` (redirect),
     `/admin/audit-log`. All under the existing AppShell layout.
   - **`app/routes/teach/courses.tsx`** — list of every course visible
     to the actor (INSTRUCTOR / ADMIN see all per ADR 0008) with a
     dialog-based create flow (slug + title + optional description).
   - **`app/routes/teach/course-detail.tsx`** — owner / admin course
     dashboard with 4 shadcn `Tabs`: Syllabus / Groups / Exams /
     Gradebook. Tab state persists in `?tab=...` so URL deep-links work.
     Includes header edit + delete with `<AlertDialog>` confirms.
   - **`app/components/teach/SyllabusPanel.tsx`** — attach/detach
     problems by slug with a position field; uses `<AlertDialog>` for
     destructive confirms.
   - **`app/components/teach/GroupsPanel.tsx`** — list/select/CRUD
     groups, manage members by username (the backend resolves usernames
     to ids per `groups/schemas.js#AddMemberSchema`). Lazy-fetches the
     selected group's member list so we don't pull every member at once.
   - **`app/components/teach/ExamsPanel.tsx`** — exam list with inline
     "Manage" expansion that fetches exam detail + attached problems
     for that row. Datetime fields use `<input type="datetime-local">`
     converted to ISO so `z.string().datetime({ offset: true })`
     accepts them. Mirrors ADR 0009's "frozen once started" rule by
     disabling PUT / attach / detach buttons when `starts_at` is in
     the past (with a tooltip), DELETE always available.
   - **`app/components/teach/GradebookPanel.tsx`** — read model from
     `GET /api/courses/:slug/gradebook` rendered as a students × exams
     matrix. Group-scoped exams render `N/A` for non-applicable
     students; totals only sum applicable cells. Download CSV button
     calls `GET /api/courses/:slug/gradebook.csv` directly through
     `fetch` (carrying the access token) and streams the body to a
     Blob URL for browser download.
   - **`app/routes/teach/problems.tsx`** — instructor catalog: list +
     filter by type/text + delete with `<AlertDialog>` (the backend's
     409 from problems still referenced by courses / exams /
     submissions surfaces as a toast).
   - **`app/components/teach/ProblemForm.tsx`** — shared editor for
     create + edit. Basic identity fields are first-class inputs;
     structured fields (`testCases`, `examples`, `starterCode`) fall
     back to JSON textareas with type-specific placeholders. Client-
     side guard rails for SQL / BACKEND / FRONTEND / ALGORITHM mirror
     the server validator so obvious errors don't round-trip. Edit page
     loads from the protected `GET /api/problems/:slug/edit` endpoint
     so `testCases` are visible (the public `GET /api/problems/:slug`
     hides them).
   - **`app/routes/teach/problem-new.tsx` /
     `app/routes/teach/problem-edit.tsx`** — thin wrappers around
     `ProblemForm` plus their own `api()` calls.
   - **`app/routes/admin/audit-log.tsx`** — paginated audit viewer with
     filters (action, entity_type, actor username, entity_key
     substring) all persisted in the URL so a deep-linked query is
     shareable. Each row collapses to show JSON `details` inline.
   - **Verification** — `npm run typecheck` (tsc + react-router typegen)
     and `npm run build` both green; vite emitted 14 KB / 4.7 KB gzip
     for `ProblemForm`, 36 KB / 9.2 KB gzip for `course-detail`,
     7.5 KB / 2.9 KB gzip for `audit-log`. Dev server smoke OK
     (`/teach`, `/teach/courses`, `/teach/problems/new`,
     `/admin/audit-log` all 200).

## 6c. Phase 1.5 — load readiness (async judge pipeline)

10. `<unc> feat(phase-1.5): async judge pipeline + idempotent submit`
    - **ADR 0013** — `docs/decisions/0013-async-judge-pipeline.md`
      settles two-phase submit (PENDING → enqueue → worker finalize),
      inline fallback for dev/test, `Idempotency-Key` header semantics,
      and the `GET /api/submissions/:id` polling endpoint.
    - **`db/migrations/0007_submissions_async.sql`** — adds
      `finished_at`, `idempotency_key` (partial UNIQUE where not null),
      `beats_pct` columns; adds `JUDGE_ERROR` and `PENDING` to the
      status CHECK constraint.
    - **`src/shared/queue.js`** — pluggable queue abstraction with two
      modes: `inline` (direct function call, dev/test) and `bullmq`
      (Redis-backed, production). Singleton-promise pattern guards
      against concurrent lazy-init races under load. `JUDGE_QUEUE` env
      + `REDIS_URL` env control the mode.
    - **`src/worker.js`** — standalone BullMQ worker process for
      production (`node src/worker.js`). Graceful shutdown with 30 s
      drain timeout.
    - **`submissions/service.js`** — split into `submit()` (Phase A:
      PENDING + enqueue) and `finalize()` (Phase B: judge + update).
      POST returns 202. Idempotency-Key lookup deduplicates retries;
      different-user same-key → 409.
    - **`submissions/queries.js`** — `insertPending`, `findIdempotent`,
      `findById`, `updateWithResult`, `markFailed` for two-phase flow.
    - **`submissions/routes.js`** — POST returns 202, added
      `GET /api/submissions/:id` (owner-only, no existence leakage),
      `Idempotency-Key` header parsing with validation.
    - **`docker-compose.yml`** — added Redis service on port 56379
      with healthcheck.
    - **`package.json`** — added `bullmq` and `ioredis` dependencies,
      `worker` script.

11. `<unc> feat(phase-1.5): frontend polling + Idempotency-Key`
    - **`app/lib/types.ts`** — added `JUDGE_ERROR` to `SubmissionStatus`.
    - **`app/lib/format.ts`** — added `JUDGE_ERROR` and `PENDING` to
      status color/label maps.
    - **`app/components/common/StatusBadge.tsx`** — added `JUDGE_ERROR`
      styling; PENDING uses spinning `Loader2` icon and "Judging…" label.
    - **`app/routes/problem-detail.tsx`** — `submit()` now generates a
      `crypto.randomUUID()` Idempotency-Key per click, sends it as a
      header. On PENDING response (bullmq mode), polls
      `GET /api/submissions/:id` every 600 ms (max ~36 s) with
      AbortController cleanup on unmount. ResultView shows the pulsing
      "Judging…" indicator while polling.

12. `<unc> test(phase-1.5): smoke load test (200 concurrent bullmq submits)`
    - **`test/smoke-bullmq.test.mjs`** — starts the BullMQ worker
      in-process, fires 200 concurrent POST `/api/submissions/:slug`
      with unique Idempotency-Keys, polls until all finalized, asserts:
      all 202 responses, all ACCEPTED verdicts, exactly 200 DB rows,
      rating bumped once (1205). Runs in ~6 s.
    - **`test/integration-async-judge.test.mjs`** — 22 assertions
      covering inline-mode semantics: 202 response, finishedAt
      populated, idempotent replay, different-user key conflict 409,
      bad key shapes 400, polling endpoint (owner 200, anon 401, other
      user 404, bad id 400).

## 6d. Phase 2 — STDIO judge

13. `<unc> feat(phase-2): STDIO judge for stdin/stdout problems`
    - **ADR 0015** — `docs/decisions/0015-stdio-judge.md` settles the
      STDIO problem type, comparator modes, per-problem limits, language
      allowlist, and C++ as a new runtime addition.
    - **`db/migrations/0008_stdio_problems.sql`** — adds `STDIO` to
      `problems.problem_type` CHECK, adds `output_size_cap_kb`,
      `comparator_mode`, `language_allowlist` columns with conditional
      CHECK constraints.
    - **`modules/judge/stdio-comparator.js`** — pure `compareStdio(mode,
      actual, expected)` function for `EXACT`, `TRIMMED`,
      `WHITESPACE_NORMALIZED` modes.
    - **`modules/judge/stdio-prepare.js`** — per-language compile/run
      step builders for Node, Python, Java, Go, C++.
    - **`modules/judge/stdio-exec.js`** — `execOneTest` subprocess
      execution with wall-clock, memory, and output-size limits;
      `runStdioJudge` iterates test cases with contest semantics
      (first-failure overall verdict); `runStdioOnce` for Run flow.
    - **`modules/judge/runtimes.js`** — extended with `cpp` entry
      (local `g++` or Docker `gcc:13-bookworm` via `JUDGE_CPP_IMAGE`).
    - **`modules/problems/`** — STDIO branch in schemas, service
      (defaults, range validation, type-change guard), queries (new
      columns), public vs editor serialisers (HIDDEN test cases never
      leak).
    - **`modules/submissions/`** — language-allowlist gate on Submit
      and Run, `stdin` field on Run schema, `LANGUAGE_NOT_ALLOWED` and
      `STDIN_TOO_LARGE` error codes.
    - **`shared/seed/stdio.js`** — three seed problems: `stdio-sum-of-n`,
      `stdio-fizzbuzz`, `stdio-stable-sort-by-key` with reference
      solutions in every allowed language.
    - **Frontend** — `ProblemForm` STDIO branch with test-case editor,
      limits inputs, comparator radio, language checkbox grid;
      `problem-detail` and `exam` routes render stdin/stdout Run panels
      and per-test results with SAMPLE diff view.
    - **Tests** — `stdio-comparator.test.mjs` (PBT),
      `judge-stdio-properties.test.mjs` (PBT), `judge-stdio-runtime.test.mjs`,
      `seed-stdio.test.mjs`, `integration-stdio.test.mjs`.

14. `<unc> feat(phase-2): contest mode (competitive programming)`
    - **ADR 0017** — `docs/decisions/0017-contest-mode.md` settles the
      ICPC-only scoring model, individual contests (no teams yet),
      Glicko-2 rating separate from `users.rating`, frozen standings via
      time filter (no materialised snapshot), contest submissions as a
      link table on the shared async judge pipeline, and virtual
      participation with no rating impact.
    - **`db/migrations/0009_contests.sql`** — 7 tables: `contests`,
      `contest_problems`, `contest_registrations`, `contest_participations`,
      `contest_submissions`, `contest_ratings`, `contest_rating_changes`.
      CHECK constraints (`ends_at > starts_at`, `freeze_minutes >= 0`,
      `letter ~ '^[A-Z]$'`), unique constraints on `slug`,
      `(contest_id, letter)`, `(contest_id, user_id)`, plus partial
      unique index `uniq_contest_live_participation` so each user gets
      at most one live participation per contest but may still join
      virtually. CASCADE on contest delete, RESTRICT on
      `contest_problems.problem_id`.
    - **`db/migrations/0010_submissions_contest_link.sql`** — threads
      contest submissions through the existing async judge pipeline
      (ADR 0013) by adding `submissions.contest_participation_id`
      (`ON DELETE SET NULL`) + index. Same `exam_attempt_id`-style
      "in-contest submissions excluded from the public recent feed"
      pattern so the leaderboard isn't spoiled for other participants.
    - **New module `src/modules/contests/`**:
        - `scoring-engine.js` — pure `computeICPCStandings(...)`:
          per-participant `solvedCount` + `totalPenalty`
          (`floor((acceptedAt - startedAt) / 60000) + 20 * wrongBefore`
          per solved problem; unsolved contributes zero), stable sort
          by `(solvedCount DESC, totalPenalty ASC)`, tie ranks, and
          first-solve flags per problem. Separates live vs virtual
          participants in output. No I/O imports.
        - `glicko2-engine.js` — pure `computeGlicko2Changes(...)`
          (Glickman 2012): μ/φ scaling, Illinois-method volatility
          update, zero-sum normalisation (`delta - mean(delta)`).
          Initial state `rating=1500, RD=350, vol=0.06`.
        - `schemas.js` — zod `CreateContestSchema` / `UpdateContestSchema`
          / `AttachProblemSchema` / `ContestSubmissionSchema` /
          `PaginationSchema` with kebab-case slug regex, ISO datetime,
          letter `^[A-Z]$`, and the `ends_at > starts_at` refine.
        - `queries.js` — CRUD over every contest table plus the
          read-only view queries into `users`, `problems`, and
          `submissions` the service needs.
        - `service.js` — contest CRUD + attach/detach + registration +
          participation (live vs virtual, with the
          `MIN(NOW() + duration, ends_at)` / `NOW() + duration` deadline
          rule), `submitInContest` delegating to
          `submissions.service.submit` with
          `contestParticipationId`, `getStandings` (with the freeze
          filter and the `?unfrozen=true` admin bypass),
          `onContestSubmissionFinalized` called by the worker,
          `finalizeContestRatings`, editorial publish/read gated on
          `ends_at`, and the profile-rating + contest-history reads.
          Contest lifecycle is time-driven from `starts_at` /
          `ends_at` / `freeze_minutes` — no status column.
        - `routes.js` — mounted at `/api/contests` with an additional
          user-scoped mount for `/api/users/:username/contests` and
          `/api/users/:username/contest-rating`. Management endpoints
          behind `requireRole(INSTRUCTOR, ADMIN)`, delete +
          `?unfrozen=true` behind `requireRole(ADMIN)`, read endpoints
          behind `requireAuth`.
    - **Frontend routes** (under the existing AppShell layout):
      `contests.tsx` (list with upcoming/running/finished tabs +
      register buttons), `contest-detail.tsx` (Info / Problems /
      Standings / Editorial tabs, register / participate / virtual-join,
      countdown timer during active participation),
      `contest-standings.tsx` (polling leaderboard with frozen-indicator
      banner, pending `?` cells during freeze, first-solve highlight,
      separate virtual section), `contest-problem.tsx` (STDIO-style
      full-program editor with language-allowlist filter and async
      submit + polling), `profile-contests.tsx` (history table + rating
      graph).
    - **Verification** — `npm run lint` green; `npm test` = 437+
      checks / 0 failures (contest PBT + integration suites are
      optional `*` tasks in the spec and were skipped for MVP —
      `scoring-engine` and `glicko2-engine` are covered only by the
      existing boundary-lint rules and the full-stack smoke). Frontend
      `npm run typecheck` + `npm run build` green.

---

## 7. Roadmap beyond Phase 0

```
Phase 0  Foundation                         (4–6 weeks)   ◄─ nearly done
Phase 1  University MVP                     (2–3 months)
         Roles (STUDENT/INSTRUCTOR/ADMIN), courses, groups, exams,
         instructor problem creator, gradebook + CSV, audit log.
         CONTENT TRACK in parallel: 30+ SQL, 25+ backend, 25+ frontend.
Phase 1.5 Load readiness                    (1–2 months, overlaps end of Phase 1)
         BullMQ + Redis, judge worker pool, idempotency on submit,
         smoke load test 200 concurrent. MUST FINISH BEFORE first AITU exam.
Phase 2  Pilot revenue features             (2–3 months)
         Microsoft 365 / Azure AD SSO, Winnowing plagiarism detection,
         license key, on-prem install/upgrade docs, Prometheus/Grafana.
Phase 3  Enterprise tail                    (later, after first paying customer)
         Helm chart, LTI 1.3 (Moodle/Canvas), proctoring, RU/KZ localisation,
         AI-tutor / AI code review.
```

Parallel non-technical track (run by the user, not by you):
- Find an AITU instructor for SQL/backend/web by end of Phase 0.
- Show prototype after Phase 0; get Phase 1 feature priorities from them.
- Free pilot at AITU during one semester after Phase 1.
- Use the case study to approach KBTU / NU / Satbayev / KazNU.

---

## 8. How the user works (style observed in the chat)

- Russian language for conversation; English for code and docs.
- Wants honest pushback. Don't agree just to agree. The user himself
  pushed back on parts of an earlier plan and was right about most of
  the corrections.
- Likes structured answers — tables, ranked lists, "what to do this week"
  with concrete day-by-day breakdowns.
- "Поехали" / "давай делай" / "по порядку" = green light, start working.
- Has called the assistant "Клод" once. Don't correct it.
- Wants to see verification (`npm test`, `npm run lint`, smoke HTTP)
  after each significant change — not to be told "should work".
- Does NOT want unsolicited pushes (`git push`). Commit yes, push only
  on explicit request.

---

## 9. Daily verification commands

Run these before claiming any task is done:

```bash
# Backend
cd Backend
npm run lint                 # ESLint, including module boundary rules
npm test                     # judge 14 + isolation 10 + polyglot 7 +
                             # stdio-comparator + judge-stdio-properties +
                             # judge-stdio-runtime + auth-providers 23 +
                             # auth-middleware 18 + integration-auth 27 +
                             # integration-submissions 27 +
                             # integration-users-roles 25 +
                             # integration-courses 45 +
                             # integration-groups 55 +
                             # integration-exams 52 +
                             # integration-gradebook 31 +
                             # integration-problem-creator 26 +
                             # integration-audit-log 15 +
                             # integration-async-judge 22 +
                             # integration-stdio +
                             # seed 12+12+16+N (stdio) = 437+ checks total
PORT=4099 node src/index.js  # smoke-boot; should print "running at http://localhost:4099"

# Frontend
cd Frontend/Frontend
npm run typecheck            # tsc + react-router typegen
npm run build                # vite production build
```

For end-to-end checks of cross-module flows, register a user via
`POST /api/auth/register` and submit code via
`POST /api/submissions/:slug` — verify rating bumps from 1200 to 1205
on the first ACCEPTED EASY problem.

---

## 10. Known gotchas

- **Application data now lives in PostgreSQL**, not `Backend/data/`.
  The old gitignored SQLite files can be deleted locally if still
  present. `better-sqlite3` remains only inside the SQL judge, where it
  creates fresh in-memory databases per submission.
- **Backups now go to `Backend/backups/`** via `scripts/backup-postgres.sh`
  or `.ps1`. The folder is gitignored; dumps are created by `pg_dump`
  inside the running `postgres` service from `docker-compose.yml`.
- **`.github/java-upgrade/`** is an artifact from a prior IDE/agent
  session. Not tracked in git. Ignore it; the user can delete it.
- **Express 4 does NOT auto-forward async errors.** Wrap async route
  handlers with `asyncHandler` from `shared/errors.js`. Sync handlers
  can throw `HttpError` directly.
- **`isolated-vm` is a native module.** On Windows it usually has
  prebuilt binaries; on Linux/Alpine it builds from source (the
  multi-stage Dockerfile handles this). On a fresh `npm ci`, expect
  ~30 seconds for compilation.
- **Cross-module DB writes** go through the *other* module's
  `service.js`, never `queries.js`. ESLint will reject the latter. The
  pattern is: `submissions.service` calls `problems.service.recordSubmission`
  and `users.service.bumpRating`.
- **Schema ownership in single-tenant on-prem** is per-deployment, not
  per-tenant. If you find yourself adding `tenant_id` anywhere, stop —
  re-read ADR 0001.
- **Static seed problems** (`shared/seed/{algorithm,backend,frontend,sql}.js`)
  are bootstrap data, not a module. Tests import them directly.
- **`runJudge(problem, code, language)`** is the only entry point that
  `submissions.service` should use. Don't import `runJsJudge`/`runSqlJudge`
  outside the judge module — except for tests.
- **CI lint runs first**, so a forgotten module-boundary violation will
  block the pipeline before tests even run. Reproduce locally with
  `npm run lint`.
- **Do not run `test/smoke-bullmq.test.mjs` against a dev DB you care
  about.** It intentionally `TRUNCATE`s core tables to isolate the load
  test, then inserts its own smoke problem/user.
- **If `npm run seed` fails with a duplicate primary key after tests,**
  the Postgres identity sequences are probably behind rows inserted with
  explicit IDs. Prefer a separate clean DB for dev vs tests; otherwise
  sync identity sequences before re-running seed.
- **Python/Java/Go judge support is function-based, not stdin/stdout.**
  The runner calls the problem's `function_name` with JSON `testCases`
  args. Go on this dev box uses the already-pulled `golang:1.23-alpine`
  Docker image because no local `go` binary is installed.
- **STDIO judge supports stdin/stdout problems.** New `STDIO` problem
  type for classic competitive-programming-style problems. C++ is a new
  runtime addition; `JUDGE_CPP_IMAGE` env (default `gcc:13-bookworm`)
  controls the Docker image used in `docker` mode. STDIO honours the
  same `JUDGE_RUNTIME_MODE` as the polyglot function judge.

---

## 11. Where we are right now

Phase 0 steps #1–#5 are committed (up to `c75406a`). Steps #6–#8 plus
Phase 1 #1–#9 plus Phase 1.5 #10–#12 plus the first Phase 2
student-facing exam UI pass plus the Phase 2 STDIO judge plus the
Phase 2 contest-mode feature are ALL uncommitted. Verified locally on
2026-05-09:

```
$ npm test              # 437+ checks / 0 failures (inline mode)
  judge.test.mjs                    14/0
  judge-isolation.test.mjs          10/0
  judge-polyglot.test.mjs            7/0
  stdio-comparator.test.mjs          N/0
  judge-stdio-properties.test.mjs    N/0
  judge-stdio-runtime.test.mjs       N/0
  auth-providers.test.mjs           23/0
  auth-middleware.test.mjs          18/0
  integration-auth.test.mjs         27/0
  integration-submissions.test.mjs  27/0
  integration-users-roles.test.mjs  25/0
  integration-courses.test.mjs      45/0
  integration-groups.test.mjs       55/0
  integration-exams.test.mjs        52/0
  integration-gradebook.test.mjs    31/0
  integration-problem-creator.mjs   26/0
  integration-audit-log.test.mjs    15/0
  integration-async-judge.test.mjs  22/0
  integration-stdio.test.mjs         N/0
  seed-backend.test.mjs             12/0
  seed-frontend.test.mjs            12/0
  seed-sql.test.mjs                 16/0
  seed-stdio.test.mjs                N/0

$ # Smoke load test (BullMQ mode — requires Redis on 56379)
$ JUDGE_QUEUE=bullmq REDIS_URL=redis://127.0.0.1:56379 \
  node --experimental-vm-modules test/smoke-bullmq.test.mjs
  9/0 — 200 concurrent, all 202→ACCEPTED in ~6 s

$ cd Frontend/Frontend
$ npm run typecheck     # clean
$ npm run build         # green
```

Phase 2 student exam-taking frontend has now started:

- `Frontend/Frontend/app/routes/courses.tsx` — student `/courses`
  list of enrolled courses.
- `Frontend/Frontend/app/routes/course-detail.tsx` — student
  `/courses/:slug` course page with exams list (upcoming/open/closed)
  and practice problems.
- `Frontend/Frontend/app/routes/exam.tsx` — student
  `/courses/:slug/exams/:examSlug` exam flow:
    - lobby with start confirmation and exam-window checks;
    - active timed workspace with problem tabs, resizable
      description/editor/results panes, localStorage draft persistence,
      async in-exam submit, idempotency key, and polling;
    - finished results view with score and submissions.
- `Frontend/Frontend/app/routes.ts` registers the three routes.
- `Frontend/Frontend/app/components/layout/AppShell.tsx` adds
  student "Courses" navigation and hides the sidebar on the full-screen
  exam workspace.
- Backend exam submit now returns `202` instead of `201`, matching the
  async judge pipeline (`exams/routes.js`; integration exam assertions
  updated).

Seed catalog expanded after manual browser QA of the student flow:

- Backend problems added:
  - `public-user-profile`
  - `normalize-pagination-query`
- Frontend problems added:
  - `class-names`
  - `toggle-selection`
- SQL problems added:
  - `sql-order-status-summary`
  - `sql-post-author-stats`
- STDIO problems added:
  - `stdio-sum-of-n`
  - `stdio-fizzbuzz`
  - `stdio-stable-sort-by-key`

Contest mode (Phase 2, uncommitted):

- Backend module `Backend/src/modules/contests/` with
  `scoring-engine.js` (pure ICPC `computeICPCStandings`),
  `glicko2-engine.js` (pure Glicko-2 with zero-sum normalisation),
  `schemas.js`, `queries.js`, `service.js`, `routes.js` mounted at
  `/api/contests` plus `/api/users/:username/contests` and
  `/api/users/:username/contest-rating`.
- `db/migrations/0009_contests.sql` (7 contest tables) +
  `db/migrations/0010_submissions_contest_link.sql` (adds
  `submissions.contest_participation_id`, excludes contest submissions
  from the public recent feed).
- Frontend pages: `app/routes/contests.tsx`,
  `app/routes/contest-detail.tsx`, `app/routes/contest-standings.tsx`,
  `app/routes/contest-problem.tsx`, `app/routes/profile-contests.tsx`;
  registered in `app/routes.ts`, linked from the AppShell sidebar.
- **Runtime-test coverage was intentionally skipped for MVP:** the
  scoring-engine PBTs, Glicko-2 PBTs, and `integration-contests.test.mjs`
  are optional `*` tasks in `.kiro/specs/contest-mode/tasks.md`. The
  437+ test total therefore stays unchanged; re-visit this once the
  first AITU contest is scheduled.
- Verification:
  - `node test/seed-backend.test.mjs`
  - `node test/seed-frontend.test.mjs`
  - `node test/seed-sql.test.mjs`
  - `node test/seed-stdio.test.mjs`
  - `npm run lint`
  - full `npm test` = 437+ checks / 0 failures

Polyglot language support added:

- `Backend/src/modules/judge/runtimes.js` — Python/Java/Go generated
  runners for function-style `testCases` problems.
- `Backend/src/modules/judge/service.js` — routes tested
  Python/Java/Go submissions to the polyglot runners; unsupported tested
  languages now return `COMPILE_ERROR` instead of falling through to the
  heuristic.
- `Backend/test/judge-polyglot.test.mjs` — local verification for
  Python, Java, Go, and unsupported language handling.
- `Backend/.env.example` documents `JUDGE_RUNTIME_MODE` and runtime
  images; `Backend/Dockerfile` includes `docker-cli` for Docker-mode
  judging.
- Frontend problem and exam workspaces now expose Python/Java/Go for
  backend/frontend function tasks, and Go for algorithm tasks.

The dev box runs ephemeral Docker containers on non-standard ports
(Postgres 55432, Redis 56379) to avoid conflicting with existing
services:

```bash
docker run -d --name skillforge-test-pg \
  -e POSTGRES_DB=skillforge_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -p 55432:5432 postgres:17-alpine

docker run -d --name skillforge-test-redis -p 56379:6379 redis:7-alpine

cd Backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test \
NODE_ENV=test JWT_SECRET=ci LOG_LEVEL=error \
npm test
```

**Next concrete action when you next start:** the working tree now
holds Phase 0 #6+#7+#8 *plus* Phase 1 #1–#9 *plus* Phase 1.5 #10–#12
*plus* the first Phase 2 student exam UI pass *plus* polyglot
Python/Java/Go function judging *plus* the Phase 2 contest-mode
feature. When the user green-lights committing, the natural split is:

  1. `feat(phase-0): Postgres migration + versioned migrations`
  2. `feat(phase-0): docker-compose + pg_dump backups`
  3. `test(phase-0): supertest integration tests for auth + submissions`
  4. `feat(phase-1): roles foundation (STUDENT/INSTRUCTOR/ADMIN)`
  5. `feat(phase-1): admin role-management endpoint`
  6. `feat(phase-1): courses module (CRUD + syllabus)`
  7. `feat(phase-1): groups + enrolment + narrowed course visibility`
  8. `feat(phase-1): exams (timed, per-student duration, attempts)`
  9. `feat(phase-1): gradebook + CSV export`
  10. `feat(phase-1): instructor problem creator`
  11. `feat(phase-1): audit log`
  12. `feat(phase-1): instructor + admin frontend surfaces`
  13. `feat(phase-1.5): async judge pipeline + idempotent submit`
  14. `feat(phase-1.5): frontend polling + Idempotency-Key`
  15. `test(phase-1.5): smoke load test (200 concurrent bullmq submits)`
  16. `feat(phase-2): student courses and exam-taking frontend`
  17. `feat(phase-2): Python Java Go function judging`
  18. `feat(phase-2): STDIO judge for stdin/stdout problems`
  19. `feat(phase-2): contest mode (competitive programming)`

The next likely work is:
  - Manual browser QA for the new student exam flow with seeded
    instructor/student data: enrolled course list, course detail, exam
    start, timer, submit/polling, finish, expired attempt, and forbidden
    not-enrolled cases.
  - Add focused frontend/API integration coverage for the exam flow
    once the manual path is stable.
  - Then decide whether to polish Phase 2 exam UX further (autosubmit on
    expiry, stronger anti-cheat/proctoring basics, attempt review) or
    start the larger Phase 2 backend item: Docker-per-submission judge
    isolation for graded exams.

---

## 12. If you find this file is wrong

Update it. This file is the source of truth for "what is the project,
what was done, what's next." If reality has drifted, fix the file in
the same commit as the change that caused the drift.
