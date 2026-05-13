# stdio-judge — Progress Report

**Last updated:** session pause
**Status:** 36/45 tasks complete (80%)
**Working tree:** all changes uncommitted
**Full `npm test` green:** yes, after every completed task

---

## How to resume

1. Open this file and read the "What's next" section below.
2. Run `npm test` in `Backend/` to confirm the baseline is still green.
3. Run `npm run typecheck && npm run build` in `Frontend/Frontend/` to confirm FE still green.
4. Tell Kiro: *"продолжи stdio-judge с task 13.1, autopilot, не спрашивай, после каждой задачи lint + npm test должны быть зелёными"*.

---

## What's done (36/45)

### Block 1 — Database (1/1)
- ✅ **1.1** Migration `0008_stdio_problems.sql` — adds `STDIO` to `problems.problem_type` CHECK, new columns `output_size_cap_kb`, `comparator_mode`, `language_allowlist`, and STDIO-gated range CHECKs. Applied to `skillforge_test`.
  - Known small drift: `problems_stdio_allowlist` CHECK allows NULL/empty allowlist through (Postgres `array_length` on empty returns NULL → CHECK passes). Application layer + zod gate closes this; fix is a two-line patch if you want DB-level defence-in-depth.

### Block 2 — Pure layer: comparator (2/2)
- ✅ **2.1** `modules/judge/stdio-comparator.js` — pure `compareStdio(mode, actual, expected)` + helpers `stripOneTrailingNewline`, `normalizeWs`. Zero imports.
- ✅ **2.2** `test/stdio-comparator.test.mjs` — fast-check PBT for P8 (three-branch spec) + P9 (reflexivity) + example-based edge cases. 12 tests pass.

### Block 3 — Prepare layer (2/2)
- ✅ **3.1** `modules/judge/stdio-prepare.js` — `prepare()` with branches for JAVASCRIPT, PYTHON, JAVA, GO. Compile step via `spawnSync` with 30s timeout, diagnostic bounded 8 KB. Exports `canonicalLanguage()`.
- ✅ **3.2** CPP branch — `g++ -O2 -std=c++17 -pipe -o prog prog.cpp`. Returns `UNAVAILABLE` sentinel on ENOENT.

### Block 4 — Execution layer (5/5)
- ✅ **4.1** `modules/judge/stdio-exec.js#execOneTest` — spawn child, pipe stdin, capture stdout with byte cap, tail stderr at 4 KB, wall-clock SIGKILL at 1.5×T, RSS poll (Linux `/proc/<pid>/status`, null on Windows), returns `{ stdout, stderr, timeMs, memoryMb, exit, signal, killedReason }`.
- ✅ **4.2** `classify()` — precedence `OLE > TLE > MLE > RE > WRONG_ANSWER > ACCEPTED`. Emits per-test result with `actual_output` only for `WRONG_ANSWER` + `SAMPLE`.
- ✅ **4.3** `runStdioJudge()` — orchestrates prepare + execOneTest + classify. Stops on first failure (contest semantics). Returns `{ status, runtimeMs, memoryKb, testsPassed, testsTotal, output: JSON.stringify({ perTestResults }), error, beats }`. Tmpdir cleanup in `finally`.
- ✅ **4.4** `runStdioOnce()` — Run flow, no persistence, no iteration. Returns `{ stdout, stderr, verdict, timeMs, memoryMb, timedOut }`.
- ✅ **4.5** `test/judge-stdio-properties.test.mjs` — PBT for P6 (classifier precedence), P7 (compile-error short-circuit with bounded diagnostic), P10 (first-failure aggregation). Uses real `javac` for P7 (skips if unavailable). 11 tests pass.

### Block 5 — Judge dispatcher (3/3)
- ✅ **5.1** `judge/service.js` — `runJudge(problem, code, language, options)` dispatches on `problem_type === 'STDIO'` to `runStdioJudge` / `runStdioOnce`. Other types untouched.
- ✅ **5.2** Regression run — `judge.test.mjs` (14) + `judge-isolation.test.mjs` (10) + `judge-polyglot.test.mjs` (7) all pass unchanged.
- ✅ **5.3** P11 dispatch invariant test — added to `judge-stdio-properties.test.mjs`. Verifies STDIO goes to STDIO branch, ALGORITHM goes to baseline.

