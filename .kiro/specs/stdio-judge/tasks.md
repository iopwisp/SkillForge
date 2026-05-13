# Implementation Plan

> Feature: `stdio-judge`
> Requirements doc: `.kiro/specs/stdio-judge/requirements.md`
> Design doc: `.kiro/specs/stdio-judge/design.md`
>
> Execution convention:
> - Every task ends with `npm run lint` + `npm test` green in `Backend/`.
> - Every task that touches the frontend also ends with `npm run typecheck`
>   + `npm run build` green in `Frontend/Frontend/`.
> - Task IDs map to PR titles (`feat(stdio-judge): <task-title>`).
> - Each task references the Requirements (R-N) and Properties (P-N) it
>   satisfies so the reviewer can pin the contract.
> - PBT tasks use fast-check with ≥100 iterations; header comment must
>   read `// Feature: stdio-judge, Property N: <text>`.

## 1. Foundation: database schema

- [x] 1.1 Write forward-only migration `0008_stdio_problems.sql`
  - Add `STDIO` to `problems.problem_type` CHECK constraint.
  - Add nullable columns `output_size_cap_kb INTEGER`, `comparator_mode TEXT`,
    `language_allowlist TEXT[]`.
  - Add conditional CHECK constraints gated on `problem_type = 'STDIO'`
    for `time_limit_ms ∈ [100, 10000]`, `memory_limit_mb ∈ [16, 512]`,
    `output_size_cap_kb ∈ [1, 1024]`,
    `comparator_mode ∈ {EXACT, TRIMMED, WHITESPACE_NORMALIZED}`,
    `array_length(language_allowlist, 1) >= 1`.
  - Run migration locally against `skillforge_test`, verify non-STDIO
    rows unaffected.
  - _Requirements: R1.1, R1.2, R1.5, R1.7_

## 2. Pure layer: comparator

- [x] 2.1 Implement `modules/judge/stdio-comparator.js`
  - Pure `compareStdio(mode, actual, expected) -> boolean`.
  - Cases: `EXACT` byte-for-byte, `TRIMMED` strips one optional trailing
    `\n`/`\r\n` on each side, `WHITESPACE_NORMALIZED` collapses ASCII
    whitespace runs and trims ends.
  - No imports from `fs`, `child_process`, or any module outside pure
    string helpers.
  - _Requirements: R8.1, R8.2, R8.3, R8.5_

- [x] 2.2 Property tests `test/stdio-comparator.test.mjs`
  - P8: three-branch specification equivalence against hand-written
    reference implementations (fast-check over arbitrary strings).
  - P9: reflexivity `compareStdio(mode, s, s) === true` for every mode.
  - Register in `package.json` test runner.
  - _Validates: P8, P9 (design.md §Correctness Properties)_

## 3. Per-language prepare layer

- [x] 3.1 Implement `modules/judge/stdio-prepare.js` for Node, Python, Java, Go
  - Export `prepare(language, problem, code, tmpdir)` returning
    `{ status: 'READY' | 'COMPILE_ERROR', run: { cmd, args, workdir }, diagnostic? }`.
  - Branches: JAVASCRIPT (`node prog.js`), PYTHON (`python3 prog.py`),
    JAVA (`javac Main.java` then `java -cp . Main`), GO (`go build -o prog prog.go`).
  - Caller is responsible for cleanup; prepare never leaks handles.
  - Truncate compile diagnostic to 8 KB with a truncation marker.
  - _Requirements: R6.5, R9.1_

- [x] 3.2 Extend `prepare` with CPP branch
  - Local: `g++ -O2 -std=c++17 -pipe -o prog prog.cpp`.
  - Docker: identical compile inside the CPP image under
    `--network=none --read-only --tmpfs=/tmp`.
  - Compile ONCE per submission, reuse binary across every test case.
  - If neither local `g++` nor the configured CPP Docker image is
    available, return `UNAVAILABLE` sentinel; caller maps it to overall
    `JUDGE_ERROR` with reason "C++ runtime is not installed".
  - _Requirements: R13.1, R13.2, R13.3_

## 4. Execution layer

