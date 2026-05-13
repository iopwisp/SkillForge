# Requirements Document

## Introduction

SkillForge currently judges two shapes of problems: function-style (JS/TS via
`isolated-vm`, plus Python/Java/Go via the polyglot runner from ADR 0014) and
SQL (SQLite in-memory). Classic university courses like *Intro to Programming*
and *Advanced Programming* at AITU are built almost entirely around stdin/stdout
problems ("read N, then N numbers, print the sum"; FizzBuzz; read a list and
sort it) that do not fit the function-call shape. This is also the canonical
shape used on Codeforces, Kattis, and ACM-ICPC.

This feature adds a first-class STDIO problem subtype to SkillForge. Authors
(INSTRUCTOR / ADMIN) create STDIO problems whose test cases are
`(stdin, expected_stdout)` text pairs; students submit a full program that
reads from standard input and writes to standard output; the STDIO Judge
executes the program per test case under enforced CPU wall-clock, memory, and
output-size limits, compares stdout to the expected output under a configurable
comparator mode, and reports per-test and overall verdicts through the existing
async submit pipeline (ADR 0013). Runtime execution honours the same
`JUDGE_RUNTIME_MODE=auto|local|docker|off` switch as the polyglot function
judge (ADR 0014), so the MVP works in `local` mode against already-installed
runtimes and in `docker` mode against the same image set.

Supported languages on day one are JavaScript (Node), Python 3, Java, and Go.
C++ (g++) is the canonical Intro-to-Programming language and is included as a
**new runtime addition** to the per-language runtime layer; if integrating
g++ bloats the MVP it is scoped down to a follow-up spec and explicitly called
out below (see Requirement 13). Existing function-style and SQL problems,
their editor branches, and their seed catalogs remain unchanged.

Single-tenant on-prem (ADR 0001), modular-monolith boundaries (ADR 0003), and
the async submit pipeline (ADR 0013) are hard constraints; no requirement
below introduces a `tenant_id`, crosses a module boundary the ESLint rules
forbid, or bypasses the `submit → enqueue → finalize` two-phase flow.

## Glossary

- **STDIO Problem**: A problem whose judging contract is reading from standard
  input and writing to standard output. Distinguished from Function-style
  Problems and SQL Problems by a dedicated `problems.type` value `STDIO`.
- **Function-style Problem**: Existing problem shape where the student provides
  a function body and the judge invokes it with JSON arguments per test case
  (ADR 0014). Unchanged by this spec.
- **SQL Problem**: Existing problem shape judged by the SQLite-backed SQL judge.
  Unchanged by this spec.
- **STDIO Test Case**: An ordered record
  `{ stdin: string, expected_stdout: string, visibility: 'SAMPLE' | 'HIDDEN' }`
  declared on the problem. Every STDIO problem has at least one SAMPLE test
  case.
- **Sample Test Case**: A test case with `visibility = 'SAMPLE'`. Its `stdin`
  and `expected_stdout` are visible to students in the problem description and
  may appear in per-test results.
- **Hidden Test Case**: A test case with `visibility = 'HIDDEN'`. Used for
  grading only; never shown to students in any form (no stdin, no expected
  output, no actual output), only the per-test verdict and resource usage.
- **Actual Output**: The bytes the student program writes to standard output
  during a test-case run, as captured by the STDIO Judge.
- **Comparator Mode**: The per-problem policy that decides whether Actual
  Output matches Expected Stdout. One of `EXACT`, `TRIMMED`,
  `WHITESPACE_NORMALIZED`. Floating-point tolerance (`FLOAT`) is a documented
  non-goal for v1; see Non-Goals.
- **Per-test Verdict**: One of
  `ACCEPTED | WRONG_ANSWER | TIME_LIMIT_EXCEEDED | MEMORY_LIMIT_EXCEEDED |
  RUNTIME_ERROR | COMPILE_ERROR | OUTPUT_LIMIT_EXCEEDED | JUDGE_ERROR`.
- **Overall Verdict**: The submission-level verdict. Equal to the per-test
  verdict of the first failing test case in declared order (contest
  semantics), or `ACCEPTED` if every per-test verdict is `ACCEPTED`.