### Block 6 — Runtime switching (3/3)
- ✅ **6.1** `runtimes.js` CPP entry — added `cpp` to `RUNTIME_ALIASES`, `DOCKER_IMAGES` (env: `JUDGE_CPP_IMAGE`, default `gcc:13-bookworm`), `localRuntime`, `labelFor`. Updated `judge-polyglot.test.mjs` to use `rust` as the unsupported-language sentinel since CPP is now supported.
- ✅ **6.2** Docker-mode step builder in `stdio-prepare.js` — `STDIO_DOCKER_FLAGS` constant, `getStdioRuntimeMode()` env probe (local/docker/auto/off, 2s docker probe), `buildDockerRunStep()` with `--network=none --read-only --tmpfs=/tmp:rw,noexec,nosuid,size=128m`. `off` mode short-circuits via `prepare()` returning `UNAVAILABLE`.
- ✅ **6.3** `test/judge-stdio-runtime.test.mjs` — 9 integration tests. ACCEPTED/WA/TLE/OLE/RE per-verdict, COMPILE_ERROR (javac-gated), Docker argv assertion, off mode, Run flow. All pass.

### Block 7 — Problems module (4/4)
- ✅ **7.1** `problems/schemas.js` — `ProblemTypeSchema` now includes STDIO. Added `StdioTestCaseSchema`, `StdioFieldsSchema`, `StdioUpdateFieldsSchema`. STDIO validation added to `validateProblemDefinition` (requires testCases, SAMPLE, comparatorMode, languageAllowlist).
- ✅ **7.2** `problems/service.js` — `applyStdioDefaults()` (timeLimitMs=2000, memoryLimitMb=256, outputSizeCapKb=64, comparatorMode='TRIMMED'). `validateStdioRanges()` with HTTP 400 + field identifier. Type-change guard: `TYPE_CHANGE_NOT_ALLOWED` on STDIO ↔ non-STDIO.
- ✅ **7.3** Public vs editor serialisers — `getProblemDetail()` for STDIO exposes only SAMPLE test cases (`sampleTestCases`) + limits + comparator + allowlist. `getProblemEditorDetail()` returns everything unredacted.
- ✅ **7.4** `problems/queries.js` — `insertProblem` and `updateProblem` handle `output_size_cap_kb`, `comparator_mode`, `language_allowlist` (done in 7.2, verified in 7.4).

### Block 8 — Submissions module (5/5)
- ✅ **8.1** `submissions/schemas.js` — new `RunSchema` with optional `stdin: z.string().max(1024*1024).optional()`. Submit schema unchanged. Routes updated to use `RunSchema` for `/run`.
- ✅ **8.2** `submissions/service.js#submit` — STDIO language-allowlist gate before `insertPending`. Imports `canonicalLanguage` from `../judge/stdio-prepare.js`. Rejects with 400 + `LANGUAGE_NOT_ALLOWED`.
- ✅ **8.3** `submissions/service.js#run` — STDIO branch validates language + stdin size (min(outputSizeCapKb*1024, 1 MB) → 413 `STDIN_TOO_LARGE`) → calls `runJudge(problem, code, language, { kind: 'run', stdin })` → returns `{ stdout, stderr, verdict, timeMs, memoryMb, timedOut }`. No persistence.
- ✅ **8.4** `submissionToJson` — shape-based detection (JSON.parse + `perTestResults` array) → maps to `sanitizePerTestResult()` which strips `stdin` / `expected_stdout` / `actual_output` for HIDDEN cases; keeps `actual_output` only for SAMPLE failures.
- ✅ **8.5** `finalize()` — **critical fix**: added `await` to `runJudge(problem, row.code, row.language)` so STDIO submissions (which return Promise) finalize correctly. Non-STDIO unaffected (await on non-Promise is no-op).

