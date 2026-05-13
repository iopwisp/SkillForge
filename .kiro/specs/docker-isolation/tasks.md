# Implementation Plan

> Feature: `docker-isolation`
> Requirements doc: `.kiro/specs/docker-isolation/requirements.md`
> Design doc: `.kiro/specs/docker-isolation/design.md`
>
> Execution convention:
> - Every task ends with `npm run lint` + `npm test` green in `Backend/`.
> - Task IDs map to PR titles (`feat(docker-isolation): <task-title>`).
> - Each task references the Requirements (R-N.M) and Properties (P-N) it
>   satisfies so the reviewer can pin the contract.
> - PBT tasks use fast-check with ≥100 iterations; header comment must
>   read `// Feature: docker-isolation, Property N: <text>`.
> - All Docker commands are mocked in unit/property tests; real Docker
>   tests are guarded behind a `docker info` probe.

## 1. Container Manager core

- [x] 1.1 Implement `modules/judge/container-manager.js` — createContainer
  - Export `createContainer(opts)` that builds the full `docker create`
    argument array with ALL hardened flags: `--network=none`, `--read-only`,
    `--tmpfs=/tmp:rw,noexec,nosuid,size=<configured>m`, `--pids-limit`,
    `--cpus`, `--memory`, `--ulimit nofile`, `--security-opt=no-new-privileges`,
    optional `--security-opt seccomp=<path>`.
  - Container name: `sf-judge-<submissionId>-<6-char-hex-random>`.
  - Idle entrypoint: `tail -f /dev/null`.
  - After `docker create`, run `docker start <name>` then
    `docker cp <workdir>/. <name>:/workspace`.
  - Return a `ContainerHandle` object with name, image, workdir,
    submissionId, createdAt, timeoutMs, timeoutTimer.
  - Read all limits from `CONTAINER_DEFAULTS` (env-backed with fallbacks).
  - Log container creation at `debug` level (name, image, limits) — never
    log student code or stdin.
  - _Requirements: 1.1, 1.2, 1.4, 2.1–2.10, 8.1, 8.2, 10.1–10.7, 12.1_

- [x] 1.2 Implement `container-manager.js` — execInContainer
  - Export `execInContainer(handle, cmd, execOpts)`.
  - Spawn `docker exec -i <name> <cmd...>`, pipe optional stdin, capture
    stdout up to `outputCapBytes`, tail stderr at 4 KB.
  - Kill on per-exec timeout (SIGKILL the `docker exec` process).
  - Detect OOM via `docker inspect` when exit code is 137.
  - Return `ExecResult { stdout, stderr, exit, signal, timeMs, killedReason, oomKilled }`.
  - Do NOT pass host env vars into the exec (no `--env` flags beyond
    PATH and language-specific vars like GOCACHE).
  - _Requirements: 1.4, 6.4, 8.3, 11.3, 11.4, 12.5_

- [x] 1.3 Implement `container-manager.js` — destroyContainer
  - Export `destroyContainer(handle)`.
  - Run `docker rm -f <name>`, catch "no such container" errors silently
    (idempotent).
  - Clear the per-submission timeout timer if set.
  - Remove the host-side temp directory (`rmSync(workdir, { recursive, force })`).
  - Log destruction at `debug` level (name, exit reason, duration).
  - _Requirements: 1.3, 8.5, 12.2_

## 2. Per-submission timeout

- [x] 2.1 Implement `computeSubmissionTimeout` + kill timer
  - Export `computeSubmissionTimeout(timeLimitMs, testCount, isCompiled)`.
  - Formula: `timeLimitMs × testCount × 1.5 + compileOverhead`.
  - `compileOverhead` = `JUDGE_DOCKER_COMPILE_OVERHEAD_MS` for compiled
    languages (JAVA, GO, CPP), 0 for interpreted (JAVASCRIPT, PYTHON).
  - Clamp result to `[10000, 300000]` ms.
  - In `createContainer`, start a `setTimeout` that calls `docker kill`
    on the container when the timeout fires. Store the timer in the handle.
  - On kill, throw/reject with `err.code = 'SUBMISSION_TIMEOUT'` and log
    at `warn` level.
  - _Requirements: 3.1–3.5, 10.5, 12.3_

## 3. Image pre-pull