- **Per-submission Limits**: Per-problem numeric bounds enforced on every
  test-case execution: `time_limit_ms` (CPU wall-clock per test case),
  `memory_limit_mb` (peak RSS per test case), and `output_size_cap_kb`
  (maximum bytes captured from stdout before `OUTPUT_LIMIT_EXCEEDED`).
- **STDIO Judge**: The new branch inside `judge.service.runJudge` that handles
  STDIO problems. Not a new entry point; the async submit pipeline dispatches
  to it based on `problem.type`.
- **Runtime Mode**: The `JUDGE_RUNTIME_MODE` env from ADR 0014, one of
  `auto | local | docker | off`. The STDIO Judge honours it identically to the
  polyglot function judge.
- **Language Allowlist**: The per-problem set of languages a student may
  submit in. A non-empty subset of `{ JAVASCRIPT, PYTHON, JAVA, GO, CPP }`
  (see Requirement 13 for CPP scoping).
- **Run Flow**: The non-persisted `POST /api/submissions/:slug/run` flow used
  on the problem detail page. The student enters a custom `stdin`, the server
  executes the program against that stdin only, captures stdout and stderr,
  and returns them without writing a submission row. Mirrors the existing
  SQL Run flow.
- **Submit Flow**: The persisted `POST /api/submissions/:slug` flow that
  enqueues a judge job and returns HTTP 202 with a PENDING submission row,
  exactly as in ADR 0013.
- **Exam Attempt**: Existing `exam_attempts` row (ADR 0009); STDIO
  submissions inside an exam carry `exam_attempt_id` the same way
  function-style submissions do.
- **Problem_Editor_UI**: The existing `ProblemForm` React component at
  `Frontend/Frontend/app/components/teach/ProblemForm.tsx` (ADR 0011). This
  spec extends it with a new STDIO branch.

## Requirements

### Requirement 1: STDIO problem-type discriminator and schema

**User Story:** As a platform developer, I want STDIO problems to live under a
dedicated `problems.type` value with their own metadata columns, so that
existing queries, editor payloads, and judge dispatch stay readable and
backwards-compatible.

#### Acceptance Criteria

1. THE Migrations_Runner SHALL apply a forward-only migration at
   `db/migrations/0008_stdio_problems.sql` that widens the CHECK constraint
   on `problems.type` to include `STDIO` and adds the STDIO-specific columns
   `time_limit_ms INTEGER`, `memory_limit_mb INTEGER`,
   `output_size_cap_kb INTEGER`, `comparator_mode TEXT`, and
   `language_allowlist TEXT[]`.
2. THE Problems_Module SHALL keep all existing `problems.type` values
   (`ALGORITHM`, `BACKEND`, `FRONTEND`, `SQL`) valid and unchanged.
3. WHEN a problem row has `type = 'STDIO'`, THE Problems_Queries SHALL
   require `test_cases_json` to be a non-empty JSON array of objects with
   the fields `stdin: string`, `expected_stdout: string`, and
   `visibility: 'SAMPLE' | 'HIDDEN'`, enforced by the editor schema and
   asserted again in the service before persistence.
4. WHEN a problem row has `type = 'STDIO'`, THE Problems_Queries SHALL
   require `test_cases_json` to contain at least one entry with
   `visibility = 'SAMPLE'`.
5. IF a problem row has `type != 'STDIO'`, THEN THE Problems_Module SHALL
   ignore the STDIO-specific columns and leave existing non-STDIO semantics
   unchanged.
6. THE Problems_Module SHALL apply its generic non-STDIO-specific handling
   (delete-usage checks, audit-log writes, gradebook scoring, attachment to
   courses and exams, and every other type-agnostic flow) to STDIO problems
   on the same terms as function-style and SQL problems, so that STDIO does
   not carve out a parallel codepath for shared problem-management logic.
7. THE Problems_Queries SHALL NOT introduce any `tenant_id` column or other
   multi-tenant field on the new migration.

### Requirement 2: Per-problem limits with documented defaults

**User Story:** As an instructor, I want per-problem CPU wall-clock, memory,
and output-size limits with sensible defaults, so that I can author STDIO
problems without memorising tuning constants.

#### Acceptance Criteria

1. WHEN an STDIO problem is created through `POST /api/problems` without an
   explicit `timeLimitMs`, THE Problems_Service SHALL default
   `timeLimitMs = 2000`.