### Block 9 — Exam integration (2/2)
- ✅ **9.1** `exams/service.js` — exported `submissionToJson` from `submissions/service.js`; `describeAttempt` now uses it instead of an inline serializer, so STDIO `perTestResults` flow through. `submitInAttempt` is type-agnostic (already works).
- ✅ **9.2** Recent-feed filter — verified `WHERE s.exam_attempt_id IS NULL` in `getRecentActivity` is type-agnostic. No code change.

### Block 10 — Seed catalog (3/3)
- ✅ **10.1** `shared/seed/stdio.js` — three problems:
  - `stdio-sum-of-n` (EASY, TRIMMED) — sum of N integers
  - `stdio-fizzbuzz` (EASY, TRIMMED) — FizzBuzz 1..N
  - `stdio-stable-sort-by-key` (MEDIUM, WHITESPACE_NORMALIZED) — stable sort by numeric key
  - All five languages with reference solutions each.
- ✅ **10.2** `shared/seed/index.js` — wires `stdioProblems` additively. Logger breakdown extended.
- ✅ **10.3** `test/seed-stdio.test.mjs` — cross-product (problem × language) assertion of ACCEPTED. Runtime probes gracefully skip unavailable languages (e.g. on Windows: JS uses `/dev/stdin` so skipped; Python/Go/CPP skipped if not installed; Java runs).
  - During test authoring, fixed a small bug in seed #3 expected output for the third hidden case (values with same key were alphabetised instead of preserving input order).

### Block 11 — Frontend: authoring (3/3)
- ✅ **11.1** `teaching-types.ts` — `ProblemType` includes `'STDIO'` in `types.ts`. Added `StdioComparatorMode`, `StdioLanguage`, `StdioTestCase`, `StdioEditorProblem`, `StdioPublicProblem`, `StdioPerTestResult` interfaces.
- ✅ **11.2** `ProblemForm.tsx` STDIO branch — extended `ProblemFormState`, `emptyFormState()`, `fromEditor()`, `buildPayload()`. New `StdioPanel` component: repeating test case cards (stdin/expected_stdout/visibility), limits inputs with ranges, comparator radio group, language allowlist checkboxes. Client-side guardrails: ≥1 test case, ≥1 SAMPLE, comparator selected, allowlist non-empty.
- ✅ **11.3** `/teach/problems/:slug/edit` — verified `fromEditor()` hydrates all STDIO fields. No route change needed.

### Block 12 — Frontend: student view (3/3)
- ✅ **12.1** `routes/problem-detail.tsx` STDIO branch — added `STDIO_LANG_MAP`, `languagesFor()`, `stdioTemplate()` per-language full-program starters. STDIO state: `stdin`, `stdioRunResult`. New `StdioWorkspace` component with editor + stdin textarea + stdout panel. `StdioVerdictBadge`. Description view shows `sampleTestCases` for STDIO problems.
- ✅ **12.2** `components/stdio/StdioPerTestResults.tsx` — ordered list with verdict badges + time/memory + visibility labels. SAMPLE failures expand to show Actual Output + `LineDiff` (line-by-line, no external lib). HIDDEN shows metrics only.
- ✅ **12.3** `routes/exam.tsx` STDIO parity — added `ExamStdioPanel`, `ExamStdioVerdictBadge`, STDIO template support, sample test cases in description panel, per-test results after submission.

---

## What's next (9/45)

### Block 13 — Integration tests (0/3) — NEXT UP
- ⏳ **13.1** `test/integration-stdio.test.mjs` — authoring
  - P1: round-trip create + `/edit` equality
  - P3: full range/enum/non-empty validation matrix
  - P16: `TYPE_CHANGE_NOT_ALLOWED` for every cross-boundary transition
- ⏳ **13.2** `test/integration-stdio.test.mjs` — runtime and shape (same file)
  - P2: HIDDEN contents never escape public surfaces
  - P4: `LANGUAGE_NOT_ALLOWED` on both Submit and Run
  - P5: `STDIN_TOO_LARGE` 413 before judge invocation
  - P12: submit lifecycle shape invariant across types
  - P15: Run flow never persists
- ⏳ **13.3** `test/integration-stdio.test.mjs` — exam + failure paths (same file)
  - P13: judge exception → JUDGE_ERROR, counters/rating unchanged
  - P14: exam rows filtered from recent feed across types
  - P17: CPP runtime unavailable → JUDGE_ERROR
  - P18: Docker container failure → JUDGE_ERROR per-test