- [x] 4.1 Implement `modules/judge/stdio-exec.js#execOneTest`
  - Spawn child process with `runStep.cmd` + `runStep.args`, pipe
    `stdin`, capture stdout up to `output_size_cap_kb * 1024` bytes,
    tail stderr at 4 KB.
  - Kill on wall-clock overshoot (SIGKILL before `1.5 * time_limit_ms`).
  - Poll `process.resourceUsage().maxRSS` at ≤20 ms cadence; SIGKILL
    if peak > `memory_limit_mb`.
  - Stop capturing + SIGKILL when stdout byte counter exceeds cap.
  - Return `{ stdout, stderr, timeMs, memoryMb, exit, signal, killedReason }`
    where `killedReason ∈ { null, 'TLE', 'MLE', 'OLE' }`.
  - _Requirements: R6.1, R6.2, R6.3, R6.4, R6.6_

- [x] 4.2 Implement `classify({ exec, tc, comparatorMode, limits, index })`
  - Precedence: `OLE > TLE > MLE > RE > WRONG_ANSWER > ACCEPTED`.
  - Consumes `compareStdio` only when no limit / runtime flag flipped.
  - Emits `{ index, verdict, time_ms, memory_mb, stdout_bytes,
    visibility, stderr_tail, actual_output? }` with `actual_output`
    only for `WRONG_ANSWER` + `SAMPLE`.
  - _Requirements: R6.7, R8.4_

- [x] 4.3 Implement `runStdioJudge(problem, code, language)`
  - Calls `prepare`, short-circuits on `COMPILE_ERROR` / `UNAVAILABLE`.
  - Iterates test cases in declared order. Stops on first non-ACCEPTED
    per-test (contest semantics).
  - Returns `{ status, runtimeMs, memoryKb, testsPassed, testsTotal, output, error, beats }`
    where `output` is `JSON.stringify({ perTestResults })`.
  - _Requirements: R7.1, R7.2, R7.3, R10.1_

- [x] 4.4 Implement `runStdioOnce(problem, code, language, stdin)` for Run flow
  - Single execution, no iteration, no persistence.
  - Returns `{ stdout, stderr, verdict, timeMs, memoryMb, timedOut }`.
  - _Requirements: R4.2, R4.4_

- [x] 4.5 Property tests `test/judge-stdio-properties.test.mjs` with mocked exec
  - P6: classifier precedence and comparator gating.
  - P7: compile-error short-circuit and bounded diagnostic.
  - P10: first-failure aggregation.
  - _Validates: P6, P7, P10_

## 5. Judge dispatcher branch

- [x] 5.1 Wire `runStdioJudge` / `runStdioOnce` into `judge/service.js`
  - Dispatch on `problem.problem_type === 'STDIO'` only; other types
    untouched.
  - Accept optional `{ kind: 'run', stdin }` fourth argument; preserve
    existing signature for non-STDIO callers.
  - _Requirements: R10.1, R10.2, R12.4_

- [x] 5.2 Regression run: `judge.test.mjs` + `judge-isolation.test.mjs` + `judge-polyglot.test.mjs`
  - Must pass WITHOUT modification.
  - If any assertion flips, revert the dispatch change and re-plan.
  - _Requirements: R12.3_

- [x] 5.3 Property test: `runJudge` dispatch invariant
  - P11: STDIO type goes to `runStdioJudge` exactly once; other types
    go to the baseline branch with identical outputs.
  - Add to `test/judge-stdio-properties.test.mjs`.
  - _Validates: P11_

## 6. Runtime-mode switch

- [x] 6.1 Extend `modules/judge/runtimes.js` with CPP entry
  - Add `cpp` to `LOCAL_COMMANDS` probe and `DOCKER_IMAGES`
    (default `gcc:13-bookworm`, env override `JUDGE_CPP_IMAGE`).
  - Reuse existing `resolveRuntime(language, mode)` signature.
  - _Requirements: R9.1, R9.2_