2. WHEN an STDIO problem is created through `POST /api/problems` without an
   explicit `memoryLimitMb`, THE Problems_Service SHALL default
   `memoryLimitMb = 256`.
3. WHEN an STDIO problem is created through `POST /api/problems` without an
   explicit `outputSizeCapKb`, THE Problems_Service SHALL default
   `outputSizeCapKb = 64`.
4. IF `timeLimitMs` is not in the closed range `[100, 10000]`, THEN THE
   Problems_Service SHALL reject the request with HTTP 400.
5. IF `memoryLimitMb` is not in the closed range `[16, 512]`, THEN THE
   Problems_Service SHALL reject the request with HTTP 400.
6. IF `outputSizeCapKb` is not in the closed range `[1, 1024]`, THEN THE
   Problems_Service SHALL reject the request with HTTP 400.
7. WHEN an STDIO problem is created without an explicit `comparatorMode`,
   THE Problems_Service SHALL default `comparatorMode = 'TRIMMED'`.

### Requirement 3: Instructor authors an STDIO problem via ProblemForm

**User Story:** As an instructor, I want to create and edit STDIO problems
through the existing `/teach/problems/new` and `/teach/problems/:slug/edit`
UI, so that I can set up Intro and Advanced Programming exercises without
writing SQL by hand.

#### Acceptance Criteria

1. THE Problem_Editor_UI SHALL render a dedicated STDIO branch inside
   `ProblemForm` alongside the existing ALGORITHM / SQL / BACKEND / FRONTEND
   branches, selected when the author picks `type = 'STDIO'`.
2. THE STDIO branch of Problem_Editor_UI SHALL render `stdin` and
   `expected_stdout` as paired multi-line `<textarea>` inputs per test case,
   a `visibility` toggle (`SAMPLE` / `HIDDEN`) per test case, and controls
   for `timeLimitMs`, `memoryLimitMb`, `outputSizeCapKb`, `comparatorMode`,
   and `languageAllowlist`.
3. WHEN an INSTRUCTOR or ADMIN submits `POST /api/problems` with
   `type = 'STDIO'`, a non-empty `testCases` array containing at least one
   `SAMPLE` case, a `comparatorMode` in
   `{ EXACT, TRIMMED, WHITESPACE_NORMALIZED }`, and a `languageAllowlist`
   that is a non-empty subset of `{ JAVASCRIPT, PYTHON, JAVA, GO, CPP }`,
   THE Problems_Service SHALL create the problem and return HTTP 201 with
   the public problem shape.
4. IF a `POST /api/problems` request has `type = 'STDIO'` but is missing
   any of `testCases`, `comparatorMode`, or `languageAllowlist`, THEN THE
   Problems_Service SHALL reject the request with HTTP 400 and a field-level
   validation error naming the missing field.
5. WHEN an INSTRUCTOR or ADMIN requests `GET /api/problems/:slug/edit` for
   an STDIO problem, THE Problems_Routes SHALL return the full editor
   payload including `testCases` (with `visibility`), `timeLimitMs`,
   `memoryLimitMb`, `outputSizeCapKb`, `comparatorMode`, and
   `languageAllowlist`.
6. WHEN any authenticated user requests `GET /api/problems/:slug` for an
   STDIO problem, THE Problems_Routes SHALL return the public shape
   including every `SAMPLE` test case's `stdin` and `expected_stdout`,
   the per-problem limits, `comparatorMode`, and `languageAllowlist`, and
   SHALL NOT include any `HIDDEN` test case's `stdin` or `expected_stdout`.

### Requirement 4: Student Run flow (non-persisted) on the problem page

**User Story:** As a student, I want an stdin panel and an stdout panel on
the STDIO problem page so that I can execute my program against a custom
input I typed in, without submitting for grading.

#### Acceptance Criteria

1. WHEN an authenticated student opens `/problems/:slug` for an STDIO
   problem, THE Problem_Detail_UI SHALL render a full-program editor plus
   an `stdin` input panel and an `stdout` output panel, analogous to the
   existing SQL Run flow.
2. WHEN an authenticated student triggers the Run action, THE
   Submissions_Routes SHALL accept `POST /api/submissions/:slug/run` with
   body `{ language, code, stdin }` and SHALL respond synchronously with
   `{ stdout, stderr, verdict, timeMs, memoryMb, timedOut }`.