### Block 14 — Documentation (0/3)
- ⏳ **14.1** ADR `docs/decisions/0015-stdio-judge.md`
- ⏳ **14.2** Update `AGENTS.md` Phase section
- ⏳ **14.3** Update `.env.example` (JUDGE_CPP_IMAGE)

### Block 15 — Verification (0/3)
- ⏳ **15.1** Full `npm test` green (all suites)
- ⏳ **15.2** Smoke test: 50 concurrent STDIO submits under `bullmq` mode
- ⏳ **15.3** Frontend build + typecheck + manual smoke

---

## Architecture quick-reference

```
Backend/
  db/migrations/0008_stdio_problems.sql               ← new
  src/modules/judge/
    stdio-comparator.js                               ← new (pure)
    stdio-prepare.js                                  ← new (compile + Docker builder)
    stdio-exec.js                                     ← new (execOneTest + classify + runStdioJudge + runStdioOnce)
    service.js                                        ← modified (dispatcher)
    runtimes.js                                       ← modified (CPP entry)
  src/modules/problems/
    schemas.js                                        ← modified (STDIO branch)
    service.js                                        ← modified (defaults, validation, type-change guard, serialisers)
    queries.js                                        ← modified (new columns)
  src/modules/submissions/
    schemas.js                                        ← modified (Run stdin)
    routes.js                                         ← modified (RunSchema)
    service.js                                        ← modified (allowlist gate, run stdio branch, submissionToJson, await fix)
  src/modules/exams/
    service.js                                        ← modified (reuse submissionToJson)
  src/shared/seed/
    stdio.js                                          ← new (3 seed problems × 5 langs)
    index.js                                          ← modified (wire stdio)
  test/
    stdio-comparator.test.mjs                         ← new (P8, P9)
    judge-stdio-properties.test.mjs                   ← new (P6, P7, P10, P11)
    judge-stdio-runtime.test.mjs                      ← new (runtime modes)
    seed-stdio.test.mjs                               ← new (reference solutions)

Frontend/Frontend/app/
  lib/
    types.ts                                          ← modified (STDIO in ProblemType, ProblemDetail extensions)
    teaching-types.ts                                 ← modified (STDIO interfaces)
  components/
    stdio/StdioPerTestResults.tsx                     ← new (per-test renderer + LineDiff)
    teach/ProblemForm.tsx                             ← modified (StdioPanel)
  routes/
    problem-detail.tsx                                ← modified (StdioWorkspace)
    exam.tsx                                          ← modified (ExamStdioPanel)
```

## Open items / known limitations

1. **DB-layer allowlist CHECK gap** (migration 0008): `array_length(language_allowlist, 1) >= 1` evaluates to NULL for empty arrays, which passes CHECK. Closed at zod + service level. To fix at DB level: `coalesce(array_length(..., 1), 0) >= 1` or `cardinality(...) >= 1 AND language_allowlist IS NOT NULL`.
2. **Memory limit in local mode** is best-effort on non-Linux (null on Windows/macOS). Fine for pilot; Docker mode uses `--memory=Mm` for hard enforcement.
3. **`/dev/stdin` reference solutions** don't work on Windows (seed tests skip JS on Windows). If we ever deploy to a Windows server this needs rewrite. Linux CI is fine.
4. **Docker-mode integration tests** are argv-assertion only (not real `docker run`). Full end-to-end Docker execution is a Phase 2 / Task 15.2 smoke test.

## Ready-to-commit split (when you green-light)

Suggested commit boundary (matches AGENTS.md style):
```
feat(phase-2): stdio-judge — stdin/stdout problem subtype
```
Single commit is fine since everything is intra-feature. If you want to split:
1. `feat(phase-2): stdio-judge backend — migration + pure + exec + dispatcher`
2. `feat(phase-2): stdio-judge — problems/submissions/exams integration`
3. `feat(phase-2): stdio-judge — seed catalog + PBT coverage`
4. `feat(phase-2): stdio-judge — frontend (ProblemForm + student + exam)`