- [x] 6.2 Docker-mode step builder: `--network=none`, `--read-only`, `--tmpfs=/tmp`
  - All STDIO Docker invocations carry these flags verbatim; argv
    assertable by test.
  - `auto` mode probes Docker daemon per submission (matches polyglot
    judge); 2 s probe ceiling.
  - `off` mode short-circuits before any subprocess, returns overall
    `JUDGE_ERROR` with reason "STDIO judging is disabled".
  - _Requirements: R9.3, R9.4, R9.5_

- [x] 6.3 Integration test `test/judge-stdio-runtime.test.mjs`
  - Small deterministic cases (≤10) — one per runtime branch, one per
    per-test verdict flavour (TLE, MLE, OLE, RE, CE), one asserting the
    Docker argv contains `--network=none`.
  - Uses real subprocesses in local mode; Docker tests guarded behind
    a `docker info` probe (skip when unreachable).
  - _Requirements: R9.1–R9.6_

## 7. Problems module: authoring surface

- [x] 7.1 Extend `problems/schemas.js` with `STDIO` branch
  - `StdioCreateSchema`: `problemType = 'STDIO'`, `testCases` with
    `{ stdin, expected_stdout, visibility }`, `comparatorMode` enum,
    `languageAllowlist` subset of the five canonical languages,
    `timeLimitMs` / `memoryLimitMb` / `outputSizeCapKb` as integer
    ranges, at least one SAMPLE required.
  - `StdioUpdateSchema`: partial; type-change across STDIO boundary
    is rejected by the service, not the schema.
  - _Requirements: R1.3, R1.4, R3.3, R3.4_

- [x] 7.2 Update `problems/service.js`
  - Apply defaults when omitted (`timeLimitMs = 2000`, `memoryLimitMb = 256`,
    `outputSizeCapKb = 64`, `comparatorMode = 'TRIMMED'`).
  - Validate ranges; 400 on out-of-range with `HttpError` carrying
    field identifier.
  - Reject `type` transitions `STDIO ↔ non-STDIO` with 400 +
    `TYPE_CHANGE_NOT_ALLOWED`.
  - Audit-log write on create/update/delete same as other types.
  - _Requirements: R2.1–R2.7, R12.1_

- [x] 7.3 Public vs editor serialisers
  - `toPublicProblemDetail` includes every SAMPLE test case's
    `stdin` / `expected_stdout`, per-problem limits, comparator, allowlist.
    HIDDEN test cases MUST NOT appear.
  - `toEditorProblemDetail` returns every test case unredacted.
  - Centralise in `problems/service.js`; `routes.js` only calls one of
    the two.
  - _Requirements: R3.5, R3.6_

- [x] 7.4 Update `problems/queries.js` for new columns
  - Read/write `output_size_cap_kb`, `comparator_mode`, `language_allowlist`.
  - `test_cases_json` stays the same column; new element shape is
    enforced only at service layer.
  - _Requirements: R1.3, R1.5_

## 8. Submissions module: Submit and Run

- [x] 8.1 Extend `submissions/schemas.js`
  - Run-flow body accepts optional `stdin: string` (max 1 MB at schema
    level; per-problem cap enforced in service).
  - No change to Submit-flow body.
  - _Requirements: R4.2, R4.5_

- [x] 8.2 `submissions/service.js#submit` language-allowlist gate
  - Before `insertPending`, if `problem.problem_type === 'STDIO'`,
    reject 400 with `LANGUAGE_NOT_ALLOWED` when language ∉ allowlist.
  - NO row inserted on rejection.
  - _Requirements: R5.2_

- [x] 8.3 `submissions/service.js#run` STDIO branch
  - Reject 400 `LANGUAGE_NOT_ALLOWED` when language ∉ allowlist.
  - Reject 413 `STDIN_TOO_LARGE` when `stdin` bytes exceed
    `min(outputSizeCapKb * 1024, 1 MB)`.
  - Call `runJudge(problem, code, language, { kind: 'run', stdin })`.
  - NO `submissions` row written regardless of outcome.
  - _Requirements: R4.3, R4.5, R4.6_

- [x] 8.4 Polling / wire shape for STDIO submissions
  - `submissionToJson` unwraps `output` JSON for STDIO rows into
    `perTestResults`.
  - `HIDDEN` test cases emit `{ index, verdict, time_ms, memory_mb,
    visibility, stderr_tail }` only — never `stdin`, `expected_stdout`,
    `actual_output`.
  - Response shape identical to function-style submissions for `status`,
    `verdict`, polling states.
  - _Requirements: R5.3, R5.6, R10.5, R10.6_