3. THE Submissions_Service SHALL NOT write a row to the `submissions` table
   for any Run-flow request, matching the behaviour of the existing
   function-style and SQL Run flows.
4. WHEN the Run flow executes the student program, THE STDIO_Judge SHALL
   enforce the same per-problem `timeLimitMs`, `memoryLimitMb`, and
   `outputSizeCapKb` as the Submit flow.
5. IF the Run flow's `stdin` body exceeds the per-problem `inputSizeCapKb`
   or 1 MB (whichever is smaller), THEN THE Submissions_Routes SHALL
   reject the request with HTTP 413.
6. IF a student submits a Run request in a language not in the problem's
   `languageAllowlist`, THEN THE Submissions_Routes SHALL reject the
   request with HTTP 400 and an error code `LANGUAGE_NOT_ALLOWED`.

### Requirement 5: Student Submit flow through the async judge pipeline

**User Story:** As a student, I want to submit a full STDIO program through
the existing Submit flow and see per-test verdicts, so that my submissions
roll up into my history and (when inside an exam) into my attempt score.

#### Acceptance Criteria

1. WHEN an authenticated student submits a program via
   `POST /api/submissions/:slug` for an STDIO problem with a language in
   the problem's `languageAllowlist`, THE Submissions_Service SHALL insert
   a PENDING row, enqueue a judge job, and return HTTP 202 with the row,
   following ADR 0013.
2. IF a student submits to an STDIO problem with a language not in the
   problem's `languageAllowlist`, THEN THE Submissions_Service SHALL
   reject the request with HTTP 400 and an error code
   `LANGUAGE_NOT_ALLOWED` before any row is inserted.
3. WHEN an STDIO submission finalizes, THE Submissions_Service SHALL
   persist a `per_test_results` JSON array on the submission row
   containing, for each test case in declared order, an object with fields
   `index`, `verdict`, `time_ms`, `memory_mb`, `stdout_bytes`,
   `visibility`, and a bounded `stderr_tail` no larger than 4 KB.
4. WHEN an STDIO submission retry arrives with the same `Idempotency-Key`
   by the same user, THE Submissions_Service SHALL return the existing
   row and SHALL NOT enqueue a second judge job, matching ADR 0013.
5. THE Problem_Detail_UI SHALL render each per-test result in order with
   its verdict, time, and memory; for failed `SAMPLE` cases the UI SHALL
   additionally render the Actual Output and a diff against the Expected
   Stdout.
6. THE Problem_Detail_UI SHALL NOT render `stdin`, `expected_stdout`, or
   Actual Output for any test case with `visibility = 'HIDDEN'`, regardless
   of the per-test verdict.

### Requirement 6: Per-test-case resource limits and verdicts

**User Story:** As an instructor, I want per-test-case time, memory, and
output-size limits to be enforced with specific verdicts, so that infinite
loops, memory bombs, and runaway output are caught deterministically with
clear student feedback.

#### Acceptance Criteria

1. WHEN the STDIO_Judge runs a single test case, THE STDIO_Judge SHALL
   enforce the problem's `time_limit_ms` as a wall-clock ceiling, the
   problem's `memory_limit_mb` as a peak-RSS ceiling, and the problem's
   `output_size_cap_kb` as a hard cap on bytes captured from stdout.
2. IF the student program exceeds the time limit on a test case, THEN THE
   STDIO_Judge SHALL record a per-test verdict of `TIME_LIMIT_EXCEEDED`
   and SHALL terminate the process within `1.5 * time_limit_ms` of
   wall-clock elapsed.
3. IF the student program exceeds the memory limit on a test case, THEN
   THE STDIO_Judge SHALL record a per-test verdict of
   `MEMORY_LIMIT_EXCEEDED` and SHALL terminate the process before peak
   RSS exceeds `1.5 * memory_limit_mb`.
4. IF the student program writes more than `output_size_cap_kb` KB to
   stdout, THEN THE STDIO_Judge SHALL stop capturing further stdout,
   record a per-test verdict of `OUTPUT_LIMIT_EXCEEDED`, and terminate
   the process.
5. IF compilation of a compiled language (`CPP`, `JAVA`, `GO`) fails,
   THEN THE STDIO_Judge SHALL record an overall verdict of
   `COMPILE_ERROR`, SHALL NOT run any test case, and SHALL include a
   bounded compiler diagnostic no larger than 8 KB on the submission row.
