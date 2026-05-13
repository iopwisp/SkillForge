# Implementation Plan: Live Instructor Dashboard

## Overview

Add a real-time polling-based dashboard at `GET /api/courses/:slug/live` and `/teach/courses/:slug/live` that shows instructors a color-coded student × problem progress matrix. The feature lives in the existing `courses` module as a read model (same pattern as gradebook). No new database tables.

## Tasks

- [x] 1. Backend query + service function
  - [x] 1.1 Add live dashboard queries to `courses/queries.js`
    - `listLiveStudents(courseId, groupSlug?)` — enrolled students with group info, optionally filtered by group
    - `listLiveProblems(courseId, examSlug?)` — course problems or exam problems, sorted by position
    - `getLiveSubmissionMatrix(courseId, { problemIds, studentIds })` — aggregated query returning `(user_id, problem_slug, attempts, last_submit_at, has_accepted)` grouped per student×problem
    - All three are read-only view queries joining across `submissions`, `group_members`, `course_problems`, `exam_problems`
    - Exclude in-exam submissions (`exam_attempt_id IS NULL`) from the practice matrix; include them when `examSlug` filter is active
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 5.1_

  - [x] 1.2 Add `getLiveDashboard(actor, slug, filters)` to `courses/service.js`
    - Resolve course → 404; `assertCanMutate(actor, course, 'view live dashboard')` → 403
    - Resolve optional exam/group within course → 404 if slug invalid
    - Parse `stuckMinutes` (default 5, validate positive integer) → 400 if invalid
    - Execute three queries in parallel via `Promise.all`
    - Derive `CellStatus` for each (student, problem) pair using the status rules
    - Compute summary counts (solved/attempting/stuck/idle)
    - Sort students by groupSlug then username
    - Return assembled response matching the design schema
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 2.4, 2.5, 3.1, 5.1_

  - [ ]* 1.3 Write property tests for status derivation and sorting logic
    - Extract `deriveStatus(hasAccepted, lastSubmitAt, stuckThresholdMs, now)` as a pure exported function
    - Extract `sortStudents(students)` as a pure exported function
    - Install `fast-check` as a devDependency if not already present
    - **Property 1: Status derivation is exhaustive and mutually exclusive**
    - **Validates: Requirements 1.5**
    - **Property 4: Student sort order is stable and correct**
    - **Validates: Requirements 3.1**

- [x] 2. Backend route + endpoint
  - [x] 2.1 Add `GET /:slug/live` route to `courses/routes.js`
    - Middleware: `requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN)`
    - Parse query params: `examSlug`, `groupSlug`, `stuckMinutes`
    - Call `courses.getLiveDashboard(req.user, req.params.slug, { examSlug, groupSlug, stuckMinutes })`
    - Return 200 with JSON response
    - _Requirements: 1.1, 2.1, 2.2_

  - [ ]* 2.2 Write integration tests for the live endpoint
    - `test/integration-live-dashboard.test.mjs`
    - Seed: instructor (owner), admin, non-owner instructor, student; course with 3 problems, 2 groups, 1 exam; submissions in various states
    - Assert: 401 unauth, 403 STUDENT, 403 non-owner INSTRUCTOR, 200 owner, 200 ADMIN
    - Assert: 404 unknown course, 404 unknown exam filter, 404 unknown group filter
    - Assert: 400 invalid stuckMinutes (0, -1, "abc")
    - Assert: correct statuses (SOLVED/ATTEMPTING/STUCK/IDLE) for seeded data
    - Assert: exam filter narrows problems and students
    - Assert: group filter narrows students
    - Assert: summary counts match matrix
    - **Property 2: Exam filter returns only exam-scoped data**
    - **Validates: Requirements 1.2**
    - **Property 3: Group filter returns only group members**
    - **Validates: Requirements 1.3**
    - _Requirements: 1.1–1.7, 2.1–2.5_

- [x] 3. Backend checkpoint
  - Ensure `npm run lint` passes (module boundary rules)
  - Ensure `npm test` passes with the new integration tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Frontend live dashboard page
  - [x] 4.1 Create `Frontend/Frontend/app/routes/teach/live-dashboard.tsx`
    - `RoleGuard` wrapper for INSTRUCTOR/ADMIN
    - Fetch `GET /api/courses/:slug/live` with optional `?examSlug=&groupSlug=&stuckMinutes=` from URL search params
    - 10-second polling via `setInterval` + `AbortController` cleanup on unmount
    - Manual refresh button resets the timer and fetches immediately
    - Render `LiveHeader`: course title, exam badge (if filtered), summary counts (solved/attempting/stuck/idle with color indicators)
    - Render `LiveFilters`: exam selector dropdown (fetched from course exams), group selector dropdown (fetched from course groups); changes update URL search params
    - Render `LiveMatrix`: table with problem columns (sorted by position) and student rows (sorted by group then alphabetically)
    - Color-coded cells: green (`bg-emerald-500`) for SOLVED, yellow with `animate-pulse` for ATTEMPTING, red (`bg-rose-500`) for STUCK, gray (`bg-muted`) for IDLE
    - Click student row → expand to show submission history (fetch from existing `/api/submissions` or inline from matrix data)
    - Click cell → show submissions for that student×problem pair
    - Responsive: works at 1920×1080 projector resolution (horizontal scroll for many problems, sticky first column for student names)
    - _Requirements: 3.1–3.8, 4.2, 6.1, 6.2_

  - [x] 4.2 Add TypeScript types to `Frontend/Frontend/app/lib/teaching-types.ts`
    - `LiveDashboardResponse`, `LiveStudent`, `LiveProblem`, `LiveCell`, `LiveSummary`, `CellStatus`
    - _Requirements: 1.6_

- [x] 5. Frontend integration into teach course detail
  - [x] 5.1 Register route in `Frontend/Frontend/app/routes.ts`
    - Add `route("teach/courses/:slug/live", "routes/teach/live-dashboard.tsx")` in the teach section
    - _Requirements: 4.2_

  - [x] 5.2 Add "Live" button to `Frontend/Frontend/app/routes/teach/course-detail.tsx`
    - Add a prominent "Live" button or link next to the existing tabs (or as a standalone action button in the header area)
    - Links to `/teach/courses/${slug}/live`
    - Use a distinctive icon (e.g., `Radio` or `Activity` from lucide-react) to make it stand out
    - _Requirements: 4.1_

- [x] 6. Frontend checkpoint
  - Ensure `npm run typecheck` passes
  - Ensure `npm run build` passes (vite production build)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The feature introduces no new database tables — purely a read model
- Property tests use `fast-check` and validate the pure logic (status derivation, sorting, filtering)
- Integration tests validate the full HTTP stack including auth gating and SQL correctness
- WebSocket is explicitly out of scope for v1 (documented follow-up)