- [x] 8.5 Idempotency and PENDING lifecycle unchanged
  - Verify existing `Idempotency-Key` path works for STDIO: replay
    returns 202 + existing row without enqueueing.
  - `JUDGE_ERROR` on unhandled judge exception; counters and rating
    left unchanged.
  - _Requirements: R5.4, R10.7_

## 9. Exam integration

- [x] 9.1 `exams/service.js` passthrough
  - In-exam STDIO submits propagate `exam_attempt_id` into
    `insertPending`; 202 returned per ADR 0013.
  - `describeAttempt` includes STDIO rows with overall verdict +
    per-test tail using the same serialiser as `/api/submissions/:id`.
  - _Requirements: R11.1, R11.3_

- [x] 9.2 Verify public recent-feed exclusion across types
  - No query change needed (`exam_attempt_id IS NULL` filter already
    global in `submissions/queries.js`); add explicit test asserting
    STDIO + exam rows are filtered.
  - _Requirements: R11.2_

## 10. Seed catalog

- [x] 10.1 New `shared/seed/stdio.js` with three problems
  - `stdio-sum-of-n`: read N then N integers, print their sum; limits
    default; `TRIMMED`; `SAMPLE` + 3 `HIDDEN` cases.
  - `stdio-fizzbuzz`: print FizzBuzz 1..N one per line; limits default;
    `TRIMMED`.
  - `stdio-stable-sort-by-key`: sort records by numeric key, preserve
    input order on ties; `WHITESPACE_NORMALIZED`; larger N in hidden
    cases to exercise TLE sensitivity.
  - Every problem ships reference solutions in every language on its
    `languageAllowlist`.
  - _Requirements: R14.1, R14.2, R14.4_

- [x] 10.2 Wire `stdio.js` into `shared/seed/index.js`
  - Additive only — existing seeds (algorithm/backend/frontend/sql)
    untouched.
  - _Requirements: R14.4_

- [x] 10.3 `test/seed-stdio.test.mjs`
  - Cross product: each seed STDIO problem × each language in its
    `languageAllowlist` → overall verdict `ACCEPTED`.
  - Runs in default CI runtime mode (`auto`); gated on local runtime
    availability per language.
  - _Requirements: R14.3_

## 11. Frontend: ProblemForm STDIO branch

- [x] 11.1 Extend `lib/teaching-types.ts`
  - `ProblemType` includes `'STDIO'`.
  - `StdioEditorProblem`, `StdioPublicProblem`, `StdioPerTestResult`
    types matching the wire shape defined in design.md.
  - _Requirements: R3.1_

- [x] 11.2 `ProblemForm.tsx` STDIO branch
  - `StdioPanel` component: repeating cards for each test case
    (stdin textarea, expected_stdout textarea, visibility toggle),
    limits inputs (time/memory/output with min/max inline validation),
    comparator radio group, language checkbox grid.
  - Client-side guardrails: reject submit when no test cases, no
    SAMPLE case, empty allowlist, or missing comparator.
  - `/teach/problems/new` and `/teach/problems/:slug/edit` render STDIO
    branch when `type === 'STDIO'`.
  - _Requirements: R3.1, R3.2, R3.4_

- [x] 11.3 Client pulls editor payload from protected `/edit` route
  - Unchanged wiring; ensure the STDIO branch consumes every field
    (`testCases` with visibility, limits, comparator, allowlist).
  - _Requirements: R3.5_

## 12. Frontend: student problem-detail view

- [x] 12.1 `routes/problem-detail.tsx` STDIO branch
  - Full-program Monaco editor + stdin textarea + read-only stdout
    panel; "Run" button calls `POST /api/submissions/:slug/run` with
    `stdin` and shows stdout/stderr/verdict/timeMs/memoryMb/timedOut.
  - "Submit" button keeps current async pipeline + idempotency key +
    polling.
  - _Requirements: R4.1, R4.2, R5.1_