6. IF the student program exits with a non-zero status or is terminated
   by a signal other than the judge's own kill signal, THEN THE
   STDIO_Judge SHALL record a per-test verdict of `RUNTIME_ERROR` with a
   bounded `stderr_tail` no larger than 4 KB.
7. WHEN a test case produces correct output under the configured
   comparator mode AND the student program stays within every
   per-submission limit, THE STDIO_Judge SHALL record a per-test verdict
   of `ACCEPTED`.

### Requirement 7: Overall verdict aggregation (contest semantics)

**User Story:** As an instructor, I want the submission-level verdict to be
the first failing per-test verdict, so that the grading semantics match
standard contest conventions (Codeforces / Kattis / ACM-ICPC).

#### Acceptance Criteria

1. WHEN every per-test verdict of an STDIO submission is `ACCEPTED`, THE
   STDIO_Judge SHALL record an overall verdict of `ACCEPTED`.
2. WHEN at least one per-test verdict of an STDIO submission is not
   `ACCEPTED`, THE STDIO_Judge SHALL record an overall verdict equal to
   the per-test verdict of the first failing test case in the problem's
   declared test-case order.
3. THE STDIO_Judge SHALL iterate test cases in their declared order and
   SHALL NOT reorder, shuffle, or parallelise them, so that the
   first-failure contract is deterministic.

### Requirement 8: Comparator modes for output comparison

**User Story:** As an instructor, I want to pick a comparator mode per
problem, so that a trailing newline does not fail a correct solution when I
choose a forgiving mode and byte-exact grading is available when I need it.

#### Acceptance Criteria

1. WHEN a problem's `comparator_mode` is `EXACT`, THE STDIO_Judge SHALL
   compare Actual Output and Expected Stdout byte-for-byte without any
   normalization.
2. WHEN a problem's `comparator_mode` is `TRIMMED`, THE STDIO_Judge SHALL
   compare Actual Output and Expected Stdout after stripping a single
   optional trailing `\n` or `\r\n` from each side.
3. WHEN a problem's `comparator_mode` is `WHITESPACE_NORMALIZED`, THE
   STDIO_Judge SHALL compare Actual Output and Expected Stdout after
   collapsing every maximal run of ASCII whitespace into a single space
   and trimming leading and trailing ASCII whitespace on each side.
4. IF Actual Output differs from Expected Stdout under the configured
   comparator mode, THEN THE STDIO_Judge SHALL record a per-test verdict
   of `WRONG_ANSWER`.
5. THE STDIO_Output_Comparator SHALL be a pure function
   `compare(mode, actual, expected) -> boolean` and SHALL NOT depend on
   process state, file I/O, or the clock.

### Requirement 9: Runtime mode switching (local vs docker vs off)

**User Story:** As an on-prem operator, I want STDIO submissions to honour
the same `JUDGE_RUNTIME_MODE` switch as the polyglot function judge, so
that STDIO and function-style problems share a single runtime policy.

#### Acceptance Criteria

1. WHERE `JUDGE_RUNTIME_MODE` is `local`, THE STDIO_Judge SHALL execute
   each test case as a non-privileged subprocess of the Node server
   against the locally-installed runtime (`node`, `python3`, `javac` +
   `java`, `go`, `g++`).
2. WHERE `JUDGE_RUNTIME_MODE` is `docker`, THE STDIO_Judge SHALL execute
   each test case inside an ephemeral container built from the same
   image set ADR 0014 already uses for the polyglot function judge
   (extended with a `g++` image entry for CPP).
3. WHERE `JUDGE_RUNTIME_MODE` is `auto`, THE STDIO_Judge SHALL prefer
   `docker` when the Docker daemon is reachable and fall back to `local`
   otherwise, matching the polyglot function judge's auto-selection
   behaviour.
4. WHERE `JUDGE_RUNTIME_MODE` is `off`, THE STDIO_Judge SHALL record an
   overall verdict of `JUDGE_ERROR` with a human-readable reason
   indicating STDIO judging is disabled, and SHALL NOT invoke any
   subprocess or container.
5. WHERE `JUDGE_RUNTIME_MODE` is `docker`, THE STDIO_Judge SHALL launch
   each container with `--network=none` so that the student program
   cannot open TCP or UDP sockets to any destination.