- [x] 3.1 Implement `prePullImages` function in `container-manager.js`
  - Export `prePullImages()`.
  - Iterate all configured images from `CONFIGURED_IMAGES` map.
  - For each image: run `docker image inspect <image>` — if exit 0, skip
    (already cached); otherwise run `docker pull <image>` with a per-image
    timeout.
  - Enforce a 120 s total ceiling across all pulls; abort remaining on
    overshoot with a warning log.
  - Return `{ pulled: string[], skipped: string[], failed: string[] }`.
  - Log failures at `warn` level; do NOT crash the worker.
  - _Requirements: 4.1–4.5_

## 4. Property tests (fast-check, mocked Docker)

- [x] 4.1 Create `test/container-manager-properties.test.mjs` — generators
  - Define shared generators: `arbLanguage`, `arbMemoryLimit`,
    `arbTimeLimitMs`, `arbTestCount`, `arbSubmissionId`, `arbCode`,
    `arbEnvOverrides`.
  - Mock `child_process.execFile` to capture Docker command arrays without
    spawning real processes.

- [x]* 4.2 Property 1: All hardened security flags present
  - For any (language, memoryLimit, envOverrides), the `docker create`
    args contain ALL required flags.
  - `// Feature: docker-isolation, Property 1: All hardened security flags are present in every container`
  - **Property 1: All hardened security flags are present in every container**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

- [x]* 4.3 Property 2: Exactly one container per submission
  - For any submission flow (create → N execs → destroy), exactly one
    `docker create` and one `docker start` are issued.
  - `// Feature: docker-isolation, Property 2: Exactly one container is created per submission`
  - **Property 2: Exactly one container is created per submission**
  - **Validates: Requirements 1.1, 1.2**

- [x]* 4.4 Property 3: Container cleanup guaranteed
  - For any outcome (success, error, timeout), `docker rm -f` is called
    and the temp directory is removed.
  - `// Feature: docker-isolation, Property 3: Container cleanup is guaranteed after every submission outcome`
  - **Property 3: Container cleanup is guaranteed after every submission outcome**
  - **Validates: Requirements 1.3, 8.5**

- [x]* 4.5 Property 4: Timeout correctly computed and clamped
  - For any (timeLimitMs ∈ [100,10000], testCount ∈ [1,100], isCompiled),
    result equals `clamp(timeLimitMs × testCount × 1.5 + overhead, 10000, 300000)`.
  - `// Feature: docker-isolation, Property 4: Per-submission timeout is correctly computed and clamped`
  - **Property 4: Per-submission timeout is correctly computed and clamped**
  - **Validates: Requirements 3.1, 3.5**

- [x]* 4.6 Property 5: Env variable overrides reflected in Docker args
  - For any set of env overrides, the Docker create args use the
    overridden values.
  - `// Feature: docker-isolation, Property 5: Environment variable overrides are reflected in Docker args`
  - **Property 5: Environment variable overrides are reflected in Docker args**
  - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x]* 4.7 Property 6: Container names unique and non-predictable
  - For any two submissions, generated names are distinct and contain a
    random component not derivable from submission ID alone.
  - `// Feature: docker-isolation, Property 6: Container names are unique and non-predictable`
  - **Property 6: Container names are unique and non-predictable**
  - **Validates: Requirements 8.1, 8.2**

- [x]* 4.8 Property 7: Source code mounted read-only
  - For any submission, Docker args include `--read-only` and `docker cp`
    targets `/workspace`.
  - `// Feature: docker-isolation, Property 7: Source code is mounted read-only`
  - **Property 7: Source code is mounted read-only**
  - **Validates: Requirements 1.4, 11.4**

- [x]* 4.9 Property 8: Container environment is minimal
  - For any submission, `docker exec` does NOT pass host env vars
    (DATABASE_URL, JWT_SECRET, etc.).
  - `// Feature: docker-isolation, Property 8: Container environment is minimal`
  - **Property 8: Container environment is minimal**
  - **Validates: Requirements 11.3, 11.4**

- [x]* 4.10 Property 9: Compile overhead only for compiled languages
  - For interpreted languages, compileOverhead = 0; for compiled, it
    equals `JUDGE_DOCKER_COMPILE_OVERHEAD_MS`.
  - `// Feature: docker-isolation, Property 9: Compile overhead is included in timeout only for compiled languages`
  - **Property 9: Compile overhead is included in timeout only for compiled languages**
  - **Validates: Requirements 3.1, 10.5**