- [x] 12.2 Per-test results renderer
  - Ordered list of per-test verdicts with time/memory badges.
  - SAMPLE failure cards expand to show Actual Output + line diff
    vs Expected Stdout (diff kept simple — line-by-line inequality
    markers, no external lib needed).
  - HIDDEN cases show verdict + metrics only. Never render stdin /
    expected_stdout / actual_output.
  - _Requirements: R5.5, R5.6_

- [x] 12.3 Exam workspace parity
  - `routes/exam.tsx` renders STDIO problems with the same editor,
    Run panels, and per-test results view.
  - No separate Exam-specific branch.
  - _Requirements: R11.4_

## 13. End-to-end integration tests

- [ ] 13.1 `test/integration-stdio.test.mjs` — authoring
  - P1: round-trip create + `/edit` equality (modulo server defaults).
  - P3: full range/enum/non-empty validation matrix.
  - P16: `TYPE_CHANGE_NOT_ALLOWED` for every cross-boundary transition.
  - _Validates: P1, P3, P16_

- [ ] 13.2 Integration tests — runtime and shape
  - P2: HIDDEN contents never escape public surfaces (fuzz problem
    shape, assert absence across `/problems/:slug` and
    `/submissions/:id` payloads).
  - P4: `LANGUAGE_NOT_ALLOWED` on both Submit and Run.
  - P5: `STDIN_TOO_LARGE` 413 before judge invocation.
  - P12: submit lifecycle shape invariant across types.
  - P15: Run flow never persists (row count invariant).
  - _Validates: P2, P4, P5, P12, P15_

- [ ] 13.3 Integration tests — exam + failure paths
  - P13: judge exception → `JUDGE_ERROR`, counters/rating unchanged.
  - P14: exam rows filtered from public recent feed across types.
  - P17: CPP runtime unavailable → overall `JUDGE_ERROR` with clear
    reason, no fallback.
  - P18: Docker container-start failure → per-test `JUDGE_ERROR`;
    overall surfaces `JUDGE_ERROR` when first-failure.
  - _Validates: P13, P14, P17, P18_

## 14. Documentation and ADR

- [ ] 14.1 New ADR `docs/decisions/0015-stdio-judge.md`
  - Summarises the design decisions from design.md §Key decisions.
  - Links to requirements.md and design.md.
  - Notes CPP as a new runtime addition with the follow-up escape
    hatch (R13.4).
  - _Requirements: R13.4_

- [ ] 14.2 Update `AGENTS.md` Phase section
  - Add stdio-judge row to the Phase 1.5 / Phase 2 table with commit
    hash placeholders.
  - Document the new env entries (`JUDGE_CPP_IMAGE`), seed slugs, and
    new test files under the "Daily verification commands" section.
  - _Requirements: none (housekeeping)_

- [ ] 14.3 Update `.env.example`
  - Document `JUDGE_CPP_IMAGE` (default `gcc:13-bookworm`).
  - Note that STDIO honours the existing `JUDGE_RUNTIME_MODE`.
  - _Requirements: R9.1–R9.5, R13.2_

## 15. Verification

- [ ] 15.1 Full `npm test` green
  - All pre-existing 437 checks stay green.
  - New suites present: `stdio-comparator`, `judge-stdio-properties`,
    `judge-stdio-runtime`, `seed-stdio`, `integration-stdio`.
  - _Requirements: R12.3_

- [ ] 15.2 Smoke test: 50 concurrent STDIO submits under `bullmq` mode
  - Adapt `test/smoke-bullmq.test.mjs` to submit STDIO instead of
    function-style (use `stdio-sum-of-n` seed, reference solution).
  - Verify all 202 → ACCEPTED, rating invariant unchanged, row-count
    exact.
  - _Requirements: R10.3, R10.4_

- [ ] 15.3 Frontend build + typecheck
  - `npm run typecheck` and `npm run build` green in `Frontend/Frontend/`.
  - Manual smoke: create STDIO problem via `/teach/problems/new`, open
    it on `/problems/:slug`, run against custom stdin, submit, observe
    per-test rendering.
  - _Requirements: R3.1, R3.2, R4.1, R5.5_