6. IF a container fails to start, crashes before completing, or is
   terminated by the orchestrator for reasons unrelated to the student
   program, THEN THE STDIO_Judge SHALL record a per-test verdict of
   `JUDGE_ERROR` for the affected test case.

### Requirement 10: Integration with the async judge pipeline

**User Story:** As a platform developer, I want STDIO judging to be a new
branch inside `judge.service.runJudge`, so that the async submit pipeline,
idempotency, polling, and the exam-attempt wiring all work unchanged.

#### Acceptance Criteria

1. WHEN `runJudge(problem, code, language)` is called with `problem.type`
   equal to `STDIO`, THE Judge_Service SHALL dispatch the call to a new
   `runStdioJudge` function and SHALL NOT invoke the function-style or SQL
   judge branches.
2. WHEN `runJudge(problem, code, language)` is called with `problem.type`
   in {`ALGORITHM`, `BACKEND`, `FRONTEND`, `SQL`}, THE Judge_Service SHALL
   return the same verdict value, per-test result list, and error
   indication that the existing assertions in `judge.test.mjs`,
   `judge-isolation.test.mjs`, and `judge-polyglot.test.mjs` expect, such
   that those test files pass without modification.
3. THE Submissions_Service SHALL route STDIO Submit-flow judging through
   the same `submit() -> enqueue -> finalize()` two-phase flow defined in
   ADR 0013, and THE Submissions_Routes SHALL expose no STDIO-specific
   HTTP entry point in addition to the existing submit and polling routes.
4. THE Queue_Module SHALL accept and dispatch STDIO judge jobs in both
   `inline` and `bullmq` modes using the same job payload structure and
   worker processor contract as function-style jobs, such that introducing
   STDIO requires no queue-schema or job-name change.
5. WHEN `GET /api/submissions/:id` is called for an STDIO submission after
   the worker has finalized it, THE Submissions_Routes SHALL return a JSON
   response containing `status`, `verdict`, and `per_test_results` using
   the same field names and value shape as for a finalized function-style
   submission.
6. WHILE an STDIO submission is still in the PENDING state, WHEN
   `GET /api/submissions/:id` is called by its owner, THE Submissions_Routes
   SHALL return a response with `status = PENDING`, SHALL omit or nullify
   `verdict` and `per_test_results`, and SHALL use the same response shape
   as a PENDING function-style submission.
7. IF `runStdioJudge` raises an unhandled error during `finalize()`, THEN
   THE Submissions_Service SHALL set the submission `status` to
   `JUDGE_ERROR`, SHALL populate `finished_at`, and SHALL leave the
   `problems` counters and `users.rating` values unchanged from their
   pre-submission state.

### Requirement 11: Integration with exam filtering on the public recent feed

**User Story:** As a student browsing the public recent feed, I want to not
see in-exam STDIO submissions, so that the feed cannot spoil answers during
a live exam, consistent with ADR 0009.

#### Acceptance Criteria

1. WHEN an authenticated student submits an STDIO problem through
   `POST /api/courses/:courseSlug/exams/:examSlug/attempts/current/submissions/:problemSlug`,
   THE Exams_Service SHALL enqueue the submission with `exam_attempt_id`
   set to the current attempt and return HTTP 202.
2. THE Submissions_Queries SHALL continue to exclude every row where
   `exam_attempt_id IS NOT NULL` from `GET /api/submissions/recent`,
   regardless of problem type.
3. WHEN an exam attempt's `describeAttempt` view is requested, THE
   Exams_Service SHALL include STDIO submissions in the same shape as
   function-style and SQL submissions, with the top-level `verdict`
   being the overall verdict and per-test details available on the
   submission row.
4. WHILE a student has an active, unfinished exam attempt, THE
   Exam_Workspace_UI SHALL render STDIO problems with the same
   full-program editor and per-test results view used on
   `/problems/:slug`, including the stdin and stdout Run panels.

### Requirement 12: Existing function-style and SQL behaviour stays unchanged

**User Story:** As a platform maintainer, I want all existing function-style
(JS/TS/Python/Java/Go) and SQL problems and their tests to keep passing
unchanged, so that STDIO is strictly additive.

#### Acceptance Criteria