- [x]* 4.11 Property 10: Seccomp profile conditionally applied
  - When `JUDGE_SECCOMP_PROFILE` is set, `--security-opt seccomp=<path>`
    appears; when unset, no seccomp flag appears.
  - `// Feature: docker-isolation, Property 10: Seccomp profile is conditionally applied`
  - **Property 10: Seccomp profile is conditionally applied**
  - **Validates: Requirements 2.9, 2.10, 10.6**

- [x]* 4.12 Property 11: Log output never contains student code or I/O
  - For any (code, stdin, stdout), log messages emitted by the manager
    contain only metadata (name, image, limits, timing).
  - `// Feature: docker-isolation, Property 11: Log output never contains student code or I/O data`
  - **Property 11: Log output never contains student code or I/O data**
  - **Validates: Requirement 12.5**

- [x]* 4.13 Property 12: Local mode never invokes Docker
  - When `JUDGE_RUNTIME_MODE=local`, no Docker commands are spawned and
    the container-manager is not imported.
  - `// Feature: docker-isolation, Property 12: Local mode never invokes Docker`
  - **Property 12: Local mode never invokes Docker**
  - **Validates: Requirements 7.1, 7.2, 7.4**

## 5. Wire into stdio-exec.js — Docker mode delegation

- [x] 5.1 Refactor `stdio-exec.js` to delegate to container-manager in Docker mode
  - When `getStdioRuntimeMode() === 'docker'`, import and call
    `createContainer` / `execInContainer` / `destroyContainer` instead of
    spawning per-test `docker run` commands.
  - Compile step: `execInContainer(handle, compileCmd, { timeoutMs })`.
  - Test loop: `execInContainer(handle, runCmd, { stdin, timeoutMs, outputCapBytes })`.
  - Catch `SUBMISSION_TIMEOUT` → return overall TLE verdict with diagnostic.
  - `finally` block: always `destroyContainer(handle)`.
  - Local mode path remains completely unchanged.
  - _Requirements: 1.1, 6.1, 6.2, 6.4, 6.5, 7.1_

- [x] 5.2 Regression: existing STDIO tests pass unchanged
  - Run `judge-stdio-properties.test.mjs`, `judge-stdio-runtime.test.mjs`,
    `seed-stdio.test.mjs` — all must pass without modification.
  - _Requirements: 7.3, 12.3 (local mode unchanged)_

## 6. Wire into runtimes.js — Docker mode delegation

- [x] 6.1 Refactor `runtimes.js` to delegate to container-manager in Docker mode
  - When `runtime.kind === 'docker'`, call `createContainer` /
    `execInContainer` / `destroyContainer` instead of `docker run`.
  - Compile step + run step follow the same pattern as stdio-exec.
  - Catch `SUBMISSION_TIMEOUT` → return TLE verdict.
  - `finally` block: always `destroyContainer(handle)` + `rmSync(dir)`.
  - Local mode path remains completely unchanged.
  - _Requirements: 1.2, 6.1, 6.3, 6.4, 6.5, 7.2_

- [x] 6.2 Regression: existing polyglot tests pass unchanged
  - Run `judge-polyglot.test.mjs` — all must pass without modification.
  - _Requirements: 7.3 (local mode unchanged)_

## 7. Checkpoint

- [x] 7. Checkpoint — Ensure all tests pass
  - Run `npm run lint` + `npm test` in `Backend/`.
  - All pre-existing 437+ checks stay green.
  - New property test suite present and passing.
  - Ensure all tests pass, ask the user if questions arise.

## 8. Worker startup — add pre-pull to worker.js

- [x] 8.1 Add image pre-pull call to `src/worker.js`
  - Import `prePullImages` from `container-manager.js`.
  - Import `getStdioRuntimeMode` from `stdio-prepare.js`.
  - Before accepting BullMQ jobs, if mode is `docker` or `auto` (and
    Docker is reachable), call `await prePullImages()`.
  - Log summary: `{ pulled, skipped, failed }` counts at `info` level.
  - If mode is `local` or `off`, skip pre-pull entirely.
  - _Requirements: 4.1–4.5, 7.4_

## 9. Unit tests — example-based tests for error paths