1. THE Problems_Service SHALL reject any attempt to change an existing
   problem's `type` from a non-STDIO value to `STDIO` (or vice versa)
   via `PUT /api/problems/:slug` with HTTP 400 and an error code
   `TYPE_CHANGE_NOT_ALLOWED`.
2. THE Problem_Detail_UI SHALL render function-style problems with the
   existing function-harness editor and render SQL problems with the
   existing SQL editor, with no change triggered by the STDIO feature.
3. WHEN the full `npm test` suite is run after this feature ships, THE
   Test_Suite SHALL keep every pre-existing assertion green (judge,
   isolation, polyglot, auth, submissions, exams, gradebook,
   problem-creator, audit-log, async-judge, seed-backend, seed-frontend,
   seed-sql).
4. THE Judge_Service SHALL continue to route JavaScript and TypeScript
   function-style submissions through `isolated-vm` and SQL submissions
   through the existing SQLite judge, unaffected by the new STDIO
   branch.

### Requirement 13: C++ as a new runtime addition

**User Story:** As an Intro-to-Programming instructor, I want C++ to be
available on STDIO problems day one, because it is the canonical language
my course uses, and I want its runtime integration to be called out so a
future maintainer can scope it to a follow-up without surprise.

#### Acceptance Criteria

1. THE STDIO_Judge SHALL support `CPP` in `local` mode by compiling the
   submitted source with `g++ -O2 -std=c++17 -pipe -o prog` and executing
   the resulting binary per test case.
2. THE STDIO_Judge SHALL support `CPP` in `docker` mode by executing the
   compile and run steps inside the same `g++` image entry the runtime
   layer uses for polyglot builds.
3. WHERE `CPP` is listed in a problem's `languageAllowlist` AND neither
   a local `g++` nor the `g++` runtime image is available, THE
   STDIO_Judge SHALL record an overall verdict of `JUDGE_ERROR` with a
   reason indicating the C++ runtime is not installed, and SHALL NOT
   attempt any other language.
4. IF integrating `CPP` blocks the MVP beyond the spec's planned scope,
   THEN THE Scoping_Decision SHALL be to ship JavaScript / Python /
   Java / Go as v1 and to file a follow-up spec for `CPP`; any follow-up
   SHALL be tracked explicitly in the tasks document rather than left
   implicit.

### Requirement 14: Seed catalog for STDIO

**User Story:** As an operator setting up a new installation, I want the
seed catalog to include ready-to-run STDIO problems, so that AITU
instructors can demo the pipeline end-to-end immediately after install.

#### Acceptance Criteria

1. THE Seed_Module SHALL include at least two Intro-level STDIO problems
   with deterministic reference solutions, one of which SHALL be a
   "sum of N integers" problem and another SHALL be a "FizzBuzz" problem
   (or semantically equivalent slugs).
2. THE Seed_Module SHALL include at least one Advanced-level STDIO
   problem with a deterministic reference solution, such as "sort a list
   of records by a numeric key with stable order on ties".
3. WHEN the seeded reference solution for each seeded STDIO problem is
   submitted in each language on that problem's `languageAllowlist`,
   THE STDIO_Judge SHALL return an overall verdict of `ACCEPTED`,
   asserted by a new `test/seed-stdio.test.mjs` suite.
4. THE Seed_Module SHALL NOT modify, remove, or relocate any existing
   seed problem; the new STDIO problems SHALL be additive only.

## Correctness Properties (Executable PBT Candidates)

The following properties map the user's PBT hooks onto the EARS requirements
above. They are intended to be encoded as property-based tests in new
`test/judge-stdio-properties.test.mjs` and `test/stdio-comparator.test.mjs`
suites, and each one should be mechanically checkable.

1. **Determinism of verdict.** For all STDIO problems `p`, programs `c`,
   languages `l ∈ p.language_allowlist`, and idempotency-key-free
   submissions, submitting `(p, c, l)` twice as the same user yields the
   same overall verdict, up to a documented flake tolerance on
   `TIME_LIMIT_EXCEEDED`. (Requirement 5, Requirement 7.)
2. **Isolation across parallel submits.** For all STDIO problems `p`,
   programs `c`, and languages `l ∈ p.language_allowlist`, two submissions
   of the same `(p, c, l)` run concurrently yield the same overall verdict
   as either one run alone. (Requirement 10.)
3. **Timeout monotonicity.** For all STDIO problems `p` and programs `c`
   such that submitting `(p, c)` with `time_limit_ms = T` yields
   `ACCEPTED`, submitting the same `(p, c)` against a sibling problem
   with `time_limit_ms = 2 * T` also yields `ACCEPTED`. (Requirement 6.2.)
4. **Comparator sanity under EXACT.** For all `expected`, the Actual Output
   `expected + "\n"` compared against `expected` under `EXACT` yields
   `WRONG_ANSWER`. (Requirement 8.1.)
5. **Comparator sanity under TRIMMED.** For all `expected`, the Actual
   Output `expected + "\n"` compared against `expected` under `TRIMMED`
   yields `ACCEPTED`. (Requirement 8.2.)
6. **Output-limit determinism.** For all STDIO problems `p` with
   `output_size_cap_kb = C`, any student program that writes strictly
   more than `C` KB to stdout receives a per-test verdict of
   `OUTPUT_LIMIT_EXCEEDED` on every run, and the overall verdict on a
   single-test-case problem equals `OUTPUT_LIMIT_EXCEEDED`. (Requirement 6.4.)
7. **First-failure aggregation.** For all STDIO submissions whose per-test
   results are `R = [r_1, …, r_n]`, the persisted overall verdict equals
   `r_i.verdict` where `i` is the smallest index with
   `r_i.verdict != 'ACCEPTED'`, or `ACCEPTED` if no such `i` exists.
   (Requirement 7.)
8. **Comparator idempotence.** For all strings `s` and comparator modes
   `m`, `compare(m, s, s)` is `true`. (Requirement 8.5.)
9. **Exam filter across problem types.** For all pairs of submissions
   `(s_public, s_exam)` where `s_exam.exam_attempt_id IS NOT NULL`,
   `GET /api/submissions/recent` contains `s_public` and does not contain
   `s_exam`, independent of problem type. (Requirement 11.2.)
10. **STDIO does not regress function-style or SQL verdicts.** For a fixed
    corpus of function-style and SQL seed submissions with known verdicts,
    running them through `runJudge` on this branch yields the same
    verdicts as on the baseline. (Requirement 12.3.)

## Non-Goals

The following are explicitly out of scope for this spec and will be
addressed, if at all, in separate specs:

- **Interactive problems** where the judge and the student program exchange
  messages turn-by-turn. Single-shot `stdin → program → stdout` is the only
  supported shape.
- **Custom checkers (SPJ / special judges).** Output comparison is limited
  to `EXACT`, `TRIMMED`, and `WHITESPACE_NORMALIZED`. Problem-specific
  checker scripts (e.g., "any valid topological order") are deferred.
- **Floating-point tolerance (`FLOAT` comparator mode).** Useful for numeric
  Advanced Programming problems, but the interface and PBT contract add
  non-trivial surface area. Documented here as a follow-up spec.
- **Multi-file submissions.** The student provides a single source file per
  submission. Projects with multiple files, header includes with relative
  paths, or build-system configuration are out of scope.
- **TypeScript for STDIO.** TypeScript stays function-style only; Node
  JavaScript is the only JS flavour accepted for STDIO on day one.
- **Per-language per-problem resource multipliers** (e.g., Java gets
  `2 * time_limit_ms`). Day one uses a single `time_limit_ms` per problem.
- **Per-language memory limits enforced via cgroups.** Day-one memory
  enforcement is best-effort peak-RSS monitoring from the judge process.
  Strict cgroups-backed memory quarantines are a separate hardening spec
  tracked with the Docker-per-submission isolation work.
- **Docker-per-submission hardening (PID limits, read-only root, seccomp
  profile).** `--network=none` is the only container hardening committed
  to in this spec; stronger sandboxing is a separate spec aligned with
  the Phase 2 Docker-per-submission item in the roadmap.
- **Author-uploaded binary test-case fixtures.** Test cases stay as inline
  `stdin` / `expected_stdout` strings in `test_cases_json`; object-storage
  fixtures are a later spec.
- **Contests, rating-formula changes, and live leaderboards.** Rating
  continues to bump on first-solve exactly as for other problem types; no
  new rating pathway is introduced.
- **Proctoring, anti-cheat, and plagiarism integration.** Those belong to
  the Phase 2 pilot-revenue track.