- [x]* 9.1 Create `test/container-manager.test.mjs`
  - Test `createContainer` failure: image not found (exit 125) → throws
    `ContainerStartError`.
  - Test `createContainer` failure: daemon unreachable → throws with
    diagnostic.
  - Test `destroyContainer` idempotency: calling twice does not throw.
  - Test `execInContainer` OOM detection: exit 137 + mock inspect →
    `oomKilled: true`.
  - Test `execInContainer` per-exec timeout: process killed after
    deadline → `killedReason: 'TLE'`.
  - Test `execInContainer` output cap: stdout exceeds cap → process
    killed → `killedReason: 'OLE'`.
  - Test per-submission timeout: timer fires → `docker kill` called →
    error with `code: 'SUBMISSION_TIMEOUT'`.
  - Test graceful degradation: `JUDGE_RUNTIME_MODE=auto` + Docker
    unreachable → falls back to local.
  - Test graceful degradation: `JUDGE_RUNTIME_MODE=docker` + Docker
    unreachable → `JUDGE_ERROR`.
  - All tests use mocked `child_process.execFile`.
  - _Requirements: 1.5, 3.2, 3.4, 5.1–5.5, 6.6_

## 10. Integration tests — real Docker (guarded)

- [x]* 10.1 Create `test/container-manager-integration.test.mjs`
  - Guard: skip entire suite if `docker info` probe fails.
  - Test: create container with `node:20-alpine`, exec `echo hello`,
    verify stdout = `hello\n`, destroy, verify container gone.
  - Test: fork-bomb program (C `fork()` loop) → PID limit kills it →
    non-zero exit.
  - Test: network attempt (`curl http://example.com`) → connection
    refused / timeout.
  - Test: per-submission timeout with `sleep 999` → container killed
    within timeout + 5 s.
  - Test: OOM program (allocate until killed) → exit 137 + oomKilled.
  - Test: concurrent submissions use separate containers with no
    cross-contamination.
  - _Requirements: 8.3, 8.4, 9.1–9.5_

## 11. Update .env.example

- [x] 11.1 Document new environment variables in `Backend/.env.example`
  - Add with comments: `JUDGE_DOCKER_PIDS_LIMIT`, `JUDGE_DOCKER_CPU_LIMIT`,
    `JUDGE_DOCKER_NOFILE_LIMIT`, `JUDGE_DOCKER_TMPFS_SIZE_MB`,
    `JUDGE_DOCKER_COMPILE_OVERHEAD_MS`, `JUDGE_SECCOMP_PROFILE`,
    `JUDGE_NODE_IMAGE`, `JUDGE_PYTHON_IMAGE`, `JUDGE_JAVA_IMAGE`,
    `JUDGE_GO_IMAGE`, `JUDGE_CPP_IMAGE`.
  - Note that all have sensible defaults and are optional.
  - _Requirements: 10.1–10.7_

## 12. ADR

- [x] 12.1 Write `docs/decisions/0016-docker-per-submission.md`
  - Summarise the design decisions: one container per submission,
    `docker create` + `docker exec` pattern, hardened flags, per-submission
    timeout, image pre-pull, graceful degradation.
  - Reference requirements.md and design.md.
  - Note the seccomp profile as a stretch goal (authoring out of scope).
  - Document the env-var override surface for operators.
  - _Requirements: none (housekeeping / traceability)_

## 13. Verification

- [x] 13.1 Full `npm test` green
  - All pre-existing 437+ checks stay green.
  - New suites present: `container-manager-properties`,
    `container-manager`, `container-manager-integration` (skipped if no
    Docker).
  - _Requirements: 7.3_

- [x] 13.2 Frontend build unaffected
  - `npm run typecheck` + `npm run build` green in `Frontend/Frontend/`.
  - No frontend changes in this feature; verify no regressions.
  - _Requirements: none (safety check)_

- [x] 13.3 Manual smoke: Docker mode end-to-end
  - Set `JUDGE_RUNTIME_MODE=docker`, submit a STDIO problem
    (`stdio-sum-of-n`) in Python and JavaScript.
  - Verify ACCEPTED verdict, per-test timing, container cleaned up
    (`docker ps -a | grep sf-judge` returns nothing).
  - _Requirements: 1.1, 6.1, 11.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests validate universal correctness properties from the design.
- Unit tests validate specific examples and edge cases.
- Integration tests require Docker and are guarded — they skip gracefully in CI without Docker.
- Local mode is never touched; all existing tests pass unchanged throughout.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "8.1"] },
    { "id": 6, "tasks": ["9.1", "10.1", "11.1", "12.1"] },
    { "id": 7, "tasks": ["13.1", "13.2", "13.3"] }
  ]
}
```
